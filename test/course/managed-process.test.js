import assert from 'node:assert/strict';
import {
  chmod,
  link,
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
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runCourseLifecycle } from '../../course/runner/lifecycle.mjs';
import { stopManagedProcesses } from '../../course/runner/managed-lifecycle.mjs';
import {
  ManagedProcessError,
  readManagedProcess,
  recoverManagedProcess,
  startManagedNode,
  stopManagedProcess,
} from '../../course/runner/managed-process.mjs';
import {
  ensureStateDirectory,
  writeJsonAtomically,
} from '../../course/runner/state.mjs';
import {
  ALLOWLIST,
  fixtureRepository,
  isAlive,
  killWorker,
  liveProcesses,
  rawCleanup,
  readCurrentPair,
  readGenerationPair,
  RESOURCE_ID,
  spawnManagedWorker,
  spawnRecoveryWorker,
  startOptions,
  temporaryRoots,
  waitForCondition,
  waitForWorkerExit,
  waitUntilGone,
} from './managed-process-fixture.js';


test('managed start/stop persists private split state, retains stopped record, and rotates the token', async () => {
  const fixture = await fixtureRepository();
  const firstOptions = await startOptions(fixture, 'first');
  const first = await startManagedNode({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: firstOptions,
  });
  liveProcesses.set(first.record.pid, first.record);
  assert.equal(first.status, 'started');
  assert.equal(JSON.stringify(first).includes('shutdownToken'), false);
  assert.equal(Object.hasOwn(first, 'child'), false);

  const firstPair = await readCurrentPair(fixture);
  const firstToken = firstPair.control.shutdownToken;
  assert.equal(typeof firstToken, 'string');
  assert.equal(JSON.stringify(first.record).includes(firstToken), false);
  assert.equal((await stat(firstPair.resourceRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(firstPair.generationRoot)).mode & 0o777, 0o700);
  for (const path of [
    resolve(firstPair.resourceRoot, 'current.json'),
    resolve(firstPair.generationRoot, 'record.json'),
    resolve(firstPair.generationRoot, 'control.json'),
  ]) assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await readFile(firstOptions.stdoutPath, 'utf8')).includes(firstToken), false);
  assert.equal((await readFile(firstOptions.stderrPath, 'utf8')).includes(firstToken), false);
  const running = await readManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.equal(running.status, 'running');
  assert.equal(JSON.stringify(running).includes(firstToken), false);

  const stopped = await stopManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.equal(stopped.status, 'stopped');
  await waitUntilGone(first.record.pid);
  liveProcesses.delete(first.record.pid);
  const retained = await readCurrentPair(fixture);
  assert.equal(retained.record.status, 'stopped');
  assert.equal(retained.control.status, 'retired');
  assert.equal(retained.control.shutdownToken, null);

  const secondOptions = await startOptions(fixture, 'second');
  const second = await startManagedNode({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: secondOptions,
  });
  liveProcesses.set(second.record.pid, second.record);
  const secondPair = await readCurrentPair(fixture);
  assert.notEqual(secondPair.pointer.generationId, firstPair.pointer.generationId);
  assert.notEqual(secondPair.control.shutdownToken, firstToken);
  assert.equal((await stopManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  })).status, 'stopped');
  await waitUntilGone(second.record.pid);
  liveProcesses.delete(second.record.pid);
  const events = await readFile(fixture.eventPath, 'utf8');
  assert.equal((events.match(/authenticated-shutdown:/g) ?? []).length, 2);
});

