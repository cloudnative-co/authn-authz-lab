import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import {
  ManagedProcessError,
  readManagedProcess,
  recoverManagedProcess,
  startManagedNode,
  stopManagedProcess,
} from '../../course/runner/managed-process.mjs';
import { startOwnedNode, stopOwnedProcess } from '../../course/runner/process.mjs';
import {
  createStateRoot,
  ensureStateDirectory,
  writeJsonAtomically,
  writeStateAtomically,
} from '../../course/runner/state.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const temporaryRoots = [];
export const liveProcesses = new Map();
export const RESOURCE_ID = 'project-app';
export const ALLOWLIST = [RESOURCE_ID];
const SOURCE_DIGEST = 'a'.repeat(64);
const FIXED_TIME = '2026-07-12T00:00:00.000Z';

after(async () => {
  for (const pid of liveProcesses.keys()) {
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

const fixtureServerSource = `
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const origin = new URL(process.env.COURSE_PROCESS_ORIGIN);
const instanceId = process.env.COURSE_PROCESS_INSTANCE_ID;
const installId = process.env.COURSE_INSTALL_ID;
const runId = process.env.COURSE_RUN_ID;
const shutdownToken = process.env.COURSE_PROCESS_SHUTDOWN_TOKEN;
const eventFile = process.env.EVENT_FILE;
const healthMode = process.env.HEALTH_MODE || 'normal';
appendFileSync(eventFile, 'started:' + process.pid + '\\n');

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/__course/health') {
    if (healthMode === 'hang') return;
    if (healthMode === 'oversized') {
      response.setHeader('content-type', 'application/json');
      for (let index = 0; index < 64; index += 1) response.write('x'.repeat(1024));
      response.end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ pid: process.pid, instanceId, installId, runId }));
    return;
  }
  if (request.method === 'POST' && request.url === '/__course/shutdown') {
    const authenticated = request.headers['x-course-control-token'] === shutdownToken
      && request.headers['x-course-instance-id'] === instanceId
      && request.headers.authorization === undefined;
    if (!authenticated) {
      response.statusCode = 403;
      response.end();
      return;
    }
    appendFileSync(eventFile, 'authenticated-shutdown:' + process.pid + '\\n');
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
  appendFileSync(eventFile, 'sigterm:' + process.pid + '\\n');
  process.exit(0);
});
server.listen(Number(origin.port), origin.hostname);
`;

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

export async function fixtureRepository() {
  const repoRoot = await mkdtemp(resolve(tmpdir(), 'auth-authz-managed-process-'));
  temporaryRoots.push(repoRoot);
  await mkdir(resolve(repoRoot, 'curriculum/schemas'), { recursive: true });
  for (const name of [
    'state-marker.schema.json',
    'state.schema.json',
    'managed-process.schema.json',
    'process-control-secret.schema.json',
    'managed-process-pointer.schema.json',
    'managed-process-launch.schema.json',
    'managed-process-operation.schema.json',
  ]) {
    await cp(resolve(repositoryRoot, 'curriculum/schemas', name), resolve(repoRoot, 'curriculum/schemas', name));
  }
  const scriptPath = resolve(repoRoot, 'fixture-server.mjs');
  const eventPath = resolve(repoRoot, 'events.log');
  await writeFile(scriptPath, fixtureServerSource, { mode: 0o600 });
  await writeFile(eventPath, '', { mode: 0o600 });
  const context = await createStateRoot({
    repoRoot,
    stateRoot: '.lab',
    courseId: 'auth-authz',
    sourceDigest: SOURCE_DIGEST,
    installId: '1'.repeat(32),
    createdAt: FIXED_TIME,
  });
  await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot,
    sourceDigest: SOURCE_DIGEST,
    state: {
      $schema: 'curriculum/schemas/state.schema.json',
      schemaVersion: 1,
      courseId: 'auth-authz',
      installId: context.marker.installId,
      markerDigest: context.markerDigest,
      epoch: 1,
      lifecycle: 'ready',
      lessons: [],
      resources: [],
      updatedAt: FIXED_TIME,
    },
  });
  return { repoRoot, context, scriptPath, eventPath };
}

export async function startOptions(fixture, suffix, { healthMode = 'normal' } = {}) {
  const port = await availablePort();
  return {
    scriptPath: fixture.scriptPath,
    cwd: fixture.context.repositoryRealpath,
    env: { EVENT_FILE: fixture.eventPath, HEALTH_MODE: healthMode },
    origin: `http://127.0.0.1:${port}`,
    runId: `run-${port}`,
    stdoutPath: resolve(fixture.context.stateRoot, 'logs', `${RESOURCE_ID}-run-${port}.stdout.log`),
    stderrPath: resolve(fixture.context.stateRoot, 'logs', `${RESOURCE_ID}-run-${port}.stderr.log`),
    timeoutMs: 2_000,
    retryIntervalMs: 20,
  };
}

export async function readCurrentPair(fixture) {
  const resourceRoot = resolve(fixture.context.stateRoot, 'processes', RESOURCE_ID);
  const pointer = JSON.parse(await readFile(resolve(resourceRoot, 'current.json'), 'utf8'));
  const generationRoot = resolve(resourceRoot, 'generations', pointer.generationId);
  const record = await readFile(resolve(generationRoot, 'record.json'), 'utf8')
    .then(JSON.parse)
    .catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  return {
    resourceRoot,
    generationRoot,
    pointer,
    intent: JSON.parse(await readFile(resolve(generationRoot, 'intent.json'), 'utf8')),
    record,
    control: JSON.parse(await readFile(resolve(generationRoot, 'control.json'), 'utf8')),
  };
}

export async function readGenerationPair(fixture, generationId = null) {
  const resourceRoot = resolve(fixture.context.stateRoot, 'processes', RESOURCE_ID);
  const generationsRoot = resolve(resourceRoot, 'generations');
  const ids = (await readdir(generationsRoot)).sort();
  const selected = generationId ?? (ids.length === 1 ? ids[0] : null);
  if (!selected) throw new Error(`expected exactly one generation, found ${ids.length}`);
  const generationRoot = resolve(generationsRoot, selected);
  const optionalJson = (name) => readFile(resolve(generationRoot, name), 'utf8')
    .then(JSON.parse)
    .catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  return {
    resourceRoot,
    generationRoot,
    generationId: selected,
    intent: await optionalJson('intent.json'),
    record: await optionalJson('record.json'),
    control: await optionalJson('control.json'),
  };
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export async function waitUntilGone(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.fail(`pid ${pid} remained alive`);
}

export async function waitForCondition(predicate, label, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.fail(`timed out waiting for ${label}`);
}

export async function spawnManagedWorker({
  fixture,
  options,
  pauseLabel = null,
  pauseBeforeStart = false,
  pauseAfterPointer = false,
}) {
  const workerPath = resolve(fixture.repoRoot, `managed-worker-${options.runId}.mjs`);
  const readyPath = resolve(fixture.repoRoot, `managed-worker-${options.runId}.ready`);
  const managedModule = pathToFileURL(resolve(repositoryRoot, 'course/runner/managed-process.mjs')).href;
  const stateModule = pathToFileURL(resolve(repositoryRoot, 'course/runner/state.mjs')).href;
  const source = `
import { writeFile } from 'node:fs/promises';
import { startManagedNode } from ${JSON.stringify(managedModule)};
import { writeJsonAtomically } from ${JSON.stringify(stateModule)};
const pauseLabel = ${JSON.stringify(pauseLabel)};
const pauseBeforeStart = ${JSON.stringify(pauseBeforeStart)};
const pauseAfterPointer = ${JSON.stringify(pauseAfterPointer)};
const dependencies = {};
if (pauseLabel) {
  dependencies.writeJsonAtomically = async (request) => {
    if (request.label === pauseLabel) {
      await writeFile(${JSON.stringify(readyPath)}, 'ready\\n', { mode: 0o600 });
      await new Promise(() => {});
    }
    return writeJsonAtomically(request);
  };
}
if (pauseBeforeStart) {
  dependencies.startOwnedNode = async () => {
    await writeFile(${JSON.stringify(readyPath)}, 'ready\\n', { mode: 0o600 });
    await new Promise(() => {});
  };
}
if (pauseAfterPointer) {
  dependencies.afterPointerCommit = async () => {
    await writeFile(${JSON.stringify(readyPath)}, 'ready\\n', { mode: 0o600 });
    await new Promise(() => {});
  };
}
await startManagedNode({
  stateRoot: ${JSON.stringify(fixture.context.stateRoot)},
  repoRoot: ${JSON.stringify(fixture.context.repositoryRealpath)},
  resourceId: ${JSON.stringify(RESOURCE_ID)},
  allowedResourceIds: [${JSON.stringify(RESOURCE_ID)}],
  startOptions: ${JSON.stringify(options)},
  dependencies,
});
`;
  await writeFile(workerPath, source, { mode: 0o600 });
  const worker = spawn(process.execPath, [workerPath], {
    cwd: fixture.context.repositoryRealpath,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const errors = [];
  worker.stderr.on('data', (chunk) => errors.push(chunk));
  return { worker, readyPath, errors };
}

export async function killWorker(worker) {
  if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
  if (worker.exitCode === null && worker.signalCode === null) {
    await new Promise((resolvePromise) => worker.once('exit', resolvePromise));
  }
}

export async function spawnRecoveryWorker(fixture, suffix) {
  const workerPath = resolve(fixture.repoRoot, `recovery-worker-${suffix}.mjs`);
  const resultPath = resolve(fixture.repoRoot, `recovery-worker-${suffix}.json`);
  const managedModule = pathToFileURL(resolve(repositoryRoot, 'course/runner/managed-process.mjs')).href;
  const source = `
import { writeFile } from 'node:fs/promises';
import { recoverManagedProcess } from ${JSON.stringify(managedModule)};
let result;
try {
  result = await recoverManagedProcess({
    stateRoot: ${JSON.stringify(fixture.context.stateRoot)},
    repoRoot: ${JSON.stringify(fixture.context.repositoryRealpath)},
    resourceId: ${JSON.stringify(RESOURCE_ID)},
    allowedResourceIds: [${JSON.stringify(RESOURCE_ID)}],
  });
} catch (error) {
  result = { status: 'error', reasonCode: error.reasonCode || 'UNKNOWN' };
}
await writeFile(${JSON.stringify(resultPath)}, JSON.stringify(result) + '\\n', { mode: 0o600 });
`;
  await writeFile(workerPath, source, { mode: 0o600 });
  const worker = spawn(process.execPath, [workerPath], {
    cwd: fixture.context.repositoryRealpath,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return { worker, resultPath };
}

export async function waitForWorkerExit(worker) {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  await new Promise((resolvePromise, rejectPromise) => {
    worker.once('error', rejectPromise);
    worker.once('exit', resolvePromise);
  });
}

export async function rawCleanup(started, control) {
  const result = await stopOwnedProcess({
    record: {
      pid: started.record.pid,
      instanceId: started.record.instanceId,
      origin: started.record.origin,
      startFingerprint: started.record.startFingerprint,
    },
    shutdownToken: control.shutdownToken,
  });
  assert.ok(['stopped', 'safe-noop'].includes(result.status));
  await waitUntilGone(started.record.pid);
  liveProcesses.delete(started.record.pid);
}
