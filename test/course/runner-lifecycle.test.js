import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { canonicalJson, digestCanonical } from '../../course/runner/canonical.mjs';
import {
  copyPortableCourseReferences,
  linkFixtureRuntimeDependencies,
} from './portable-course-fixture.js';
import { readJournal } from '../../course/runner/journal.mjs';
import { loadCourseFoundation } from '../../course/runner/lifecycle.mjs';
import { acquireCourseCoordinationLease, acquireLock } from '../../course/runner/lock.mjs';
import { runCli } from '../../course/runner/main.mjs';
import {
  createStateRoot,
  ensureStateDirectory,
  loadStateContext,
  writeStateAtomically,
} from '../../course/runner/state.mjs';
import {
  beginTransaction,
  readTransactions,
  withMutationContext,
} from '../../course/runner/transaction.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoots = [];
const candidateEnvironment = {
  os: 'macos',
  architecture: 'arm64',
  nodeMajor: Number.parseInt(process.versions.node.split('.')[0], 10),
  nodeVersion: process.versions.node,
};

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRepository() {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-lifecycle-'));
  temporaryRoots.push(root);
  for (const path of ['apps', 'course', 'curriculum', 'packages', 'scripts', 'services']) {
    await cp(resolve(repositoryRoot, path), resolve(root, path), { recursive: true });
  }
  for (const path of ['README.md', 'course.mjs', 'course-lock.json', 'package.json', 'package-lock.json']) {
    await cp(resolve(repositoryRoot, path), resolve(root, path));
  }
  await mkdir(resolve(root, 'node_modules'), { recursive: true });
  await cp(resolve(repositoryRoot, 'node_modules/.package-lock.json'), resolve(root, 'node_modules/.package-lock.json'));
  await linkFixtureRuntimeDependencies(repositoryRoot, root);
  await cp(resolve(repositoryRoot, 'test'), resolve(root, 'test'), { recursive: true });
  await copyPortableCourseReferences(repositoryRoot, root);
  return root;
}

function outputSink() {
  let value = '';
  return {
    write(chunk) {
      value += chunk;
    },
    read() {
      return value;
    },
  };
}

async function command(repoRoot, argv, environment = candidateEnvironment) {
  const stdout = outputSink();
  const stderr = outputSink();
  const exitCode = await runCli([...argv, '--json'], {
    repoRoot,
    stdout,
    stderr,
    environment,
    now: () => new Date('2026-07-11T00:00:00.000Z'),
  });
  return {
    exitCode,
    result: stdout.read() ? JSON.parse(stdout.read()) : null,
    stderr: stderr.read(),
  };
}

async function currentProjectRecord(repoRoot) {
  const resource = resolve(repoRoot, '.lab/processes/project-app');
  const pointer = JSON.parse(await readFile(resolve(resource, 'current.json'), 'utf8'));
  return JSON.parse(await readFile(resolve(resource, 'generations', pointer.generationId, 'record.json'), 'utf8'));
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.fail(`managed pid ${pid} remained alive`);
}

async function configureProjectPort(repoRoot) {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = server.address();
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise());
  });
  const manifestPath = resolve(repoRoot, 'curriculum/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.ports.find(({ id }) => id === 'project-app-http').port = port;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const sync = spawn(process.execPath, ['scripts/sync-course-contract.mjs'], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const errors = [];
  sync.stderr.on('data', (chunk) => errors.push(chunk));
  const [code, signal] = await once(sync, 'exit');
  assert.equal(code, 0, `contract sync failed: signal=${signal} ${Buffer.concat(errors).toString('utf8')}`);
  return port;
}

async function interruptedTransactionFixture(root, {
  lockRunId = 'interrupted-lesson-setup',
  transactionRunId = lockRunId,
  operationId = 'lesson:01:setup',
  stale = true,
} = {}) {
  assert.equal((await command(root, ['setup'])).exitCode, 0);
  const repositoryRealpath = (await loadCourseFoundation({ repoRoot: root })).repositoryRealpath;
  const stateRoot = resolve(repositoryRealpath, '.lab');
  const lock = await acquireLock({
    stateRoot,
    repoRoot: repositoryRealpath,
    mode: 'write',
    runId: lockRunId,
  });
  const transaction = await beginTransaction({
    stateRoot,
    repoRoot: repositoryRealpath,
    runId: transactionRunId,
    operationId,
    command: operationId.split(':').at(-1),
    timestamp: '2026-07-11T00:00:01.000Z',
  });
  if (stale) {
    const metadata = JSON.parse(await readFile(lock.path, 'utf8'));
    await writeFile(lock.path, `${JSON.stringify({
      ...metadata,
      processStartFingerprint: `sha256:${'f'.repeat(64)}`,
    })}\n`, { mode: 0o600 });
  }
  return { stateRoot, lock, transaction };
}