test('a successful managed start lets its one-shot parent exit while the owned child keeps running', async () => {
  const fixture = await fixtureRepository();
  const options = await startOptions(fixture, 'parent-exits');
  const session = await spawnManagedWorker({ fixture, options });
  let pair = null;
  try {
    await waitForCondition(
      () => session.worker.exitCode !== null || session.worker.signalCode !== null,
      'successful managed worker exit',
      2_000,
    );
    assert.equal(session.worker.exitCode, 0, Buffer.concat(session.errors).toString('utf8'));
    assert.equal(session.worker.signalCode, null);
    pair = await readCurrentPair(fixture);
    assert.equal(pair.record.status, 'running');
    assert.equal(pair.control.status, 'active');
    assert.equal(isAlive(pair.record.pid), true);
    liveProcesses.set(pair.record.pid, pair.record);
  } finally {
    await killWorker(session.worker);
    pair ??= await readCurrentPair(fixture).catch(() => null);
    if (pair?.record?.status === 'running' && pair?.control?.status === 'active') {
      liveProcesses.set(pair.record.pid, pair.record);
      await rawCleanup({ record: pair.record }, pair.control);
    }
  }
});

test('pointer persistence failure never releases the target and retires the durable generation', async () => {
  const fixture = await fixtureRepository();
  const options = await startOptions(fixture, 'rollback');
  let failure;
  await assert.rejects(startManagedNode({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: options,
    dependencies: {
      writeJsonAtomically: async (request) => {
        if (request.label === 'managed process pointer') throw new Error('injected pointer write failure');
        return writeJsonAtomically(request);
      },
    },
  }), (error) => {
    failure = error;
    assert.equal(error.reasonCode, 'PROCESS_START_PERSIST_FAILED');
    assert.equal(error.cleanup.reconciliation.status, 'reconciled');
    assert.equal(JSON.stringify(error).includes('shutdownToken'), false);
    return true;
  });
  assert.ok(failure instanceof ManagedProcessError);
  assert.equal(await readFile(fixture.eventPath, 'utf8'), '');
  const generations = resolve(fixture.context.stateRoot, 'processes', RESOURCE_ID, 'generations');
  assert.equal((await readdir(generations)).length, 1);
  const generation = await readGenerationPair(fixture);
  assert.equal(generation.intent.status, 'aborted');
  assert.equal(generation.record.status, 'stopped');
  assert.equal(generation.control.status, 'retired');
  assert.equal(generation.control.shutdownToken, null);
  assert.deepEqual(await readManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  }), { status: 'absent', resourceId: RESOURCE_ID });
});

test('a crash after bootstrap spawn but before record commit cannot start the target', async () => {
  const fixture = await fixtureRepository();
  const session = await spawnManagedWorker({
    fixture,
    options: await startOptions(fixture, 'before-record'),
    pauseLabel: 'managed process record',
  });
  await waitForCondition(
    () => stat(session.readyPath).then(() => true, () => false),
    'record-commit crash boundary',
  );
  const pending = await readGenerationPair(fixture);
  assert.equal(pending.record, null);
  assert.equal(pending.intent.status, 'pending');
  assert.equal(pending.control.status, 'active');
  assert.equal(await readFile(fixture.eventPath, 'utf8'), '');
  await killWorker(session.worker);
  const recovered = await recoverManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.equal(recovered.status, 'safe-noop');
  const retained = await readGenerationPair(fixture, pending.generationId);
  assert.equal(retained.record, null);
  assert.equal(retained.intent.status, 'aborted');
  assert.equal(retained.control.status, 'retired');
  assert.equal(retained.control.shutdownToken, null);
  assert.equal(await readFile(fixture.eventPath, 'utf8'), '');
});

test('the gated bootstrap cannot run the target before record and pointer commit', async () => {
  const fixture = await fixtureRepository();
  const session = await spawnManagedWorker({
    fixture,
    options: await startOptions(fixture, 'before-pointer'),
    pauseLabel: 'managed process pointer',
  });
  await waitForCondition(
    () => stat(session.readyPath).then(() => true, () => false),
    'pointer-commit crash boundary',
  );
  const generation = await readGenerationPair(fixture);
  assert.equal(generation.record.status, 'running');
  assert.equal(isAlive(generation.record.pid), true);
  assert.equal(await readFile(fixture.eventPath, 'utf8'), '');
  liveProcesses.set(generation.record.pid, generation.record);
  await killWorker(session.worker);

  const recovered = await recoverManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.equal(recovered.status, 'safe-noop');
  await waitUntilGone(generation.record.pid);
  liveProcesses.delete(generation.record.pid);
  const retained = await readGenerationPair(fixture, generation.generationId);
  assert.equal(retained.intent.status, 'aborted');
  assert.equal(retained.record.status, 'stopped');
  assert.equal(retained.record.stopMethod, 'activation-aborted');
  assert.equal(retained.control.status, 'retired');
  assert.equal(retained.control.shutdownToken, null);
  assert.equal(await readFile(fixture.eventPath, 'utf8'), '');
});

