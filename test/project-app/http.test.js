import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { after, test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';
import { readProjectAppRuntime } from '../../apps/project-app/runtime.mjs';
import { getLesson01AssessmentReference } from '../../course/lessons/01/domain.mjs';
import {
  detectProcessPlatform,
  startOwnedNode,
  stopOwnedProcess,
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
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-project-app-'));
  temporaryRoots.push(root);
  return root;
}

async function availablePort() {
  const server = createNetServer();
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

function correctSubmission() {
  const reference = getLesson01AssessmentReference();
  return {
    schemaVersion: 1,
    lessonId: '01',
    answers: Object.entries(reference.traceClassifications).map(([traceId, classification]) => ({
      traceId,
      classification,
    })),
    verifiers: Object.entries(reference.expectedVerifiers).map(([boundary, verifier]) => ({
      boundary,
      verifier,
    })),
  };
}

async function listen(server) {
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function requestWithHost(origin, host) {
  const url = new URL('/api/lessons/01/request-traces', origin);
  return new Promise((resolvePromise, rejectPromise) => {
    const request = httpRequest(url, { method: 'GET', headers: { host } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolvePromise({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.once('error', rejectPromise);
    request.end();
  });
}

test('runtime accepts only consistent loopback process configuration', () => {
  const token = 'A'.repeat(43);
  const runtime = readProjectAppRuntime({
    COURSE_INSTALL_ID: 'install-test',
    COURSE_RUN_ID: 'run-test',
    COURSE_PROCESS_INSTANCE_ID: 'install-test.run-test',
    COURSE_PROCESS_ORIGIN: 'http://127.0.0.1:3000',
    COURSE_PROCESS_SHUTDOWN_TOKEN: token,
  });
  assert.deepEqual(runtime.listen, { host: '127.0.0.1', port: 3000 });
  assert.equal(runtime.identity.instanceId, 'install-test.run-test');
  assert.equal(runtime.shutdownToken, token);

  assert.throws(() => readProjectAppRuntime({
    COURSE_INSTALL_ID: 'install-test',
    COURSE_RUN_ID: 'run-test',
    COURSE_PROCESS_INSTANCE_ID: 'install-test.other-run',
    COURSE_PROCESS_ORIGIN: 'http://127.0.0.1:3000',
    COURSE_PROCESS_SHUTDOWN_TOKEN: token,
  }), /inconsistent/);
  assert.throws(() => readProjectAppRuntime({
    COURSE_INSTALL_ID: 'install-test',
    COURSE_RUN_ID: 'run-test',
    COURSE_PROCESS_INSTANCE_ID: 'install-test.run-test',
    COURSE_PROCESS_ORIGIN: 'http://0.0.0.0:3000',
    COURSE_PROCESS_SHUTDOWN_TOKEN: token,
  }), /loopback/);
  assert.throws(() => readProjectAppRuntime({
    COURSE_INSTALL_ID: 'install-test',
    COURSE_RUN_ID: 'run-test',
    COURSE_PROCESS_INSTANCE_ID: 'install-test.run-test',
    COURSE_PROCESS_ORIGIN: 'http://127.0.0.1:3000',
    COURSE_PROCESS_SHUTDOWN_TOKEN: 'x'.repeat(43),
  }), /invalid format/);
});

test('HTTP exercise and checker are deterministic and reject malformed input', async () => {
  const shutdownToken = 'A'.repeat(43);
  const identity = {
    pid: process.pid,
    installId: 'install-test',
    runId: 'run-test',
    instanceId: 'install-test.run-test',
  };
  const server = createProjectAppServer({ identity, shutdownToken });
  const origin = await listen(server);
  try {
    const health = await fetch(`${origin}/__course/health`);
    const healthBody = await health.text();
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(healthBody), identity);
    assert.doesNotMatch(healthBody, new RegExp(shutdownToken));

    const exerciseResponse = await fetch(`${origin}/api/lessons/01/request-traces`);
    const exerciseBody = await exerciseResponse.text();
    assert.equal(exerciseResponse.status, 200);
    assert.equal(JSON.parse(exerciseBody).traces.length, 10);
    assert.equal(JSON.parse(exerciseBody).evidenceBasis, 'provided-case');
    assert.equal(JSON.parse(exerciseBody).runtimeEvidence, false);
    assert.doesNotMatch(exerciseBody, new RegExp(shutdownToken));

    const rebound = await requestWithHost(origin, 'attacker.example');
    assert.equal(rebound.status, 421);
    assert.equal(rebound.body.error.code, 'HOST_INVALID');

    const checked = await fetch(`${origin}/api/lessons/01/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(correctSubmission()),
    });
    assert.equal(checked.status, 200);
    assert.equal((await checked.json()).status, 'pass');

    const malformed = await fetch(`${origin}/api/lessons/01/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...correctSubmission(), unknown: true }),
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'SUBMISSION_SCHEMA_INVALID');

    const wrongContentType = await fetch(`${origin}/api/lessons/01/check`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(correctSubmission()),
    });
    assert.equal(wrongContentType.status, 400);
    assert.equal((await wrongContentType.json()).error.code, 'CONTENT_TYPE_INVALID');

    const oversized = await fetch(`${origin}/api/lessons/01/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(33 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, 'REQUEST_BODY_TOO_LARGE');

    const wrongShutdown = await fetch(`${origin}/__course/shutdown`, {
      method: 'POST',
      headers: {
        'x-course-control-token': 'wrong'.repeat(10),
        'x-course-instance-id': identity.instanceId,
      },
    });
    const wrongShutdownBody = await wrongShutdown.text();
    assert.equal(wrongShutdown.status, 403);
    assert.equal(wrongShutdown.headers.get('www-authenticate'), null);
    assert.doesNotMatch(wrongShutdownBody, new RegExp(shutdownToken));
    assert.equal(JSON.parse(wrongShutdownBody).error.code, 'SHUTDOWN_FORBIDDEN');

    const legacyBearer = await fetch(`${origin}/__course/shutdown`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${shutdownToken}`,
        'x-course-instance-id': identity.instanceId,
      },
    });
    assert.equal(legacyBearer.status, 403);
    assert.equal(legacyBearer.headers.get('www-authenticate'), null);
    assert.equal(await legacyBearer.text(), wrongShutdownBody);

    const wrongInstance = await fetch(`${origin}/__course/shutdown`, {
      method: 'POST',
      headers: {
        'x-course-control-token': shutdownToken,
        'x-course-instance-id': 'other-install.other-run',
      },
    });
    assert.equal(wrongInstance.status, 403);
    assert.equal(wrongInstance.headers.get('www-authenticate'), null);
    const wrongInstanceBody = await wrongInstance.text();
    assert.equal(wrongInstanceBody, wrongShutdownBody);
    assert.doesNotMatch(wrongInstanceBody, new RegExp(shutdownToken));
    assert.equal((await fetch(`${origin}/__course/health`)).status, 200);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('existing process runner verifies identity and performs authenticated shutdown', async (context) => {
  const platformSupport = detectProcessPlatform();
  if (platformSupport.status !== 'supported') {
    context.skip(platformSupport.message);
    return;
  }
  const root = await temporaryRoot();
  const port = await availablePort();
  const start = {
    scriptPath: resolve(import.meta.dirname, '../../apps/project-app/main.mjs'),
    cwd: root,
    env: {},
    origin: `http://127.0.0.1:${port}`,
    installId: 'project-app-test',
    runId: `run-${port}`,
    stdoutPath: resolve(root, 'stdout.log'),
    stderrPath: resolve(root, 'stderr.log'),
  };
  let started;
  try {
    started = await startOwnedNode(start);
    liveChildren.add(started.child);
    assert.equal(started.status, 'started');

    const exerciseResponse = await fetch(`${start.origin}/api/lessons/01/request-traces`);
    assert.equal(exerciseResponse.status, 200);
    assert.equal((await exerciseResponse.json()).traces.length, 10);

    const stopped = await stopOwnedProcess({
      record: started.record,
      shutdownToken: started.shutdownToken,
    });
    assert.deepEqual(stopped, { status: 'stopped', method: 'authenticated-shutdown' });
    liveChildren.delete(started.child);
    assert.equal(await readFile(start.stdoutPath, 'utf8'), '');
    assert.equal(await readFile(start.stderrPath, 'utf8'), '');
  } finally {
    if (started?.child.exitCode === null && started?.child.signalCode === null) {
      started.child.kill('SIGKILL');
      liveChildren.delete(started.child);
      await once(started.child, 'exit');
    }
  }
});