test('doctor is stateless and reports exact Node 24 and 26 candidate support', async () => {
  const root = await fixtureRepository();
  const passing = await command(root, ['doctor']);
  assert.equal(passing.exitCode, 0);
  assert.equal(passing.result.status, 'pass');
  assert.equal(passing.result.diagnostics.length, 6);
  assert.equal(passing.result.diagnostics.every(({ status }) => status === 'pass'), true);
  await assert.rejects(lstat(resolve(root, '.lab')), /ENOENT/);

  const node26 = await command(root, ['doctor'], {
    ...candidateEnvironment,
    nodeMajor: 26,
    nodeVersion: '26.5.0',
  });
  assert.equal(node26.exitCode, 0);
  assert.equal(node26.result.status, 'pass');

  const blocked = await command(root, ['doctor'], {
    ...candidateEnvironment,
    nodeMajor: 25,
    nodeVersion: '25.1.0',
  });
  assert.equal(blocked.exitCode, 20);
  assert.equal(blocked.result.reasonCode, 'PREREQUISITE_NODE_VERSION');

  await rm(resolve(root, 'node_modules/ldapts'), { recursive: true });
  const missingDependency = await command(root, ['doctor']);
  assert.equal(missingDependency.exitCode, 20);
  assert.equal(missingDependency.result.reasonCode, 'PREREQUISITE_DEPENDENCIES');
  assert.match(missingDependency.result.recovery[0], /npm ci/);

  const driftedRoot = await fixtureRepository();
  const installLockPath = resolve(driftedRoot, 'node_modules/.package-lock.json');
  const installLock = JSON.parse(await readFile(installLockPath, 'utf8'));
  installLock.packages['node_modules/ldapts'].version = '0.0.0';
  await writeFile(installLockPath, `${JSON.stringify(installLock)}\n`);
  const driftedDependency = await command(driftedRoot, ['doctor']);
  assert.equal(driftedDependency.exitCode, 20);
  assert.equal(driftedDependency.result.reasonCode, 'PREREQUISITE_DEPENDENCIES');
  assert.match(driftedDependency.result.diagnostics.find(({ id }) => id === 'dependencies.install').actual, /ldapts:lock-drift/);
});

test('runtime drift blocks lesson and stop before side effects while diagnose and purge recover', async () => {
  const root = await fixtureRepository();
  assert.equal((await command(root, ['setup'])).exitCode, 0);
  const statePath = resolve(root, '.lab/state.json');
  const stateBefore = await readFile(statePath, 'utf8');
  const journalBefore = await readJournal({ stateRoot: resolve(root, '.lab') });
  const transactionsBefore = await readTransactions({ stateRoot: resolve(root, '.lab') });
  const alternateMajor = candidateEnvironment.nodeMajor === 24 ? 26 : 24;
  const alternateEnvironment = {
    ...candidateEnvironment,
    nodeMajor: alternateMajor,
    nodeVersion: `${alternateMajor}.0.0`,
  };

  const lesson = await command(root, ['lesson', '04', 'demo'], alternateEnvironment);
  assert.equal(lesson.exitCode, 30);
  assert.equal(lesson.result.reasonCode, 'STATE_RUNTIME_DRIFT');

  const stop = await command(root, ['stop'], alternateEnvironment);
  assert.equal(stop.exitCode, 30);
  assert.equal(stop.result.reasonCode, 'STATE_RUNTIME_DRIFT');
  assert.equal(await readFile(statePath, 'utf8'), stateBefore);
  assert.deepEqual(await readJournal({ stateRoot: resolve(root, '.lab') }), journalBefore);
  assert.deepEqual(await readTransactions({ stateRoot: resolve(root, '.lab') }), transactionsBefore);

  const diagnosis = await command(root, ['diagnose'], alternateEnvironment);
  assert.equal(diagnosis.exitCode, 30);
  assert.equal(diagnosis.result.reasonCode, 'STATE_RUNTIME_DRIFT');
  assert.equal((await command(root, ['purge', '--yes'], alternateEnvironment)).exitCode, 0);
  await assert.rejects(lstat(resolve(root, '.lab')), /ENOENT/);
});

test('Node 26 rejects Node 24-only Docker lessons before runner side effects', async () => {
  const root = await fixtureRepository();
  const node26Environment = {
    ...candidateEnvironment,
    nodeMajor: 26,
    nodeVersion: '26.5.0',
  };
  assert.equal((await command(root, ['setup'], node26Environment)).exitCode, 0);
  const statePath = resolve(root, '.lab/state.json');
  const stateBefore = await readFile(statePath, 'utf8');
  const journalBefore = await readJournal({ stateRoot: resolve(root, '.lab') });

  const blocked = await command(root, ['lesson', '06', 'doctor'], node26Environment);
  assert.equal(blocked.exitCode, 20);
  assert.equal(blocked.result.status, 'blocked');
  assert.equal(blocked.result.reasonCode, 'UNSUPPORTED_LESSON_NODE_VERSION');
  assert.equal(blocked.result.diagnostics[0].id, 'lesson06.node-version');
  assert.equal(await readFile(statePath, 'utf8'), stateBefore);
  assert.deepEqual(await readJournal({ stateRoot: resolve(root, '.lab') }), journalBefore);
});