test('a hard crash after pointer commit remains fully recoverable', async () => {
  const fixture = await fixtureRepository();
  const session = await spawnManagedWorker({
    fixture,
    options: await startOptions(fixture, 'after-pointer'),
    pauseAfterPointer: true,
  });
  await waitForCondition(
    () => stat(session.readyPath).then(() => true, () => false),
    'post-pointer crash boundary',
  );
  const pair = await readCurrentPair(fixture);
  liveProcesses.set(pair.record.pid, pair.record);
  await killWorker(session.worker);
  const recovered = await recoverManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.equal(recovered.status, 'stopped', JSON.stringify(recovered));
  await waitUntilGone(pair.record.pid);
  liveProcesses.delete(pair.record.pid);
  const stopped = await readCurrentPair(fixture);
  assert.equal(stopped.record.status, 'stopped');
  assert.equal(stopped.control.status, 'retired');
  assert.equal(stopped.control.shutdownToken, null);
});

test('bootstrap exits even when a partially initialized target leaves active handles before throwing', async () => {
  const fixture = await fixtureRepository();
  const scriptPath = resolve(fixture.repoRoot, 'partial-target.mjs');
  await writeFile(scriptPath, "setInterval(() => {}, 1000); throw new Error('partial import');\n", {
    mode: 0o600,
  });
  const options = await startOptions(fixture, 'partial-target');
  options.scriptPath = scriptPath;
  const session = await spawnManagedWorker({ fixture, options, pauseAfterPointer: true });
  await waitForCondition(
    () => stat(session.readyPath).then(() => true, () => false),
    'partial target activation',
  );
  const pair = await readCurrentPair(fixture);
  liveProcesses.set(pair.record.pid, pair.record);
  await killWorker(session.worker);
  await waitUntilGone(pair.record.pid);
  liveProcesses.delete(pair.record.pid);
  const recovered = await recoverManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.equal(recovered.status, 'stopped');
  const stopped = await readCurrentPair(fixture);
  assert.equal(stopped.record.stopMethod, 'already-gone');
  assert.equal(stopped.control.status, 'retired');
});

test('concurrent recovery serializes a durable activation and never double-stops it', async () => {
  const fixture = await fixtureRepository();
  const session = await spawnManagedWorker({
    fixture,
    options: await startOptions(fixture, 'concurrent-recovery'),
    pauseAfterPointer: true,
  });
  await waitForCondition(
    () => stat(session.readyPath).then(() => true, () => false),
    'concurrent recovery crash boundary',
  );
  const pair = await readCurrentPair(fixture);
  liveProcesses.set(pair.record.pid, pair.record);
  await waitForCondition(
    async () => /^started:\d+$/m.test(await readFile(fixture.eventPath, 'utf8')),
    'concurrent recovery target start',
  );
  await killWorker(session.worker);
  const workers = await Promise.all([
    spawnRecoveryWorker(fixture, 'one'),
    spawnRecoveryWorker(fixture, 'two'),
  ]);
  await Promise.all(workers.map(({ worker }) => waitForWorkerExit(worker)));
  const results = await Promise.all(workers.map(async ({ resultPath }) => (
    JSON.parse(await readFile(resultPath, 'utf8'))
  )));
  assert.equal(results.some((result) => result.status === 'stopped'), true);
  for (const result of results) {
    assert.ok(['stopped', 'safe-noop', 'error'].includes(result.status), JSON.stringify(result));
    if (result.status === 'error') {
      assert.ok([
        'PROCESS_RECOVERY_LEASE_BUSY',
        'PROCESS_OPERATION_LOCKED',
        'PROCESS_OPERATION_STALE_RECOVERY_REQUIRED',
      ].includes(result.reasonCode));
    }
  }
  await waitUntilGone(pair.record.pid);
  liveProcesses.delete(pair.record.pid);
  const events = await readFile(fixture.eventPath, 'utf8');
  assert.equal((events.match(/authenticated-shutdown:/g) ?? []).length, 1);
});

