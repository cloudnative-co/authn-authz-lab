import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, test } from 'node:test';
import {
  abortableDelay,
  createCleanupScope,
  detectProcessPlatform,
  ProcessControlError,
  startOwnedNode,
  stopOwnedProcess,
  verifyHealthIdentity,
} from '../../course/runner/process.mjs';

const temporaryRoots = [];
const liveChildren = new Set();

after(async () => {
  for (const child of liveChildren) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-runner-process-'));
  temporaryRoots.push(root);
  return root;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = server.address();
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise());
  });
  return port;
}

const fixtureSource = `
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const origin = new URL(process.env.COURSE_PROCESS_ORIGIN);
const instanceId = process.env.COURSE_PROCESS_INSTANCE_ID;
const installId = process.env.COURSE_INSTALL_ID;
const runId = process.env.COURSE_RUN_ID;
const token = process.env.COURSE_PROCESS_SHUTDOWN_TOKEN;
const mode = process.env.HEALTH_MODE || 'normal';
const eventFile = process.env.EVENT_FILE;
writeFileSync(process.env.PID_FILE, String(process.pid), { mode: 0o600 });

function streamUntilCancelled(response, event) {
  let timer;
  response.on('close', () => {
    if (timer) clearInterval(timer);
    appendFileSync(eventFile, event + '\\n');
  });
  response.write('x'.repeat(1024));
  timer = setInterval(() => response.write('x'.repeat(1024)), 5);
}

const server = createServer((request, response) => {
  if (request.url === '/__course/health' && request.method === 'GET') {
    if (mode === 'hang') return;
    if (mode === 'health-error-stream') {
      response.statusCode = 503;
      streamUntilCancelled(response, 'health-error-cancelled');
      return;
    }
    if (mode === 'health-declared-oversized') {
      response.setHeader('content-length', String(32 * 1024));
      streamUntilCancelled(response, 'health-declared-cancelled');
      return;
    }
    if (mode === 'oversized-chunked') {
      response.setHeader('content-type', 'application/json');
      response.write('{"padding":"');
      response.write('x'.repeat(20 * 1024));
      response.end('"}');
      return;
    }
    const reportedInstanceId = mode === 'identity-mismatch' ? 'foreign-install.foreign-run' : instanceId;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      pid: process.pid,
      instanceId: reportedInstanceId,
      installId: mode === 'identity-mismatch' ? 'foreign-install' : installId,
      runId: mode === 'identity-mismatch' ? 'foreign-run' : runId,
    }));
    return;
  }
  if (request.url === '/__course/shutdown' && request.method === 'POST') {
    const authenticated = request.headers['x-course-control-token'] === token
      && request.headers['x-course-instance-id'] === instanceId
      && request.headers.authorization === undefined;
    if (!authenticated) {
      response.statusCode = 403;
      response.end();
      return;
    }
    if (mode === 'shutdown-error-stream') {
      response.statusCode = 503;
      streamUntilCancelled(response, 'shutdown-error-cancelled');
      return;
    }
    if (mode === 'shutdown-identity-stream') {
      response.statusCode = 202;
      response.setHeader('x-course-instance-id', 'foreign-install.foreign-run');
      streamUntilCancelled(response, 'shutdown-identity-cancelled');
      return;
    }
    appendFileSync(eventFile, 'authenticated-shutdown\\n');
    response.statusCode = 202;
    response.setHeader('x-course-instance-id', instanceId);
    response.end();
    setImmediate(() => server.close(() => process.exit(0)));
    return;
  }
  response.statusCode = 404;
  response.end();
});

process.on('SIGTERM', () => {
  appendFileSync(eventFile, 'sigterm\\n');
  process.exit(0);
});
server.listen(Number(origin.port), origin.hostname);
`;

async function fixtureOptions({ mode = 'normal', timeoutMs = 2_000 } = {}) {
  const root = await temporaryRoot();
  const port = await availablePort();
  const scriptPath = resolve(root, 'fixture-server.mjs');
  const pidPath = resolve(root, 'fixture.pid');
  const eventPath = resolve(root, 'events.log');
  await writeFile(scriptPath, fixtureSource, { mode: 0o600 });
  await writeFile(eventPath, '', { mode: 0o600 });
  return {
    root,
    pidPath,
    eventPath,
    start: {
      scriptPath,
      args: [],
      cwd: root,
      env: { EVENT_FILE: eventPath, HEALTH_MODE: mode, PID_FILE: pidPath },
      origin: `http://127.0.0.1:${port}`,
      installId: 'test-install',
      runId: `run-${port}`,
      stdoutPath: resolve(root, 'stdout.log'),
      stderrPath: resolve(root, 'stderr.log'),
      timeoutMs,
      retryIntervalMs: 20,
    },
  };
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitUntilGone(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.fail(`pid ${pid} remained alive`);
}

async function waitForEvent(path, event, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await readFile(path, 'utf8')).includes(event)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.fail(`event was not observed: ${event}`);
}