test('legacy v1 state with stale source remains diagnosable and purgeable', async () => {
  const root = await fixtureRepository();
  assert.equal((await command(root, ['setup'])).exitCode, 0);
  const markerPath = resolve(root, '.lab/marker.json');
  const statePath = resolve(root, '.lab/state.json');
  const currentMarker = JSON.parse(await readFile(markerPath, 'utf8'));
  const { nodeMajor: ignoredNodeMajor, ...withoutNodeMajor } = currentMarker;
  const legacyMarker = {
    ...withoutNodeMajor,
    schemaVersion: 1,
    sourceDigest: 'b'.repeat(64),
  };
  const legacyDigest = digestCanonical(legacyMarker);
  const currentState = JSON.parse(await readFile(statePath, 'utf8'));
  const legacyState = {
    ...currentState,
    markerDigest: legacyDigest,
    resources: currentState.resources.map((resource) => ({
      ...resource,
      ownershipDigest: resource.ownershipDigest === currentState.markerDigest
        ? legacyDigest
        : resource.ownershipDigest,
    })),
  };
  await writeFile(markerPath, `${canonicalJson(legacyMarker)}\n`);
  await writeFile(statePath, `${canonicalJson(legacyState)}\n`);

  const diagnosis = await command(root, ['diagnose']);
  assert.equal(diagnosis.exitCode, 30);
  assert.equal(diagnosis.result.reasonCode, 'STATE_RUNTIME_DRIFT');
  assert.equal((await command(root, ['purge', '--yes'])).exitCode, 0);
  await assert.rejects(lstat(resolve(root, '.lab')), /ENOENT/);
});

test('help is discoverable and JSON usage errors use a stable envelope', async () => {
  const root = await fixtureRepository();
  const helpOut = outputSink();
  assert.equal(await runCli(['--help'], { repoRoot: root, stdout: helpOut, stderr: outputSink() }), 0);
  assert.match(helpOut.read(), /doctor\|setup\|diagnose/);

  const invalid = await command(root, ['unknown-command']);
  assert.equal(invalid.exitCode, 2);
  assert.equal(invalid.result.status, 'usage-error');
  assert.equal(invalid.result.reasonCode, 'USAGE_ERROR');
  assert.match(invalid.result.message, /unknown course action/);
  assert.equal(invalid.stderr, '');

  const lesson15 = await command(root, ['lesson', '15', 'check']);
  assert.equal(lesson15.exitCode, 20);
  assert.equal(lesson15.result.reasonCode, 'PREREQUISITE_SETUP');
  const capstone = await command(root, ['lesson', 'capstone', 'doctor']);
  assert.equal(capstone.exitCode, 20);
  assert.equal(capstone.result.reasonCode, 'PREREQUISITE_SETUP');

  await command(root, ['setup']);
  const unconfirmedPurge = await command(root, ['purge']);
  assert.equal(unconfirmedPurge.exitCode, 2);
  assert.equal((await lstat(resolve(root, '.lab'))).isDirectory(), true);
  assert.equal((await command(root, ['purge', '--yes'])).exitCode, 0);
});

test('setup cannot create pre-lock state during purge coordination and purge reclaims an empty root', async () => {
  const root = await fixtureRepository();
  const lease = await acquireCourseCoordinationLease({ repoRoot: root, courseId: 'auth-authz' });
  assert.ok(lease.port >= 10_000 && lease.port < 20_000);
  try {
    const blockedSetup = await command(root, ['setup']);
    assert.equal(blockedSetup.exitCode, 21);
    assert.equal(blockedSetup.result.reasonCode, 'LOCK_HELD');
    await assert.rejects(lstat(resolve(root, '.lab')), /ENOENT/);
  } finally {
    await lease.release();
  }

  assert.equal((await command(root, ['setup'])).exitCode, 0);
  assert.equal((await command(root, ['purge', '--yes'])).exitCode, 0);
  await mkdir(resolve(root, '.lab'), { mode: 0o700 });
  const recovered = await command(root, ['purge', '--yes']);
  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.result.status, 'pass');
  await assert.rejects(lstat(resolve(root, '.lab')), /ENOENT/);
});