test('recovery preserves the token when a durably recorded target cannot prove health', async () => {
  const fixture = await fixtureRepository();
  const session = await spawnManagedWorker({
    fixture,
    options: await startOptions(fixture, 'hard-crash-health', { healthMode: 'hang' }),
  });
  await waitForCondition(
    async () => /^started:\d+$/m.test(await readFile(fixture.eventPath, 'utf8')),
    'hung target start',
  );
  const pair = await readCurrentPair(fixture);
  liveProcesses.set(pair.record.pid, pair.record);
  await killWorker(session.worker);
  const recovered = await recoverManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    timeoutMs: 250,
  });
  assert.deepEqual(recovered, {
    status: 'blocked',
    resourceId: RESOURCE_ID,
    reasonCode: 'HEALTH_TIMEOUT',
  });
  const retained = await readCurrentPair(fixture);
  assert.equal(retained.record.status, 'running');
  assert.equal(retained.control.status, 'active');
  assert.equal(retained.control.shutdownToken, pair.control.shutdownToken);
  assert.equal(JSON.stringify(recovered).includes(pair.control.shutdownToken), false);
  process.kill(pair.record.pid, 'SIGKILL');
  await waitUntilGone(pair.record.pid);
  liveProcesses.delete(pair.record.pid);
});

test('recovery removes a known hard-link temp without deleting its published target', async () => {
  const fixture = await fixtureRepository();
  const started = await startManagedNode({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: await startOptions(fixture, 'hard-link-temp'),
  });
  liveProcesses.set(started.record.pid, started.record);
  await stopManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  await waitUntilGone(started.record.pid);
  liveProcesses.delete(started.record.pid);
  const pair = await readCurrentPair(fixture);
  const recordPath = resolve(pair.generationRoot, 'record.json');
  const temporaryPath = resolve(pair.generationRoot, '.00000000-0000-4000-8000-000000000001.tmp');
  await link(recordPath, temporaryPath);
  assert.equal((await stat(recordPath)).nlink, 2);
  await assert.rejects(readManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  }), (error) => error.reasonCode === 'PROCESS_ATOMIC_RECOVERY_REQUIRED');
  const recovered = await recoverManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.equal(recovered.status, 'safe-noop');
  await assert.rejects(stat(temporaryPath), /ENOENT/);
  assert.equal((await stat(recordPath)).nlink, 1);
  assert.equal((await readCurrentPair(fixture)).record.status, 'stopped');
});

test('recovery clears a partial unpublished operation lock instead of wedging the resource', async () => {
  const fixture = await fixtureRepository();
  const started = await startManagedNode({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: await startOptions(fixture, 'partial-operation'),
  });
  liveProcesses.set(started.record.pid, started.record);
  await stopManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  await waitUntilGone(started.record.pid);
  liveProcesses.delete(started.record.pid);
  const pair = await readCurrentPair(fixture);
  const temporaryPath = resolve(
    pair.resourceRoot,
    `.operation-write-2147483647-op-${'a'.repeat(32)}-${'0'.repeat(64)}.tmp`,
  );
  await writeFile(temporaryPath, '{"partial"', { mode: 0o600 });
  await assert.rejects(readManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  }), (error) => error.reasonCode === 'PROCESS_OPERATION_STALE_RECOVERY_REQUIRED');
  const recovered = await recoverManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.equal(recovered.status, 'safe-noop');
  await assert.rejects(stat(temporaryPath), /ENOENT/);
});