async function waitForSpawn(child) {
  await new Promise((resolvePromise, rejectPromise) => {
    child.once('spawn', resolvePromise);
    child.once('error', rejectPromise);
  });
}

test('platform detection supports macOS, Linux, and WSL but fails closed on native Windows', async () => {
  assert.deepEqual(detectProcessPlatform({ platform: 'darwin', release: '', env: {} }), {
    status: 'supported',
    profile: 'macos',
  });
  assert.deepEqual(detectProcessPlatform({ platform: 'linux', release: '6.6.0', env: {} }), {
    status: 'supported',
    profile: 'linux',
  });
  assert.deepEqual(detectProcessPlatform({ platform: 'linux', release: 'microsoft-standard-WSL2', env: {} }), {
    status: 'supported',
    profile: 'wsl',
  });
  const unsupported = await startOwnedNode({
    platformSupport: detectProcessPlatform({ platform: 'win32', release: '', env: {} }),
  });
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.reasonCode, 'UNSUPPORTED_WINDOWS_NATIVE');
});

test('owned Node child uses exact health identity and authenticated loopback shutdown', async () => {
  const fixture = await fixtureOptions();
  const suppliedShutdownToken = randomBytes(32).toString('base64url');
  const started = await startOwnedNode({ ...fixture.start, shutdownToken: suppliedShutdownToken });
  liveChildren.add(started.child);
  assert.equal(started.status, 'started');
  assert.equal(started.shutdownToken, suppliedShutdownToken);
  assert.deepEqual(Object.keys(started.record).sort(), ['instanceId', 'origin', 'pid', 'startFingerprint']);
  assert.equal(started.record.instanceId, `test-install.${fixture.start.runId}`);
  assert.match(started.record.startFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal((await stat(started.stdoutPath)).mode & 0o777, 0o600);
  assert.equal((await stat(started.stderrPath)).mode & 0o777, 0o600);
  assert.equal((await verifyHealthIdentity({ record: started.record })).status, 'verified');

  const stopped = await stopOwnedProcess({
    record: started.record,
    shutdownToken: started.shutdownToken,
  });
  assert.deepEqual(stopped, { status: 'stopped', method: 'authenticated-shutdown' });
  await waitUntilGone(started.record.pid);
  assert.equal(await readFile(fixture.eventPath, 'utf8'), 'authenticated-shutdown\n');
  liveChildren.delete(started.child);
});

test('caller-supplied shutdown token must be a canonical 256-bit base64url value', async () => {
  const fixture = await fixtureOptions();
  await assert.rejects(
    startOwnedNode({ ...fixture.start, shutdownToken: 'x'.repeat(43) }),
    (error) => error instanceof TypeError && /canonical 256-bit/.test(error.message),
  );
  await assert.rejects(readFile(fixture.pidPath, 'utf8'), (error) => error.code === 'ENOENT');
});

test('persistent stop fails closed when authenticated health cannot be reached', async () => {
  const fixture = await fixtureOptions();
  const started = await startOwnedNode(fixture.start);
  liveChildren.add(started.child);
  const unreachableOrigin = `http://127.0.0.1:${await availablePort()}`;
  const blocked = await stopOwnedProcess({
    record: { ...started.record, origin: unreachableOrigin },
    shutdownToken: started.shutdownToken,
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reasonCode, 'HEALTH_UNREACHABLE');
  assert.equal(processIsAlive(started.record.pid), true);
  assert.equal((await stopOwnedProcess({
    record: started.record,
    shutdownToken: started.shutdownToken,
  })).status, 'stopped');
  await waitUntilGone(started.record.pid);
  liveChildren.delete(started.child);
});

test('health install and run identity mismatch fails closed and cleans up only the spawned child', async () => {
  const fixture = await fixtureOptions({ mode: 'identity-mismatch' });
  await assert.rejects(startOwnedNode(fixture.start), (error) => {
    assert.equal(error.reasonCode, 'HEALTH_IDENTITY_MISMATCH');
    assert.equal(error.cleanup.status, 'exited');
    return true;
  });
  const pid = Number(await readFile(fixture.pidPath, 'utf8'));
  await waitUntilGone(pid);
  assert.equal(await readFile(fixture.eventPath, 'utf8'), 'sigterm\n');
});

test('chunked health responses are cancelled at the byte limit before JSON parsing', async () => {
  const fixture = await fixtureOptions({ mode: 'oversized-chunked' });
  await assert.rejects(startOwnedNode(fixture.start), (error) => {
    assert.equal(error.reasonCode, 'HEALTH_INVALID_RESPONSE');
    assert.equal(error.cleanup.status, 'exited');
    return true;
  });
  const pid = Number(await readFile(fixture.pidPath, 'utf8'));
  await waitUntilGone(pid);
});

test('health header rejection cancels endless status and declared-length bodies', async () => {
  for (const [mode, event] of [
    ['health-error-stream', 'health-error-cancelled'],
    ['health-declared-oversized', 'health-declared-cancelled'],
  ]) {
    const fixture = await fixtureOptions({ mode });
    await assert.rejects(startOwnedNode(fixture.start), (error) => {
      assert.equal(error.reasonCode, 'HEALTH_INVALID_RESPONSE');
      assert.equal(error.cleanup.status, 'exited');
      return true;
    });
    const pid = Number(await readFile(fixture.pidPath, 'utf8'));
    await waitUntilGone(pid);
    assert.match(await readFile(fixture.eventPath, 'utf8'), new RegExp(event));
  }
});

test('shutdown header rejection cancels endless status and identity-mismatch bodies', async () => {
  for (const [mode, reasonCode, event] of [
    ['shutdown-error-stream', 'SHUTDOWN_REJECTED', 'shutdown-error-cancelled'],
    ['shutdown-identity-stream', 'SHUTDOWN_IDENTITY_MISMATCH', 'shutdown-identity-cancelled'],
  ]) {
    const fixture = await fixtureOptions({ mode });
    const started = await startOwnedNode(fixture.start);
    liveChildren.add(started.child);
    const stopped = await stopOwnedProcess({
      record: started.record,
      shutdownToken: started.shutdownToken,
      timeoutMs: 500,
    });
    assert.equal(stopped.status, 'blocked');
    assert.equal(stopped.reasonCode, reasonCode);
    await waitForEvent(fixture.eventPath, event);
    assert.equal(processIsAlive(started.record.pid), true);
    started.child.kill('SIGKILL');
    await waitUntilGone(started.record.pid);
    liveChildren.delete(started.child);
  }
});

test('health timeout aborts pending I/O and cleans up the fingerprint-matched child', async () => {
  const fixture = await fixtureOptions({ mode: 'hang', timeoutMs: 300 });
  await assert.rejects(startOwnedNode(fixture.start), (error) => {
    assert.equal(error.reasonCode, 'HEALTH_TIMEOUT');
    assert.equal(error.cleanup.status, 'exited');
    return true;
  });
  const pid = Number(await readFile(fixture.pidPath, 'utf8'));
  await waitUntilGone(pid);
  assert.equal(await readFile(fixture.eventPath, 'utf8'), 'sigterm\n');
});

test('fingerprint capture failure rolls back the exact child handle before ownership is recorded', async () => {
  const fixture = await fixtureOptions();
  let childPid;
  await assert.rejects(startOwnedNode({
    ...fixture.start,
    fingerprintCapture: async (pid) => {
      childPid = pid;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      throw new ProcessControlError('FINGERPRINT_UNAVAILABLE', 'injected inspection failure');
    },
  }), (error) => {
    assert.equal(error.reasonCode, 'FINGERPRINT_UNAVAILABLE');
    assert.deepEqual(error.cleanup, { status: 'exited', method: 'child-handle-sigterm' });
    return true;
  });
  assert.equal(Number.isInteger(childPid), true);
  await waitUntilGone(childPid);
});

test('log paths reject symlinks without changing or appending to the target file', async () => {
  const fixture = await fixtureOptions();
  const victim = resolve(fixture.root, 'victim.txt');
  await writeFile(victim, 'keep\n', { mode: 0o644 });
  await symlink(victim, fixture.start.stdoutPath);
  await assert.rejects(
    startOwnedNode(fixture.start),
    (error) => error.reasonCode === 'PROCESS_UNSAFE_LOG_PATH',
  );
  assert.equal(await readFile(victim, 'utf8'), 'keep\n');
  assert.equal((await stat(victim)).mode & 0o777, 0o644);
});

test('persistent stop never signals an unrelated process when the fingerprint is wrong', async (context) => {
  if (process.platform === 'win32') {
    context.skip('native Windows is unsupported');
    return;
  }
  const sleeper = spawn('/bin/sleep', ['10'], { shell: false, stdio: 'ignore' });
  liveChildren.add(sleeper);
  await waitForSpawn(sleeper);
  const result = await stopOwnedProcess({
    record: {
      pid: sleeper.pid,
      instanceId: 'test-install.unrelated-run',
      origin: 'http://127.0.0.1:65535',
      startFingerprint: `sha256:${'0'.repeat(64)}`,
    },
    shutdownToken: 'x'.repeat(43),
  });
  assert.deepEqual(result, { status: 'blocked', reasonCode: 'PROCESS_FINGERPRINT_MISMATCH' });
  assert.equal(processIsAlive(sleeper.pid), true);
  sleeper.kill('SIGTERM');
  await new Promise((resolvePromise) => sleeper.once('exit', resolvePromise));
  liveChildren.delete(sleeper);
});

test('cleanup scope removes timeout and caller-signal resources deterministically', async () => {
  const controller = new AbortController();
  const scope = createCleanupScope({ timeoutMs: 5_000, signal: controller.signal });
  const delayed = abortableDelay(5_000, { signal: scope.signal });
  controller.abort(new Error('test abort'));
  await assert.rejects(delayed, (error) => error.reasonCode === 'OPERATION_ABORTED');
  scope.cleanup();
  scope.cleanup();
});