test('setup, diagnose, reset, stop, and purge form an idempotent lifecycle', async () => {
  const root = await fixtureRepository();
  const setup = await command(root, ['setup']);
  assert.equal(setup.exitCode, 0);
  assert.equal(setup.result.status, 'pass');
  const repeated = await command(root, ['setup']);
  assert.equal(repeated.result.status, 'safe-noop');
  assert.equal(repeated.result.reasonCode, 'STATE_ALREADY_INITIALIZED');
  assert.equal((await lstat(resolve(root, '.lab'))).mode & 0o777, 0o700);

  assert.equal((await command(root, ['diagnose'])).result.status, 'pass');
  assert.equal((await command(root, ['reset'])).result.status, 'pass');
  assert.equal((await command(root, ['diagnose'])).result.status, 'pass');
  const state = JSON.parse(await readFile(resolve(root, '.lab/state.json'), 'utf8'));
  assert.equal(state.epoch, 2);
  const setupCheck = await command(root, ['lesson', 'setup', 'check']);
  assert.equal(setupCheck.exitCode, 0);
  assert.equal(setupCheck.result.status, 'pass');
  assert.deepEqual(setupCheck.result.checkIds, ['AA-SETUP-C1', 'AA-SETUP-C2', 'AA-SETUP-C3']);
  assert.match(setupCheck.result.evidenceId, /^evidence-/);
  const checkedState = JSON.parse(await readFile(resolve(root, '.lab/state.json'), 'utf8'));
  assert.deepEqual(checkedState.lessons.find(({ id }) => id === 'setup').evidenceIds, [setupCheck.result.evidenceId]);
  const evidence = JSON.parse(await readFile(
    resolve(root, '.lab/evidence/epoch-000002', `${setupCheck.result.evidenceId}.json`),
    'utf8',
  ));
  assert.deepEqual(evidence.checkIds, ['AA-SETUP-C1', 'AA-SETUP-C2', 'AA-SETUP-C3']);
  assert.deepEqual(evidence.observations.map(({ outcome }) => outcome), ['pass', 'pass', 'pass']);
  assert.equal((await command(root, ['stop'])).result.status, 'safe-noop');
  const journal = await readJournal({ stateRoot: resolve(root, '.lab') });
  assert.deepEqual(
    journal.map(({ command }) => command),
    ['setup', 'setup', 'diagnose', 'reset', 'diagnose', 'check', 'stop'],
  );
  assert.equal(journal.find(({ command }) => command === 'check').evidenceId, setupCheck.result.evidenceId);
  const transactions = await readTransactions({ stateRoot: resolve(root, '.lab') });
  assert.equal(transactions.every(({ phase }) => phase === 'committed'), true);
  assert.equal(
    transactions.every((transaction) => journal.some(({ runId }) => runId === transaction.runId)),
    true,
    'a mutation must not commit before its operation journal entry exists',
  );

  const purged = await command(root, ['purge', '--non-interactive', '--yes']);
  assert.equal(purged.exitCode, 0);
  assert.equal(purged.result.status, 'pass');
  await assert.rejects(lstat(resolve(root, '.lab')), /ENOENT/);
  assert.equal((await command(root, ['purge', '--non-interactive', '--yes'])).result.status, 'safe-noop');

  const staleRoot = await fixtureRepository();
  await command(staleRoot, ['setup']);
  await writeFile(resolve(staleRoot, '.lab/locks/write.lock'), `${JSON.stringify({
    schemaVersion: 1,
    mode: 'write',
    runId: 'crashed-runner',
    pid: 2_147_483_647,
    processStartFingerprint: `sha256:${'0'.repeat(64)}`,
    acquiredAt: '2026-07-11T00:00:00.000Z',
    nonce: 'a'.repeat(32),
  })}\n`, { mode: 0o600 });
  assert.equal((await command(staleRoot, ['diagnose'])).result.reasonCode, 'LOCK_STALE');
  assert.equal((await command(staleRoot, ['purge', '--yes'])).exitCode, 0);
  await assert.rejects(lstat(resolve(staleRoot, '.lab')), /ENOENT/);

  const stalePurgeRoot = await fixtureRepository();
  await command(stalePurgeRoot, ['setup']);
  await writeFile(resolve(stalePurgeRoot, '.lab/locks/purge.lock'), `${JSON.stringify({
    schemaVersion: 1,
    mode: 'purge',
    runId: 'crashed-purge',
    pid: process.pid,
    processStartFingerprint: `sha256:${'0'.repeat(64)}`,
    acquiredAt: '2026-07-11T00:00:00.000Z',
    nonce: 'b'.repeat(32),
  })}\n`, { mode: 0o600 });
  assert.equal((await command(stalePurgeRoot, ['purge', '--yes'])).exitCode, 0);
  await assert.rejects(lstat(resolve(stalePurgeRoot, '.lab')), /ENOENT/);
});