test('an aborted intent never retires the token while its recorded child is still running', async () => {
  const fixture = await fixtureRepository();
  const started = await startManagedNode({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: await startOptions(fixture, 'aborted-running'),
  });
  liveProcesses.set(started.record.pid, started.record);
  const pair = await readCurrentPair(fixture);
  await writeJsonAtomically({
    anchor: fixture.context.stateRoot,
    path: resolve(pair.generationRoot, 'intent.json'),
    value: {
      ...pair.intent,
      status: 'aborted',
      abortedAt: '2026-07-12T01:00:00.000Z',
      abortReasonCode: 'PROCESS_TEST_CRASH',
    },
    label: 'managed process launch intent',
  });
  const recovered = await recoverManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.equal(recovered.status, 'stopped');
  await waitUntilGone(started.record.pid);
  liveProcesses.delete(started.record.pid);
  const stopped = await readCurrentPair(fixture);
  assert.equal(stopped.record.status, 'stopped');
  assert.equal(stopped.control.status, 'retired');
  assert.equal(stopped.control.shutdownToken, null);
});

test('recovery discards an unpublished atomic temp and never promotes it to process ownership', async () => {
  const fixture = await fixtureRepository();
  const session = await spawnManagedWorker({
    fixture,
    options: await startOptions(fixture, 'unpublished-temp'),
    pauseBeforeStart: true,
  });
  await waitForCondition(
    () => stat(session.readyPath).then(() => true, () => false),
    'unpublished record crash boundary',
  );
  await killWorker(session.worker);
  const generation = await readGenerationPair(fixture);
  const recordPath = resolve(generation.generationRoot, 'record.json');
  const temporaryPath = resolve(
    generation.generationRoot,
    '.00000000-0000-4000-8000-000000000002.tmp',
  );
  const stoppedAt = '2026-07-12T01:00:00.000Z';
  await writeJsonAtomically({
    anchor: fixture.context.stateRoot,
    path: temporaryPath,
    value: {
      $schema: 'curriculum/schemas/managed-process.schema.json',
      schemaVersion: 1,
      resourceId: RESOURCE_ID,
      generationId: generation.generationId,
      status: 'stopped',
      pid: process.pid,
      instanceId: generation.intent.instanceId,
      origin: generation.intent.origin,
      startFingerprint: `sha256:${'0'.repeat(64)}`,
      startedAt: generation.intent.createdAt,
      updatedAt: stoppedAt,
      stoppedAt,
      stopMethod: 'already-gone',
      stopReasonCode: 'PROCESS_TEST_CRASH',
    },
    label: 'simulated unpublished managed process record',
  });
  await assert.rejects(stat(recordPath), /ENOENT/);
  const recovered = await recoverManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.equal(recovered.status, 'safe-noop');
  await assert.rejects(stat(temporaryPath), /ENOENT/);
  await assert.rejects(stat(recordPath), /ENOENT/);
  const retained = await readGenerationPair(fixture, generation.generationId);
  assert.equal(retained.intent.status, 'aborted');
  assert.equal(retained.control.status, 'retired');
  assert.equal(await readFile(fixture.eventPath, 'utf8'), '');
});

test('recovery safely reconciles every pre-spawn crash boundary without starting the target', async () => {
  const boundaries = [
    { name: 'before-intent', pauseLabel: 'managed process launch intent', retained: false },
    { name: 'before-spawn', pauseBeforeStart: true, retained: true },
  ];
  for (const boundary of boundaries) {
    const fixture = await fixtureRepository();
    const options = await startOptions(fixture, boundary.name);
    const session = await spawnManagedWorker({ fixture, options, ...boundary });
    await waitForCondition(
      () => stat(session.readyPath).then(() => true, () => false),
      `worker pause at ${boundary.name}`,
    );
    await killWorker(session.worker);
    const recovered = await recoverManagedProcess({
      stateRoot: fixture.context.stateRoot,
      repoRoot: fixture.repoRoot,
      resourceId: RESOURCE_ID,
      allowedResourceIds: ALLOWLIST,
    });
    assert.deepEqual(recovered, {
      status: 'safe-noop',
      resourceId: RESOURCE_ID,
      reasonCode: 'PROCESS_NOT_RECORDED',
    });
    const generationIds = await readdir(
      resolve(fixture.context.stateRoot, 'processes', RESOURCE_ID, 'generations'),
    );
    assert.equal(generationIds.length, boundary.retained ? 1 : 0);
    if (boundary.retained) {
      const generation = await readGenerationPair(fixture, generationIds[0]);
      assert.equal(generation.record, null);
      assert.equal(generation.intent.status, 'aborted');
      assert.equal(generation.control.status, 'retired');
      assert.equal(generation.control.shutdownToken, null);
    }
    assert.equal(await readFile(fixture.eventPath, 'utf8'), '');
  }
});