test('global stop, reset, and purge stop managed processes and keep lesson state coherent', async () => {
  const root = await fixtureRepository();
  const managedPids = new Set();
  try {
    await configureProjectPort(root);
    const courseSetup = await command(root, ['setup']);
    assert.equal(courseSetup.exitCode, 0, JSON.stringify(courseSetup.result));
    assert.equal((await command(root, ['lesson', '01', 'setup'])).exitCode, 0);
    const first = await currentProjectRecord(root);
    managedPids.add(first.pid);

    const stopped = await command(root, ['stop']);
    assert.equal(stopped.exitCode, 0);
    assert.equal(stopped.result.status, 'pass');
    await waitForProcessExit(first.pid);
    managedPids.delete(first.pid);
    const stoppedState = JSON.parse(await readFile(resolve(root, '.lab/state.json'), 'utf8'));
    const stoppedResource = stoppedState.resources.find(({ id }) => id === 'project-app');
    assert.equal(stoppedResource.status, 'stopped');
    assert.equal(stoppedResource.ownershipDigest, stoppedState.markerDigest);
    assert.equal((await command(root, ['lesson', '01', 'diagnose'])).exitCode, 0);

    assert.equal((await command(root, ['lesson', '01', 'setup'])).exitCode, 0);
    const second = await currentProjectRecord(root);
    managedPids.add(second.pid);
    assert.notEqual(second.pid, first.pid);
    const submissionPath = resolve(root, '.lab/submissions/01/submission.json');
    await writeFile(submissionPath, '{"oldAnswer":true}\n', { mode: 0o600 });
    assert.equal((await command(root, ['reset'])).exitCode, 0);
    await waitForProcessExit(second.pid);
    managedPids.delete(second.pid);
    const resetState = JSON.parse(await readFile(resolve(root, '.lab/state.json'), 'utf8'));
    assert.equal(resetState.resources.find(({ id }) => id === 'project-app').status, 'absent');
    await assert.rejects(lstat(resolve(root, '.lab/submissions/01')), /ENOENT/);

    assert.equal((await command(root, ['lesson', '01', 'setup'])).exitCode, 0);
    assert.equal(Object.hasOwn(JSON.parse(await readFile(submissionPath, 'utf8')), 'oldAnswer'), false);
    const third = await currentProjectRecord(root);
    managedPids.add(third.pid);
    assert.equal((await command(root, ['purge', '--yes'])).exitCode, 0);
    await waitForProcessExit(third.pid);
    managedPids.delete(third.pid);
    await assert.rejects(lstat(resolve(root, '.lab')), /ENOENT/);
  } finally {
    for (const pid of managedPids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
});

test('lesson setup hard crash clears its stale operation before retry, stop, and purge', async () => {
  const root = await fixtureRepository();
  let worker;
  let activePid = null;
  try {
    await configureProjectPort(root);
    assert.equal((await command(root, ['setup'])).exitCode, 0);
    const initialState = JSON.parse(await readFile(resolve(root, '.lab/state.json'), 'utf8'));
    const errors = [];
    worker = spawn(process.execPath, ['course.mjs', 'lesson', '01', 'setup', '--json'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    worker.stderr.on('data', (chunk) => errors.push(chunk));
    const operationPath = resolve(root, '.lab/processes/project-app/.operation.lock');
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      if (await lstat(operationPath).then(() => true, () => false)) break;
      if (worker.exitCode !== null || worker.signalCode !== null) {
        assert.fail(`lesson setup exited before crash point: ${Buffer.concat(errors).toString('utf8')}`);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
    }
    assert.equal((await lstat(operationPath)).isFile(), true, 'operation lock was not observed');
    worker.kill('SIGSTOP');
    const workerExit = once(worker, 'exit');
    worker.kill('SIGKILL');
    const [code, signal] = await workerExit;
    assert.equal(code, null);
    assert.equal(signal, 'SIGKILL');

    const [interrupted] = (await readTransactions({ stateRoot: resolve(root, '.lab') }))
      .filter(({ phase }) => phase === 'begun');
    assert.equal(interrupted.operationId, 'lesson:01:setup');
    const diagnosis = await command(root, ['lesson', '01', 'diagnose']);
    assert.equal(diagnosis.exitCode, 21);
    assert.equal(diagnosis.result.reasonCode, 'LOCK_STALE');
    assert.equal(diagnosis.result.recovery.some((value) => value.includes('lesson 01 setup')), true);
    assert.equal(diagnosis.result.recovery.some((value) => value.includes('purge')), false);

    const retried = await command(root, ['lesson', '01', 'setup']);
    assert.equal(retried.exitCode, 0, JSON.stringify(retried.result));
    const transactions = await readTransactions({ stateRoot: resolve(root, '.lab') });
    const aborted = transactions.find(({ runId }) => runId === interrupted.runId);
    assert.equal(aborted.phase, 'aborted');
    assert.equal(aborted.recoveredByRunId, retried.result.runId);
    assert.equal(aborted.recoveryReason, 'owner-exited');
    assert.equal(
      transactions.some(({ runId, phase }) => runId === retried.result.runId && phase === 'committed'),
      true,
    );
    const setupJournal = (await readJournal({ stateRoot: resolve(root, '.lab') }))
      .filter(({ lessonId, command: journalCommand }) => lessonId === '01' && journalCommand === 'setup');
    assert.deepEqual(setupJournal.map(({ runId }) => runId), [retried.result.runId]);
    const retriedState = JSON.parse(await readFile(resolve(root, '.lab/state.json'), 'utf8'));
    assert.equal(retriedState.epoch, initialState.epoch);
    assert.equal(retriedState.lessons.find(({ id }) => id === '01').lastRunId, retried.result.runId);
    activePid = (await currentProjectRecord(root)).pid;
    assert.equal((await command(root, ['stop'])).exitCode, 0);
    await waitForProcessExit(activePid);
    activePid = null;
    assert.equal((await command(root, ['purge', '--yes'])).exitCode, 0);
    await assert.rejects(lstat(resolve(root, '.lab')), /ENOENT/);
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
    if (activePid !== null && processAlive(activePid)) process.kill(activePid, 'SIGKILL');
  }
});

test('diagnose reports a prepared WAL as an incomplete transaction', async () => {
  const root = await fixtureRepository();
  assert.equal((await command(root, ['setup'])).exitCode, 0);
  const foundation = await loadCourseFoundation({ repoRoot: root });
  const stateRoot = resolve(foundation.repositoryRealpath, '.lab');
  const transaction = await beginTransaction({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    runId: 'prepared-diagnose-fixture',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: '2026-07-11T00:00:01.000Z',
    onProgress: ({ phase }) => {
      if (phase === 'after-prepare') throw new Error('leave prepared WAL before state apply');
    },
  });
  const current = await loadStateContext({ stateRoot, repoRoot: foundation.repositoryRealpath });
  await assert.rejects(withMutationContext(transaction, () => writeStateAtomically({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    state: { ...current.state, updatedAt: '2026-07-11T00:00:02.000Z' },
  })), /leave prepared WAL/);
  assert.equal((await readTransactions({ stateRoot }))
    .find(({ runId }) => runId === 'prepared-diagnose-fixture').phase, 'prepared');

  const diagnosis = await command(root, ['diagnose']);
  assert.equal(diagnosis.exitCode, 30);
  assert.equal(diagnosis.result.reasonCode, 'STATE_INCOMPLETE_TRANSACTION');
  assert.equal(diagnosis.result.diagnostics[0].actual, 'incomplete:prepared-diagnose-fixture');
  assert.equal(diagnosis.result.recovery.some((value) => value.includes('purge --yes')), true);
});

test('transaction recovery rejects unsafe ownership and resumes a different unchanged operation', async () => {
  const liveRoot = await fixtureRepository();
  const live = await interruptedTransactionFixture(liveRoot, { stale: false });
  const liveLockBefore = await readFile(live.lock.path, 'utf8');
  const liveTransactionBefore = await readFile(live.transaction.path, 'utf8');
  const liveResult = await command(liveRoot, ['lesson', '01', 'setup']);
  assert.equal(liveResult.exitCode, 21);
  assert.equal(liveResult.result.reasonCode, 'LOCK_HELD');
  assert.equal(await readFile(live.lock.path, 'utf8'), liveLockBefore);
  assert.equal(await readFile(live.transaction.path, 'utf8'), liveTransactionBefore);
  await live.lock.release();

  const mismatchedRoot = await fixtureRepository();
  const mismatched = await interruptedTransactionFixture(mismatchedRoot, {
    lockRunId: 'stale-owner-run',
    transactionRunId: 'pending-setup-run',
  });
  const mismatchedLockBefore = await readFile(mismatched.lock.path, 'utf8');
  const mismatchedTransactionBefore = await readFile(mismatched.transaction.path, 'utf8');
  const mismatchedDiagnosis = await command(mismatchedRoot, ['lesson', '01', 'diagnose']);
  assert.equal(mismatchedDiagnosis.result.recovery.some((value) => value.includes('purge')), true);
  const mismatchedResult = await command(mismatchedRoot, ['lesson', '01', 'setup']);
  assert.equal(mismatchedResult.exitCode, 21);
  assert.equal(mismatchedResult.result.reasonCode, 'LOCK_STALE');
  assert.equal(await readFile(mismatched.lock.path, 'utf8'), mismatchedLockBefore);
  assert.equal(await readFile(mismatched.transaction.path, 'utf8'), mismatchedTransactionBefore);

  const changedRoot = await fixtureRepository();
  const changed = await interruptedTransactionFixture(changedRoot);
  const changedStatePath = resolve(changed.stateRoot, 'state.json');
  const changedState = JSON.parse(await readFile(changedStatePath, 'utf8'));
  await writeFile(changedStatePath, `${JSON.stringify({
    ...changedState,
    updatedAt: '2026-07-11T00:00:02.000Z',
  })}\n`, { mode: 0o600 });
  const changedLockBefore = await readFile(changed.lock.path, 'utf8');
  const changedTransactionBefore = await readFile(changed.transaction.path, 'utf8');
  const changedResult = await command(changedRoot, ['lesson', '01', 'setup']);
  assert.equal(changedResult.exitCode, 30);
  assert.equal(changedResult.result.reasonCode, 'STATE_INCOMPLETE_TRANSACTION');
  assert.equal(await readFile(changed.lock.path, 'utf8'), changedLockBefore);
  assert.equal(await readFile(changed.transaction.path, 'utf8'), changedTransactionBefore);

  const foreignRoot = await fixtureRepository();
  const foreign = await interruptedTransactionFixture(foreignRoot, { operationId: 'course:setup' });
  const foreignTransactionBefore = await readFile(foreign.transaction.path, 'utf8');
  const foreignDiagnosis = await command(foreignRoot, ['lesson', '01', 'diagnose']);
  assert.equal(foreignDiagnosis.result.recovery.some((value) => value.includes('purge')), true);
  const foreignResult = await command(foreignRoot, ['lesson', '01', 'setup']);
  assert.equal(foreignResult.exitCode, 0, JSON.stringify(foreignResult.result));
  const foreignTransactions = await readTransactions({ stateRoot: foreign.stateRoot });
  const recoveredForeign = foreignTransactions.find(({ runId }) => runId === foreign.transaction.value.runId);
  assert.equal(recoveredForeign.phase, 'aborted');
  assert.equal(recoveredForeign.recoveredByRunId, foreignResult.result.runId);
  assert.notEqual(await readFile(foreign.transaction.path, 'utf8'), foreignTransactionBefore);
  await assert.rejects(lstat(foreign.lock.path), /ENOENT/);
  assert.equal((await command(foreignRoot, ['stop'])).exitCode, 0);

  const multipleRoot = await fixtureRepository();
  const multiple = await interruptedTransactionFixture(multipleRoot);
  const duplicate = {
    ...JSON.parse(await readFile(multiple.transaction.path, 'utf8')),
    runId: 'second-pending-setup',
  };
  await writeFile(
    resolve(multiple.stateRoot, 'transactions/second-pending-setup.json'),
    `${JSON.stringify(duplicate)}\n`,
    { mode: 0o600 },
  );
  const multipleLockBefore = await readFile(multiple.lock.path, 'utf8');
  const multipleResult = await command(multipleRoot, ['lesson', '01', 'setup']);
  assert.equal(multipleResult.exitCode, 30);
  assert.equal(multipleResult.result.reasonCode, 'STATE_INCOMPLETE_TRANSACTION');
  assert.equal(await readFile(multiple.lock.path, 'utf8'), multipleLockBefore);
  assert.equal((await readTransactions({ stateRoot: multiple.stateRoot })).filter(({ phase }) => phase === 'begun').length, 2);

  const corruptLockRoot = await fixtureRepository();
  const corruptLock = await interruptedTransactionFixture(corruptLockRoot);
  await writeFile(corruptLock.lock.path, '{}\n', { mode: 0o600 });
  const corruptLockTransactionBefore = await readFile(corruptLock.transaction.path, 'utf8');
  const corruptLockResult = await command(corruptLockRoot, ['lesson', '01', 'setup']);
  assert.equal(corruptLockResult.exitCode, 21);
  assert.equal(corruptLockResult.result.reasonCode, 'LOCK_CORRUPT');
  assert.equal(await readFile(corruptLock.lock.path, 'utf8'), '{}\n');
  assert.equal(await readFile(corruptLock.transaction.path, 'utf8'), corruptLockTransactionBefore);

  const corruptRoot = await fixtureRepository();
  const corrupt = await interruptedTransactionFixture(corruptRoot);
  await writeFile(corrupt.transaction.path, '{}\n', { mode: 0o600 });
  const corruptLockBefore = await readFile(corrupt.lock.path, 'utf8');
  const corruptResult = await command(corruptRoot, ['lesson', '01', 'setup']);
  assert.equal(corruptResult.exitCode, 30);
  assert.equal(await readFile(corrupt.lock.path, 'utf8'), corruptLockBefore);

  const symlinkRoot = await fixtureRepository();
  const unsafe = await interruptedTransactionFixture(symlinkRoot);
  const outside = resolve(symlinkRoot, 'outside-transaction.json');
  await writeFile(outside, await readFile(unsafe.transaction.path, 'utf8'));
  await rm(unsafe.transaction.path);
  await symlink(outside, unsafe.transaction.path);
  const unsafeLockBefore = await readFile(unsafe.lock.path, 'utf8');
  const unsafeResult = await command(symlinkRoot, ['lesson', '01', 'setup']);
  assert.equal(unsafeResult.exitCode, 30);
  assert.equal(unsafeResult.result.reasonCode, 'STATE_UNSAFE_PATH');
  assert.equal(await readFile(unsafe.lock.path, 'utf8'), unsafeLockBefore);
});

test('global reset rejects unknown workspace files without partially deleting learner data', async () => {
  const root = await fixtureRepository();
  assert.equal((await command(root, ['setup'])).exitCode, 0);
  const lessonDirectory = await ensureStateDirectory(
    { stateRoot: resolve(root, '.lab') },
    'submissions',
    '01',
  );
  const exercise = resolve(lessonDirectory, 'exercise.json');
  const submission = resolve(lessonDirectory, 'submission.json');
  const unknown = resolve(lessonDirectory, 'learner-notes.txt');
  await writeFile(exercise, 'exercise\n', { mode: 0o600 });
  await writeFile(submission, 'submission\n', { mode: 0o600 });
  await writeFile(unknown, 'preserve\n', { mode: 0o600 });
  const beforeState = await readFile(resolve(root, '.lab/state.json'), 'utf8');

  const reset = await command(root, ['reset']);
  assert.equal(reset.exitCode, 30);
  assert.equal(reset.result.reasonCode, 'STATE_UNSAFE_PATH');
  assert.equal(await readFile(exercise, 'utf8'), 'exercise\n');
  assert.equal(await readFile(submission, 'utf8'), 'submission\n');
  assert.equal(await readFile(unknown, 'utf8'), 'preserve\n');
  assert.equal(await readFile(resolve(root, '.lab/state.json'), 'utf8'), beforeState);
  await rm(unknown);
  assert.equal((await command(root, ['purge', '--yes'])).exitCode, 0);
});

test('diagnose remains available after source or state schema drift and purge recovers safely', async () => {
  const unownedRoot = await fixtureRepository();
  await mkdir(resolve(unownedRoot, '.lab'), { mode: 0o700 });
  await writeFile(resolve(unownedRoot, '.lab/learner-note.txt'), 'not course state\n');
  const unownedDiagnosis = await command(unownedRoot, ['diagnose']);
  assert.equal(unownedDiagnosis.exitCode, 30);
  assert.equal(unownedDiagnosis.result.reasonCode, 'STATE_UNOWNED_ROOT');
  assert.equal(unownedDiagnosis.result.recovery.some((value) => value.includes('diagnose')), false);
  assert.equal((await command(unownedRoot, ['purge', '--yes'])).result.reasonCode, 'STATE_UNOWNED_ROOT');
  await rm(resolve(unownedRoot, '.lab'), { recursive: true });
  assert.equal((await command(unownedRoot, ['setup'])).result.status, 'pass');
  assert.equal((await command(unownedRoot, ['purge', '--yes'])).exitCode, 0);

  const incompleteSetupRoot = await fixtureRepository();
  const incompleteFoundation = await loadCourseFoundation({ repoRoot: incompleteSetupRoot });
  await createStateRoot({
    repoRoot: incompleteFoundation.repositoryRealpath,
    stateRoot: resolve(incompleteFoundation.repositoryRealpath, '.lab'),
    courseId: incompleteFoundation.manifest.courseId,
    sourceRevision: incompleteFoundation.courseLock.sourceRevision,
    sourceDigest: incompleteFoundation.sourceDigest,
  });
  const incompleteDiagnosis = await command(incompleteSetupRoot, ['diagnose']);
  assert.equal(incompleteDiagnosis.exitCode, 30);
  assert.equal(incompleteDiagnosis.result.reasonCode, 'STATE_INCOMPLETE_SETUP');
  assert.match(incompleteDiagnosis.result.recovery[0], /setup/);
  assert.equal((await command(incompleteSetupRoot, ['setup'])).result.status, 'pass');
  assert.equal((await command(incompleteSetupRoot, ['purge', '--yes'])).exitCode, 0);

  const interruptedRoot = await fixtureRepository();
  await command(interruptedRoot, ['setup']);
  await beginTransaction({
    stateRoot: resolve(interruptedRoot, '.lab'),
    runId: 'interrupted-reset',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: '2026-07-11T00:00:00.000Z',
  });
  const interruptedDiagnosis = await command(interruptedRoot, ['diagnose']);
  assert.equal(interruptedDiagnosis.exitCode, 30);
  assert.equal(interruptedDiagnosis.result.reasonCode, 'STATE_INCOMPLETE_TRANSACTION');
  assert.equal((await command(interruptedRoot, ['purge', '--yes'])).exitCode, 0);

  const sourceRoot = await fixtureRepository();
  await command(sourceRoot, ['setup']);
  const lessonPath = resolve(sourceRoot, 'course/lessons/01/assessment.yaml');
  await writeFile(lessonPath, `${await readFile(lessonPath, 'utf8')}\n`);
  const sourceDiagnosis = await command(sourceRoot, ['diagnose']);
  assert.equal(sourceDiagnosis.exitCode, 30);
  assert.equal(sourceDiagnosis.result.reasonCode, 'COURSE_ARTIFACT_DRIFT');
  assert.match(sourceDiagnosis.result.diagnostics[0].message, /course\/lessons\/01\/assessment\.yaml/);
  assert.equal(sourceDiagnosis.result.recovery.some((value) => value.includes('purge')), false);
  assert.equal((await command(sourceRoot, ['purge', '--non-interactive', '--yes'])).exitCode, 0);
  assert.equal((await command(sourceRoot, ['doctor'])).result.reasonCode, 'COURSE_ARTIFACT_DRIFT');

  const runnerRoot = await fixtureRepository();
  await command(runnerRoot, ['setup']);
  const runnerPath = resolve(runnerRoot, 'course/runner/result.mjs');
  await writeFile(runnerPath, `${await readFile(runnerPath, 'utf8')}\n// runner drift\n`);
  const runnerDiagnosis = await command(runnerRoot, ['diagnose']);
  assert.equal(runnerDiagnosis.exitCode, 30);
  assert.equal(runnerDiagnosis.result.reasonCode, 'STATE_SOURCE_DRIFT');
  assert.equal((await command(runnerRoot, ['purge', '--non-interactive', '--yes'])).exitCode, 0);

  const manifestStateRoot = await fixtureRepository();
  await command(manifestStateRoot, ['setup']);
  const manifestStatePath = resolve(manifestStateRoot, '.lab/state.json');
  const manifestState = JSON.parse(await readFile(manifestStatePath, 'utf8'));
  manifestState.lessons.pop();
  await writeFile(manifestStatePath, `${JSON.stringify(manifestState)}\n`);
  const manifestStateDiagnosis = await command(manifestStateRoot, ['diagnose']);
  assert.equal(manifestStateDiagnosis.exitCode, 30);
  assert.equal(manifestStateDiagnosis.result.reasonCode, 'STATE_MANIFEST_DRIFT');
  assert.match(manifestStateDiagnosis.result.diagnostics[0].message, /manifest/);
  assert.equal((await command(manifestStateRoot, ['purge', '--yes'])).exitCode, 0);

  const schemaRoot = await fixtureRepository();
  await command(schemaRoot, ['setup']);
  const statePath = resolve(schemaRoot, '.lab/state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  await writeFile(statePath, `${JSON.stringify({ ...state, schemaVersion: 999 })}\n`);
  const schemaDiagnosis = await command(schemaRoot, ['diagnose']);
  assert.equal(schemaDiagnosis.exitCode, 30);
  assert.equal(schemaDiagnosis.result.reasonCode, 'STATE_SCHEMA_DRIFT');
  assert.equal((await command(schemaRoot, ['purge', '--non-interactive', '--yes'])).exitCode, 0);
});