test('resource allowlist, symlinks, and insecure secret permissions fail closed', async () => {
  const fixture = await fixtureRepository();
  await assert.rejects(readManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: '../escape',
    allowedResourceIds: ALLOWLIST,
  }), TypeError);
  await assert.rejects(readManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: 'other-app',
    allowedResourceIds: ALLOWLIST,
  }), (error) => error.reasonCode === 'PROCESS_RESOURCE_NOT_ALLOWED');

  const logFixture = await fixtureRepository();
  const logOptions = await startOptions(logFixture, 'unowned-log');
  logOptions.stdoutPath = resolve(logFixture.context.stateRoot, 'logs', 'my-notes.stdout.log');
  await assert.rejects(startManagedNode({
    stateRoot: logFixture.context.stateRoot,
    repoRoot: logFixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: logOptions,
  }), (error) => error.reasonCode === 'PROCESS_LOG_PATH_NOT_OWNED');
  assert.equal(await readFile(logFixture.eventPath, 'utf8'), '');

  const outside = await mkdtemp(resolve(tmpdir(), 'auth-authz-managed-outside-'));
  temporaryRoots.push(outside);
  await ensureStateDirectory(fixture.context, 'processes');
  await symlink(outside, resolve(fixture.context.stateRoot, 'processes', RESOURCE_ID));
  await assert.rejects(readManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  }), (error) => error.reasonCode === 'STATE_UNSAFE_PATH');

  const modeFixture = await fixtureRepository();
  const started = await startManagedNode({
    stateRoot: modeFixture.context.stateRoot,
    repoRoot: modeFixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: await startOptions(modeFixture, 'mode'),
  });
  liveProcesses.set(started.record.pid, started.record);
  const pair = await readCurrentPair(modeFixture);
  await chmod(resolve(pair.generationRoot, 'control.json'), 0o644);
  await assert.rejects(readManagedProcess({
    stateRoot: modeFixture.context.stateRoot,
    repoRoot: modeFixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  }), (error) => error.reasonCode === 'PROCESS_STATE_INSECURE');
  await chmod(resolve(pair.generationRoot, 'control.json'), 0o600);
  await rawCleanup(started, pair.control);
});

test('wrong course control token or fingerprint drift blocks stop without signaling the recorded pid', async () => {
  const fixture = await fixtureRepository();
  const started = await startManagedNode({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: await startOptions(fixture, 'drift'),
  });
  liveProcesses.set(started.record.pid, started.record);
  const pair = await readCurrentPair(fixture);
  await writeJsonAtomically({
    anchor: fixture.context.stateRoot,
    path: resolve(pair.generationRoot, 'control.json'),
    value: { ...pair.control, shutdownToken: 'x'.repeat(43) },
    label: 'process control secret',
  });
  const wrongControl = await stopManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.equal(wrongControl.status, 'blocked');
  assert.equal(wrongControl.reasonCode, 'SHUTDOWN_REJECTED');
  assert.equal(isAlive(started.record.pid), true);
  await writeJsonAtomically({
    anchor: fixture.context.stateRoot,
    path: resolve(pair.generationRoot, 'control.json'),
    value: pair.control,
    label: 'process control secret',
  });
  await writeJsonAtomically({
    anchor: fixture.context.stateRoot,
    path: resolve(pair.generationRoot, 'record.json'),
    value: { ...pair.record, startFingerprint: `sha256:${'0'.repeat(64)}` },
    label: 'managed process record',
  });
  const blocked = await stopManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  });
  assert.deepEqual(blocked, {
    status: 'blocked',
    resourceId: RESOURCE_ID,
    reasonCode: 'PROCESS_FINGERPRINT_MISMATCH',
  });
  assert.equal(isAlive(started.record.pid), true);
  await rawCleanup(started, pair.control);
});

test('record/control identity mismatch and stale operation locks fail closed', async () => {
  const fixture = await fixtureRepository();
  const started = await startManagedNode({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: await startOptions(fixture, 'identity'),
  });
  liveProcesses.set(started.record.pid, started.record);
  const pair = await readCurrentPair(fixture);
  await writeJsonAtomically({
    anchor: fixture.context.stateRoot,
    path: resolve(pair.generationRoot, 'control.json'),
    value: { ...pair.control, instanceId: `${'2'.repeat(32)}.different-run` },
    label: 'process control secret',
  });
  await assert.rejects(readManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  }), (error) => error.reasonCode === 'PROCESS_STATE_INCONSISTENT');
  await writeJsonAtomically({
    anchor: fixture.context.stateRoot,
    path: resolve(pair.generationRoot, 'control.json'),
    value: pair.control,
    label: 'process control secret',
  });
  const lockPath = resolve(pair.resourceRoot, '.operation.lock');
  await writeFile(lockPath, 'stale\n', { mode: 0o600 });
  await assert.rejects(readManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  }), (error) => error.reasonCode === 'PROCESS_OPERATION_LOCKED');
  await rm(lockPath);
  await rawCleanup(started, pair.control);
});

test('cleanup is marker-bound and does not create absent managed storage', async () => {
  const fixture = await fixtureRepository();
  assert.deepEqual(await readManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  }), { status: 'absent', resourceId: RESOURCE_ID });
  assert.deepEqual(await stopManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  }), { status: 'safe-noop', resourceId: RESOURCE_ID, reasonCode: 'PROCESS_NOT_RECORDED' });
  assert.deepEqual(await recoverManagedProcess({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  }), { status: 'safe-noop', resourceId: RESOURCE_ID, reasonCode: 'PROCESS_NOT_RECORDED' });
  await assert.rejects(stat(resolve(fixture.context.stateRoot, 'processes')), /ENOENT/);

  await ensureStateDirectory(fixture.context, 'processes', 'legacy-app', 'generations');
  assert.deepEqual(await stopManagedProcesses({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
  }), [{ status: 'safe-noop', resourceId: 'legacy-app', reasonCode: 'PROCESS_NOT_RECORDED' }]);

  await mkdir(resolve(fixture.context.stateRoot, 'processes', 'UnsafeName'), { mode: 0o700 });
  await assert.rejects(
    stopManagedProcesses({ stateRoot: fixture.context.stateRoot, repoRoot: fixture.repoRoot }),
    (error) => error.reasonCode === 'PROCESS_STATE_INCONSISTENT',
  );
});

test('state missing, schema drift, and source drift do not orphan an owned process', async () => {
  for (const drift of ['missing', 'schema', 'source']) {
    const fixture = await fixtureRepository();
    const started = await startManagedNode({
      stateRoot: fixture.context.stateRoot,
      repoRoot: fixture.repoRoot,
      resourceId: RESOURCE_ID,
      allowedResourceIds: ALLOWLIST,
      startOptions: await startOptions(fixture, `cleanup-${drift}`),
    });
    liveProcesses.set(started.record.pid, started.record);
    if (drift === 'missing') {
      await rm(fixture.context.statePath);
    } else if (drift === 'schema') {
      const state = JSON.parse(await readFile(fixture.context.statePath, 'utf8'));
      await writeFile(fixture.context.statePath, `${JSON.stringify({ ...state, schemaVersion: 999 })}\n`, { mode: 0o600 });
    } else {
      await writeJsonAtomically({
        anchor: fixture.context.stateRoot,
        path: fixture.context.markerPath,
        value: { ...fixture.context.marker, sourceDigest: 'b'.repeat(64) },
        label: 'state marker',
      });
    }

    const outcomes = await stopManagedProcesses({
      stateRoot: fixture.context.stateRoot,
      repoRoot: fixture.repoRoot,
    });
    assert.equal(outcomes.some(({ status }) => ['stopped', 'safe-noop'].includes(status)), true);
    await waitUntilGone(started.record.pid);
    liveProcesses.delete(started.record.pid);
    const purged = await runCourseLifecycle({
      action: 'purge',
      repoRoot: fixture.repoRoot,
      runId: `purge-${drift}`,
    });
    assert.equal(purged.status, 'pass');
    await assert.rejects(stat(fixture.context.stateRoot), /ENOENT/);
  }
});

test('purge preserves a live child and its tree when control identity cannot be verified', async () => {
  const fixture = await fixtureRepository();
  const started = await startManagedNode({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: await startOptions(fixture, 'missing-control'),
  });
  liveProcesses.set(started.record.pid, started.record);
  const pair = await readCurrentPair(fixture);
  await rm(resolve(pair.generationRoot, 'control.json'));
  await assert.rejects(
    runCourseLifecycle({ action: 'purge', repoRoot: fixture.repoRoot, runId: 'purge-missing-control' }),
    (error) => error.reasonCode === 'PROCESS_STATE_INCONSISTENT',
  );
  assert.equal(isAlive(started.record.pid), true);
  assert.equal((await stat(fixture.context.stateRoot)).isDirectory(), true);
  assert.equal((await stat(pair.generationRoot)).isDirectory(), true);
  await rawCleanup(started, pair.control);
});

test('pre-spawn pending state and partial stop state recover without leaking control material', async () => {
  const pendingFixture = await fixtureRepository();
  const options = await startOptions(pendingFixture, 'pending-purge');
  const session = await spawnManagedWorker({ fixture: pendingFixture, options, pauseBeforeStart: true });
  await waitForCondition(
    () => stat(session.readyPath).then(() => true, () => false),
    'pending purge crash point',
  );
  await killWorker(session.worker);
  const pending = await readGenerationPair(pendingFixture);
  assert.equal(pending.record, null);
  assert.equal(pending.intent.status, 'pending');
  assert.match(pending.control.shutdownToken, /^[A-Za-z0-9_-]{43}$/);
  const purged = await runCourseLifecycle({
    action: 'purge',
    repoRoot: pendingFixture.repoRoot,
    runId: 'purge-pending-active',
  });
  assert.equal(purged.status, 'pass');
  await assert.rejects(stat(pendingFixture.context.stateRoot), /ENOENT/);

  const stoppedFixture = await fixtureRepository();
  const started = await startManagedNode({
    stateRoot: stoppedFixture.context.stateRoot,
    repoRoot: stoppedFixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    startOptions: await startOptions(stoppedFixture, 'partial-stop'),
  });
  liveProcesses.set(started.record.pid, started.record);
  await assert.rejects(stopManagedProcess({
    stateRoot: stoppedFixture.context.stateRoot,
    repoRoot: stoppedFixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
    dependencies: {
      writeJsonAtomically: async (request) => {
        if (request.label === 'process control secret') throw new Error('injected control persistence failure');
        return writeJsonAtomically(request);
      },
    },
  }), (error) => error.reasonCode === 'PROCESS_STOP_PERSIST_FAILED');
  await waitUntilGone(started.record.pid);
  liveProcesses.delete(started.record.pid);
  assert.deepEqual(await readManagedProcess({
    stateRoot: stoppedFixture.context.stateRoot,
    repoRoot: stoppedFixture.repoRoot,
    resourceId: RESOURCE_ID,
    allowedResourceIds: ALLOWLIST,
  }), { status: 'blocked', resourceId: RESOURCE_ID, reasonCode: 'PROCESS_SECRET_RETIREMENT_REQUIRED' });
  await stopManagedProcesses({ stateRoot: stoppedFixture.context.stateRoot, repoRoot: stoppedFixture.repoRoot });
  const retired = await readCurrentPair(stoppedFixture);
  assert.equal(retired.control.status, 'retired');
  assert.equal(retired.control.shutdownToken, null);
});
