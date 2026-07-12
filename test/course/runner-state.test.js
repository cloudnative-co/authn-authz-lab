import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmod,
  cp,
  lstat,
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
import { canonicalJson, digestCanonical } from '../../course/runner/canonical.mjs';
import {
  acquireRecoverableWriteLock,
  acquireLock,
  acquirePurgeGuard,
  LockConflictError,
  LockStaleError,
  LOCK_DIRECTORY,
  PURGE_LOCK_FILE,
  PURGE_RECOVERY_LOCK_FILE,
  WRITE_LOCK_FILE,
} from '../../course/runner/lock.mjs';
import {
  appendJournal,
  JOURNAL_APPEND_LOCK,
  JOURNAL_DIRECTORY,
  readJournal,
} from '../../course/runner/journal.mjs';
import { captureProcessStartFingerprint } from '../../course/runner/process.mjs';
import {
  createStateRoot,
  ensureStateDirectory,
  loadStateContext,
  purgeEmptyStateRoot,
  purgeOwnedState,
  resumeOwnedStatePurge,
  STATE_FILE,
  StateDriftError,
  StateIdentityError,
  StatePathError,
  StateSchemaError,
  writeStateAtomically,
} from '../../course/runner/state.mjs';
import {
  beginMutation,
  beginTransaction,
  commitTransaction,
  readTransactions,
  TransactionError,
  withMutationContext,
} from '../../course/runner/transaction.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoots = [];
const SOURCE_DIGEST = 'a'.repeat(64);
const FIXED_TIME = '2026-07-11T00:00:00.000Z';

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRepository() {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-state-'));
  temporaryRoots.push(root);
  await mkdir(resolve(root, 'curriculum/schemas'), { recursive: true });
  for (const name of ['state-marker.schema.json', 'state.schema.json', 'journal.schema.json', 'transaction.schema.json']) {
    await cp(resolve(repositoryRoot, 'curriculum/schemas', name), resolve(root, 'curriculum/schemas', name));
  }
  return root;
}

async function stateContext(overrides = {}) {
  const repoRoot = await fixtureRepository();
  return createStateRoot({
    repoRoot,
    stateRoot: '.lab',
    courseId: 'auth-authz',
    sourceRevision: null,
    sourceDigest: SOURCE_DIGEST,
    installId: '1'.repeat(32),
    createdAt: FIXED_TIME,
    ...overrides,
  });
}

function fixtureState(context, overrides = {}) {
  return {
    $schema: 'curriculum/schemas/state.schema.json',
    schemaVersion: 1,
    courseId: context.marker.courseId,
    installId: context.marker.installId,
    markerDigest: context.markerDigest,
    epoch: 1,
    lifecycle: 'stopped',
    lessons: [],
    resources: [],
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

async function writeTransactionState(context, transaction, updatedAt) {
  return withMutationContext(transaction, async () => {
    const current = await loadStateContext({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
    });
    return writeStateAtomically({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      state: { ...current.state, updatedAt },
    });
  });
}

async function spawnPausedPurge(context, phase) {
  const lockModuleUrl = pathToFileURL(resolve(repositoryRoot, 'course/runner/lock.mjs')).href;
  const stateModuleUrl = pathToFileURL(resolve(repositoryRoot, 'course/runner/state.mjs')).href;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { acquirePurgeGuard } from ${JSON.stringify(lockModuleUrl)};
    import { purgeOwnedState } from ${JSON.stringify(stateModuleUrl)};
    await acquirePurgeGuard({
      stateRoot: ${JSON.stringify(context.stateRoot)},
      repoRoot: ${JSON.stringify(context.repositoryRealpath)},
      courseId: 'auth-authz',
      runId: ${JSON.stringify(`pause-${phase}`)},
    });
    await purgeOwnedState({
      stateRoot: ${JSON.stringify(context.stateRoot)},
      repoRoot: ${JSON.stringify(context.repositoryRealpath)},
      courseId: 'auth-authz',
      installId: ${JSON.stringify(context.marker.installId)},
      onProgress: async ({ phase: currentPhase }) => {
        if (currentPhase !== ${JSON.stringify(phase)}) return;
        process.stdout.write(currentPhase + '\\n');
        setInterval(() => {}, 1_000);
        await new Promise(() => {});
      },
    });
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code, signal]) => {
      throw new Error(`purge child exited before ${phase}: code=${code}, signal=${signal}`);
    }),
  ]);
  return child;
}

async function killHard(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill('SIGKILL');
  await exit;
}

async function spawnPausedMutation(context, phase) {
  const lockModuleUrl = pathToFileURL(resolve(repositoryRoot, 'course/runner/lock.mjs')).href;
  const transactionModuleUrl = pathToFileURL(resolve(repositoryRoot, 'course/runner/transaction.mjs')).href;
  const stateModuleUrl = pathToFileURL(resolve(repositoryRoot, 'course/runner/state.mjs')).href;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { acquireRecoverableWriteLock } from ${JSON.stringify(lockModuleUrl)};
    import { beginMutation, commitTransaction, withMutationContext } from ${JSON.stringify(transactionModuleUrl)};
    import { loadStateContext, writeStateAtomically } from ${JSON.stringify(stateModuleUrl)};
    const target = ${JSON.stringify(phase)};
    const pause = async (currentPhase) => {
      const expected = target === 'post-commit' ? 'after-commit' : target;
      if (currentPhase !== expected) return;
      process.stdout.write(currentPhase + '\\n');
      setInterval(() => {}, 1_000);
      await new Promise(() => {});
    };
    const common = {
      stateRoot: ${JSON.stringify(context.stateRoot)},
      repoRoot: ${JSON.stringify(context.repositoryRealpath)},
      runId: ${JSON.stringify(`hard-crash-${phase}`)},
      operationId: 'course:reset',
      command: 'reset',
      timestamp: ${JSON.stringify(FIXED_TIME)},
      onProgress: ({ phase: currentPhase }) => pause(currentPhase),
    };
    if (target === 'pre-begin') {
      await acquireRecoverableWriteLock({
        ...common,
        mode: 'write',
        mutationOperationId: common.operationId,
      }, () => { throw new Error('unexpected stale writer'); });
    } else {
      const mutation = await beginMutation(common);
      if (['after-prepare', 'after-state-apply'].includes(target)) {
        await withMutationContext(mutation.transaction, async () => {
          const context = await loadStateContext(common);
          await writeStateAtomically({
            ...common,
            state: {
              ...context.state,
              updatedAt: '2026-07-11T00:00:01.000Z',
            },
          });
        });
      } else if (target === 'post-commit') {
        await commitTransaction(mutation.transaction, {
          stateEpochAfter: 1,
          timestamp: ${JSON.stringify(FIXED_TIME)},
        });
      }
    }
    process.stdout.write(${JSON.stringify('MUTATION_PAUSED\n')});
    setInterval(() => {}, 1_000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(chunk));
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code, signal]) => {
      throw new Error(`mutation child exited before ${phase}: code=${code}, signal=${signal} ${Buffer.concat(errors)}`);
    }),
  ]);
  return child;
}

async function spawnPausedMutationRecovery(context) {
  const transactionModuleUrl = pathToFileURL(resolve(repositoryRoot, 'course/runner/transaction.mjs')).href;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { beginMutation } from ${JSON.stringify(transactionModuleUrl)};
    await beginMutation({
      stateRoot: ${JSON.stringify(context.stateRoot)},
      repoRoot: ${JSON.stringify(context.repositoryRealpath)},
      runId: 'hard-crash-recovery-owner',
      operationId: 'course:reset',
      command: 'reset',
      timestamp: ${JSON.stringify(FIXED_TIME)},
      onProgress: async ({ phase }) => {
        if (phase !== 'after-recovery-decision') return;
        process.stdout.write(phase + '\\n');
        setInterval(() => {}, 1_000);
        await new Promise(() => {});
      },
    });
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(chunk));
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code, signal]) => {
      throw new Error(`recovery child exited before decision: code=${code}, signal=${signal} ${Buffer.concat(errors)}`);
    }),
  ]);
  return child;
}

function fixtureJournal(runId, overrides = {}) {
  return {
    runId,
    courseId: 'auth-authz',
    lessonId: '01',
    command: 'check',
    lockMode: 'write',
    resourceIds: ['process:project-app'],
    status: 'pass',
    evidenceId: null,
    timestamp: FIXED_TIME,
    ...overrides,
  };
}

test('createStateRoot writes a private repository-bound marker and is idempotent', async () => {
  const context = await stateContext();
  assert.equal(context.marker.repositoryRealpath, context.repositoryRealpath);
  assert.equal(context.marker.sourceDigest, SOURCE_DIGEST);
  assert.equal(context.marker.sourceRevision, null);
  assert.equal(context.marker.installId, '1'.repeat(32));
  assert.equal((await stat(context.stateRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(context.markerPath)).mode & 0o777, 0o600);

  const again = await createStateRoot({
    repoRoot: context.repositoryRealpath,
    stateRoot: '.lab',
    courseId: 'auth-authz',
    sourceRevision: null,
    sourceDigest: SOURCE_DIGEST,
    installId: 'f'.repeat(32),
  });
  assert.equal(again.marker.installId, context.marker.installId);
});

test('state paths stay below the repository and reject every symlink component', async () => {
  const repoRoot = await fixtureRepository();
  await assert.rejects(
    createStateRoot({
      repoRoot,
      stateRoot: resolve(repoRoot, '..', 'escape'),
      courseId: 'auth-authz',
      sourceDigest: SOURCE_DIGEST,
    }),
    StatePathError,
  );
  await assert.rejects(
    createStateRoot({ repoRoot, stateRoot: '.', courseId: 'auth-authz', sourceDigest: SOURCE_DIGEST }),
    StatePathError,
  );

  const outside = await mkdtemp(resolve(tmpdir(), 'auth-authz-outside-'));
  temporaryRoots.push(outside);
  await symlink(outside, resolve(repoRoot, 'linked'));
  await assert.rejects(
    createStateRoot({ repoRoot, stateRoot: 'linked/.lab', courseId: 'auth-authz', sourceDigest: SOURCE_DIGEST }),
    StatePathError,
  );
});

test('state and source/schema drift fail closed while reset advances the epoch', async () => {
  const context = await stateContext();
  const first = await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    sourceRevision: null,
    sourceDigest: SOURCE_DIGEST,
    state: fixtureState(context),
  });
  assert.equal(first.state.epoch, 1);
  assert.equal((await stat(resolve(context.stateRoot, STATE_FILE))).mode & 0o777, 0o600);

  const reset = await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    sourceRevision: null,
    sourceDigest: SOURCE_DIGEST,
    state: first.state,
    incrementEpoch: true,
  });
  assert.equal(reset.state.epoch, 2);
  await assert.rejects(
    writeStateAtomically({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      state: { ...reset.state, epoch: 1 },
    }),
    (error) => error instanceof StateDriftError && error.reasonCode === 'STATE_EPOCH_DRIFT',
  );
  await assert.rejects(
    writeStateAtomically({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      state: { ...reset.state, epoch: 3 },
    }),
    (error) => error instanceof StateDriftError && error.reasonCode === 'STATE_EPOCH_DRIFT',
  );
  await assert.rejects(
    loadStateContext({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      courseId: 'auth-authz',
      sourceRevision: null,
      sourceDigest: 'b'.repeat(64),
    }),
    StateDriftError,
  );
});

test('schema drift, insecure permissions, and state-file symlinks are rejected', async () => {
  const schemaContext = await stateContext();
  const marker = JSON.parse(await readFile(schemaContext.markerPath, 'utf8'));
  await writeFile(schemaContext.markerPath, `${canonicalJson({ ...marker, schemaVersion: 2 })}\n`);
  await assert.rejects(
    loadStateContext({ stateRoot: schemaContext.stateRoot, repoRoot: schemaContext.repositoryRealpath }),
    StateSchemaError,
  );

  const permissionContext = await stateContext({ installId: '2'.repeat(32) });
  await chmod(permissionContext.stateRoot, 0o755);
  await assert.rejects(
    loadStateContext({ stateRoot: permissionContext.stateRoot, repoRoot: permissionContext.repositoryRealpath }),
    StatePathError,
  );

  const symlinkContext = await stateContext({ installId: '3'.repeat(32) });
  const outside = resolve(symlinkContext.repositoryRealpath, 'outside-state.json');
  await writeFile(outside, '{}\n');
  await symlink(outside, symlinkContext.statePath);
  await assert.rejects(
    loadStateContext({ stateRoot: symlinkContext.stateRoot, repoRoot: symlinkContext.repositoryRealpath }),
    StatePathError,
  );
});

test('read locks coexist, live locks are never stolen, and writers exclude readers', async () => {
  const context = await stateContext();
  const [firstReader, secondReader] = await Promise.all([
    acquireLock({ stateRoot: context.stateRoot, mode: 'read', runId: 'reader-1' }),
    acquireLock({ stateRoot: context.stateRoot, mode: 'read', runId: 'reader-2' }),
  ]);
  await assert.rejects(
    acquireLock({ stateRoot: context.stateRoot, mode: 'write', runId: 'writer-blocked' }),
    LockConflictError,
  );
  assert.equal((await lstat(firstReader.path)).isFile(), true);
  assert.equal(await firstReader.release(), true);
  assert.equal(await firstReader.release(), false);
  await secondReader.release();

  const writer = await acquireLock({ stateRoot: context.stateRoot, mode: 'write', runId: 'writer-live' });
  const original = await readFile(writer.path, 'utf8');
  await assert.rejects(
    acquireLock({ stateRoot: context.stateRoot, mode: 'write', runId: 'writer-other' }),
    LockConflictError,
  );
  await assert.rejects(
    acquireLock({ stateRoot: context.stateRoot, mode: 'read', runId: 'reader-blocked' }),
    LockConflictError,
  );
  assert.equal(await readFile(writer.path, 'utf8'), original);
  await writer.release();
});

test('a dead reader is reclaimed once and concurrent writers never remove a live replacement', async () => {
  const context = await stateContext();
  const staleReader = await acquireLock({
    stateRoot: context.stateRoot,
    mode: 'read',
    runId: 'reader-that-crashed',
  });
  const staleMetadata = JSON.parse(await readFile(staleReader.path, 'utf8'));
  await writeFile(staleReader.path, `${canonicalJson({
    ...staleMetadata,
    processStartFingerprint: `sha256:${'0'.repeat(64)}`,
  })}\n`, { mode: 0o600 });

  const attempts = await Promise.allSettled([
    acquireLock({ stateRoot: context.stateRoot, mode: 'write', runId: 'writer-after-reader-crash-1' }),
    acquireLock({ stateRoot: context.stateRoot, mode: 'write', runId: 'writer-after-reader-crash-2' }),
  ]);
  const acquired = attempts.filter(({ status }) => status === 'fulfilled');
  const rejected = attempts.filter(({ status }) => status === 'rejected');
  assert.equal(acquired.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason instanceof LockConflictError, true);
  await assert.rejects(lstat(staleReader.path), /ENOENT/);
  assert.equal((await lstat(acquired[0].value.path)).isFile(), true);
  assert.equal(await staleReader.release(), false);
  await acquired[0].value.release();
});

test('dead locks fail closed while an explicit purge guard can recover owned state', async () => {
  const context = await stateContext();
  const reader = await acquireLock({ stateRoot: context.stateRoot, mode: 'read', runId: 'prepare-directories' });
  assert.match(reader.metadata.processStartFingerprint, /^sha256:[a-f0-9]{64}$/);
  await reader.release();
  const writerPath = resolve(context.stateRoot, LOCK_DIRECTORY, WRITE_LOCK_FILE);

  const reusedPidWriter = await acquireLock({
    stateRoot: context.stateRoot,
    mode: 'write',
    runId: 'pid-reuse-owner',
  });
  const reusedPidMetadata = JSON.parse(await readFile(reusedPidWriter.path, 'utf8'));
  await writeFile(reusedPidWriter.path, `${canonicalJson({
    ...reusedPidMetadata,
    processStartFingerprint: `sha256:${'f'.repeat(64)}`,
  })}\n`, { mode: 0o600 });
  await assert.rejects(
    acquireLock({ stateRoot: context.stateRoot, mode: 'write', runId: 'pid-reuse-contender' }),
    LockStaleError,
  );
  await assert.rejects(reusedPidWriter.release(), (error) => error.reasonCode === 'LOCK_OWNERSHIP_MISMATCH');
  await rm(reusedPidWriter.path);

  await writeFile(writerPath, `${canonicalJson({
    schemaVersion: 1,
    mode: 'write',
    runId: 'dead-run',
    pid: 2_147_483_647,
    processStartFingerprint: `sha256:${'0'.repeat(64)}`,
    acquiredAt: FIXED_TIME,
    nonce: '4'.repeat(32),
  })}\n`, { mode: 0o600 });
  await assert.rejects(
    acquireLock({ stateRoot: context.stateRoot, mode: 'write', runId: 'must-not-steal' }),
    LockStaleError,
  );
  const purgeGuard = await acquirePurgeGuard({ stateRoot: context.stateRoot, runId: 'purge-recovery' });
  assert.equal(purgeGuard.metadata.pid, process.pid);
  assert.equal(purgeGuard.recoveredStale, false);
  await purgeGuard.release();
  await rm(writerPath);

  const stalePurgePath = resolve(context.stateRoot, LOCK_DIRECTORY, PURGE_LOCK_FILE);
  await writeFile(stalePurgePath, `${canonicalJson({
    schemaVersion: 1,
    mode: 'purge',
    runId: 'crashed-purge',
    pid: 2_147_483_647,
    processStartFingerprint: `sha256:${'0'.repeat(64)}`,
    acquiredAt: FIXED_TIME,
    nonce: '5'.repeat(32),
  })}\n`, { mode: 0o600 });
  const recoveryAttempts = await Promise.allSettled([
    acquirePurgeGuard({ stateRoot: context.stateRoot, runId: 'purge-after-crash-1' }),
    acquirePurgeGuard({ stateRoot: context.stateRoot, runId: 'purge-after-crash-2' }),
  ]);
  const recovered = recoveryAttempts.filter(({ status }) => status === 'fulfilled');
  const rejected = recoveryAttempts.filter(({ status }) => status === 'rejected');
  assert.equal(recovered.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason instanceof LockConflictError, true);
  const recoveredPurgeGuard = recovered[0].value;
  assert.equal(recoveredPurgeGuard.recoveredStale, true);
  assert.equal(recoveredPurgeGuard.metadata.pid, process.pid);
  assert.equal(
    recoveredPurgeGuard.path,
    resolve(context.stateRoot, LOCK_DIRECTORY, PURGE_RECOVERY_LOCK_FILE),
  );
  await assert.rejects(
    acquireLock({ stateRoot: context.stateRoot, mode: 'read', runId: 'blocked-by-purge-recovery' }),
    LockConflictError,
  );
  await assert.rejects(
    acquirePurgeGuard({ stateRoot: context.stateRoot, runId: 'second-purge-recovery' }),
    LockConflictError,
  );
  assert.equal(await recoveredPurgeGuard.release(), true);
  assert.equal((await lstat(stalePurgePath)).isFile(), true);
  await assert.rejects(
    lstat(resolve(context.stateRoot, LOCK_DIRECTORY, PURGE_RECOVERY_LOCK_FILE)),
    /ENOENT/,
  );

  await rm(stalePurgePath);

  await writeFile(writerPath, '{"pid":"unknown"}\n', { mode: 0o600 });
  await assert.rejects(
    acquireLock({ stateRoot: context.stateRoot, mode: 'write', runId: 'must-fail' }),
    (error) => error.reasonCode === 'LOCK_CORRUPT',
  );
});

test('purge recovery reclaims a stale recovery-only barrier after SIGKILL with one parallel owner', async () => {
  const context = await stateContext();
  const reader = await acquireLock({
    stateRoot: context.stateRoot,
    mode: 'read',
    runId: 'prepare-recovery-crash-directories',
  });
  await reader.release();

  const stalePurgePath = resolve(context.stateRoot, LOCK_DIRECTORY, PURGE_LOCK_FILE);
  const recoveryPath = resolve(context.stateRoot, LOCK_DIRECTORY, PURGE_RECOVERY_LOCK_FILE);
  await writeFile(stalePurgePath, `${canonicalJson({
    schemaVersion: 1,
    mode: 'purge',
    runId: 'purge-crash-before-original-barrier-removal',
    pid: 2_147_483_647,
    processStartFingerprint: `sha256:${'0'.repeat(64)}`,
    acquiredAt: FIXED_TIME,
    nonce: '7'.repeat(32),
  })}\n`, { mode: 0o600 });

  const lockModuleUrl = pathToFileURL(resolve(repositoryRoot, 'course/runner/lock.mjs')).href;
  const crashRecovery = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { unlink } from 'node:fs/promises';
    import { acquirePurgeGuard } from ${JSON.stringify(lockModuleUrl)};
    await acquirePurgeGuard({
      stateRoot: ${JSON.stringify(context.stateRoot)},
      runId: 'crash-after-original-purge-barrier-removal',
    });
    await unlink(${JSON.stringify(stalePurgePath)});
    process.stdout.write('PURGE_LOCK_REMOVED\\n');
    setInterval(() => {}, 1_000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let attempts = [];
  try {
    await Promise.race([
      once(crashRecovery.stdout, 'data'),
      once(crashRecovery, 'exit').then(([code, signal]) => {
        throw new Error(`recovery child exited before crash point: code=${code}, signal=${signal}`);
      }),
    ]);
    await assert.rejects(lstat(stalePurgePath), /ENOENT/);
    assert.equal((await lstat(recoveryPath)).isFile(), true);
    await assert.rejects(
      acquirePurgeGuard({ stateRoot: context.stateRoot, runId: 'blocked-by-live-recovery-only-barrier' }),
      LockConflictError,
    );

    const crashExit = once(crashRecovery, 'exit');
    crashRecovery.kill('SIGKILL');
    const [exitCode, exitSignal] = await crashExit;
    assert.equal(exitCode, null);
    assert.equal(exitSignal, 'SIGKILL');
    const staleRecovery = JSON.parse(await readFile(recoveryPath, 'utf8'));
    assert.equal(staleRecovery.mode, 'purge-recovery');
    assert.equal(staleRecovery.pid, crashRecovery.pid);

    attempts = await Promise.allSettled([
      acquirePurgeGuard({ stateRoot: context.stateRoot, runId: 'recover-recovery-only-1' }),
      acquirePurgeGuard({ stateRoot: context.stateRoot, runId: 'recover-recovery-only-2' }),
    ]);
    const recovered = attempts.filter(({ status }) => status === 'fulfilled');
    const rejected = attempts.filter(({ status }) => status === 'rejected');
    assert.equal(recovered.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason instanceof LockConflictError, true);
    assert.equal(recovered[0].value.recoveredStale, true);
    assert.equal(recovered[0].value.path, recoveryPath);
    await assert.rejects(
      acquireLock({ stateRoot: context.stateRoot, mode: 'read', runId: 'blocked-after-recovery-replacement' }),
      LockConflictError,
    );
    assert.equal(await recovered[0].value.release(), true);
    await assert.rejects(lstat(stalePurgePath), /ENOENT/);
    await assert.rejects(lstat(recoveryPath), /ENOENT/);
  } finally {
    if (crashRecovery.exitCode === null && crashRecovery.signalCode === null) {
      const crashExit = once(crashRecovery, 'exit');
      crashRecovery.kill('SIGKILL');
      await crashExit;
    }
    for (const attempt of attempts) {
      if (attempt.status === 'fulfilled') await attempt.value.release().catch(() => {});
    }
  }
});

test('quarantined purge blocks state recreation and both final crash points resume', async () => {
  const beforeMarker = await stateContext();
  const barrierCrash = await spawnPausedPurge(beforeMarker, 'before-marker-removal');
  const beforeQuarantine = `${beforeMarker.stateRoot}.purge-${beforeMarker.marker.installId}`;
  try {
    await assert.rejects(lstat(beforeMarker.stateRoot), /ENOENT/);
    assert.equal((await lstat(resolve(beforeQuarantine, 'marker.json'))).isFile(), true);
    await assert.rejects(
      createStateRoot({
        repoRoot: beforeMarker.repositoryRealpath,
        courseId: 'auth-authz',
        sourceDigest: SOURCE_DIGEST,
      }),
      (error) => error.reasonCode === 'STATE_PURGE_RECOVERY_REQUIRED',
    );
  } finally {
    await killHard(barrierCrash);
  }
  assert.deepEqual(await resumeOwnedStatePurge({
    stateRoot: beforeMarker.stateRoot,
    repoRoot: beforeMarker.repositoryRealpath,
    courseId: 'auth-authz',
  }), { purged: true, installId: beforeMarker.marker.installId });
  await assert.rejects(lstat(beforeQuarantine), /ENOENT/);

  const afterMarker = await stateContext();
  const markerCrash = await spawnPausedPurge(afterMarker, 'after-marker-removal');
  const afterQuarantine = `${afterMarker.stateRoot}.purge-${afterMarker.marker.installId}`;
  try {
    await assert.rejects(lstat(afterMarker.stateRoot), /ENOENT/);
    assert.deepEqual(await readdir(afterQuarantine), []);
  } finally {
    await killHard(markerCrash);
  }
  assert.deepEqual(
    await resumeOwnedStatePurge({
      stateRoot: afterMarker.stateRoot,
      repoRoot: afterMarker.repositoryRealpath,
      courseId: 'auth-authz',
    }),
    { purged: true, installId: afterMarker.marker.installId },
  );
  await assert.rejects(lstat(afterQuarantine), /ENOENT/);
});

test('purge resumes after a mid-tree crash and never follows a swapped symlink outside quarantine', async () => {
  const interrupted = await stateContext();
  const evidence = await ensureStateDirectory(interrupted, 'evidence', 'epoch-000001');
  await writeFile(resolve(evidence, 'evidence-1.json'), '{}\n', { mode: 0o600 });
  await assert.rejects(purgeOwnedState({
    stateRoot: interrupted.stateRoot,
    repoRoot: interrupted.repositoryRealpath,
    courseId: 'auth-authz',
    installId: interrupted.marker.installId,
    onProgress: ({ phase, entry }) => {
      if (phase === 'after-entry-removal' && entry === 'evidence') throw new Error('simulated crash');
    },
  }), /simulated crash/);
  await assert.rejects(lstat(interrupted.stateRoot), /ENOENT/);
  assert.deepEqual(await resumeOwnedStatePurge({
    stateRoot: interrupted.stateRoot,
    repoRoot: interrupted.repositoryRealpath,
    courseId: 'auth-authz',
  }), { purged: true, installId: interrupted.marker.installId });

  const swapped = await stateContext();
  await ensureStateDirectory(swapped, 'logs');
  const outside = resolve(swapped.repositoryRealpath, 'outside-protected.txt');
  await writeFile(outside, 'preserve outside\n', { mode: 0o600 });
  let swappedOnce = false;
  const result = await purgeOwnedState({
    stateRoot: swapped.stateRoot,
    repoRoot: swapped.repositoryRealpath,
    courseId: 'auth-authz',
    installId: swapped.marker.installId,
    onProgress: async ({ phase, entry, quarantineRoot }) => {
      if (phase !== 'before-entry-removal' || entry !== 'logs' || swappedOnce) return;
      swappedOnce = true;
      await rm(resolve(quarantineRoot, 'logs'), { recursive: true });
      await symlink(outside, resolve(quarantineRoot, 'logs'));
    },
  });
  assert.equal(result.purged, true);
  assert.equal(swappedOnce, true);
  assert.equal(await readFile(outside, 'utf8'), 'preserve outside\n');
});

test('journal entries use contiguous atomic files and concurrent appends serialize safely', async () => {
  const context = await stateContext();
  assert.deepEqual(await readJournal({ stateRoot: context.stateRoot }), []);
  await assert.rejects(lstat(resolve(context.stateRoot, 'journal')), /ENOENT/);
  const writes = await Promise.all(Array.from({ length: 8 }, (_, index) => appendJournal({
    stateRoot: context.stateRoot,
    entry: fixtureJournal(`run-${index + 1}`),
  })));
  assert.equal(new Set(writes.map(({ entry }) => entry.sequence)).size, 8);
  const entries = await readJournal({ stateRoot: context.stateRoot });
  assert.deepEqual(entries.map(({ sequence }) => sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const { path } of writes) {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.match(await readFile(path, 'utf8'), /\n$/);
  }

  const appendLockPath = resolve(context.stateRoot, JOURNAL_DIRECTORY, JOURNAL_APPEND_LOCK);
  await writeFile(appendLockPath, `${canonicalJson({
    pid: process.pid,
    processStartFingerprint: `sha256:${'0'.repeat(64)}`,
    acquiredAt: FIXED_TIME,
    nonce: '6'.repeat(32),
  })}\n`, { mode: 0o600 });
  const recoveredWrites = await Promise.all([
    appendJournal({
      stateRoot: context.stateRoot,
      entry: fixtureJournal('pid-reuse-recovered-1'),
    }),
    appendJournal({
      stateRoot: context.stateRoot,
      entry: fixtureJournal('pid-reuse-recovered-2'),
    }),
  ]);
  assert.equal(recoveredWrites.length, 2);
  assert.deepEqual(
    (await readJournal({ stateRoot: context.stateRoot })).map(({ sequence }) => sequence),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  await assert.rejects(lstat(appendLockPath), /ENOENT/);

  const liveNonce = '7'.repeat(32);
  const liveLock = {
    pid: process.pid,
    processStartFingerprint: await captureProcessStartFingerprint(process.pid, {
      instanceId: `${context.marker.installId}.${liveNonce}`,
    }),
    acquiredAt: FIXED_TIME,
    nonce: liveNonce,
  };
  await writeFile(appendLockPath, `${canonicalJson(liveLock)}\n`, { mode: 0o600 });
  await assert.rejects(appendJournal({
    stateRoot: context.stateRoot,
    entry: fixtureJournal('live-owner-must-not-be-stolen'),
    appendLockTimeoutMs: 20,
  }), (error) => error.reasonCode === 'LOCK_HELD');
  assert.equal(await readFile(appendLockPath, 'utf8'), `${canonicalJson(liveLock)}\n`);
  await rm(appendLockPath);
});

test('mutation WAL exposes interrupted work and records commit epochs', async () => {
  const context = await stateContext();
  await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    state: fixtureState(context),
  });
  const begun = await beginTransaction({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'wal-run-1',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  });
  assert.equal((await readTransactions({ stateRoot: context.stateRoot }))[0].phase, 'begun');
  assert.equal(begun.value.schemaVersion, 4);
  assert.equal(begun.value.operationId, 'course:reset');
  assert.match(begun.value.stateDigestBefore, /^[a-f0-9]{64}$/);
  await assert.rejects(
    beginTransaction({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      runId: 'wal-run-2',
      operationId: 'course:reset',
      command: 'reset',
      timestamp: FIXED_TIME,
    }),
    TransactionError,
  );
  await commitTransaction(begun, { stateEpochAfter: 1, timestamp: FIXED_TIME });
  const [committed] = await readTransactions({ stateRoot: context.stateRoot });
  assert.equal(committed.phase, 'committed');
  assert.equal(committed.stateEpochBefore, 1);
  assert.equal(committed.stateEpochAfter, 1);

  const transactionDirectory = resolve(context.stateRoot, 'transactions');
  const temporaryName = '.00000000-0000-4000-8000-000000000001.tmp';
  const temporaryPath = resolve(transactionDirectory, temporaryName);
  await writeFile(temporaryPath, 'incomplete atomic replacement\n', { mode: 0o600 });
  assert.equal((await readTransactions({ stateRoot: context.stateRoot })).length, 1);
  await rm(temporaryPath);

  await symlink(begun.path, temporaryPath);
  await assert.rejects(
    readTransactions({ stateRoot: context.stateRoot }),
    (error) => error instanceof StatePathError && /temporary entry/.test(error.message),
  );
  await rm(temporaryPath);

  await mkdir(temporaryPath);
  await assert.rejects(
    readTransactions({ stateRoot: context.stateRoot }),
    (error) => error instanceof StatePathError && /temporary entry/.test(error.message),
  );
  await rm(temporaryPath, { recursive: true });

  const lookalikePath = resolve(transactionDirectory, '.00000000-0000-0000-0000-000000000001.tmp');
  await writeFile(lookalikePath, 'not a writer-generated UUID\n', { mode: 0o600 });
  await assert.rejects(
    readTransactions({ stateRoot: context.stateRoot }),
    (error) => error instanceof TransactionError && /unexpected transaction entry/.test(error.message),
  );
  await rm(lookalikePath);
});

test('transaction recovery has one owner and rejects operation-command mismatch', async () => {
  const context = await stateContext();
  await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    state: fixtureState(context),
  });
  await assert.rejects(
    beginTransaction({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      runId: 'mismatched-operation',
      operationId: 'lesson:02:check',
      command: 'setup',
      timestamp: FIXED_TIME,
    }),
    /operationId is invalid/,
  );

  const invalidContext = await stateContext({ installId: '8'.repeat(32) });
  await writeStateAtomically({
    stateRoot: invalidContext.stateRoot,
    repoRoot: invalidContext.repositoryRealpath,
    state: fixtureState(invalidContext),
  });
  const invalid = await beginTransaction({
    stateRoot: invalidContext.stateRoot,
    repoRoot: invalidContext.repositoryRealpath,
    runId: 'schema-operation-mismatch',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  });
  await writeFile(invalid.path, `${canonicalJson({
    ...invalid.value,
    operationId: 'lesson:02:check',
  })}\n`, { mode: 0o600 });
  await assert.rejects(
    readTransactions({ stateRoot: invalidContext.stateRoot }),
    TransactionError,
  );

  const interruptedRunId = 'interrupted-setup-owner';
  const stale = await acquireLock({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    mode: 'write',
    runId: interruptedRunId,
  });
  const interrupted = await beginTransaction({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: interruptedRunId,
    operationId: 'lesson:01:setup',
    command: 'setup',
    timestamp: FIXED_TIME,
  });
  const staleMetadata = JSON.parse(await readFile(stale.path, 'utf8'));
  await writeFile(stale.path, `${canonicalJson({
    ...staleMetadata,
    processStartFingerprint: `sha256:${'f'.repeat(64)}`,
  })}\n`, { mode: 0o600 });

  const attempts = await Promise.allSettled(['recovery-owner-one', 'recovery-owner-two'].map((runId) => (
    beginMutation({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      runId,
      operationId: 'lesson:01:setup',
      command: 'setup',
      timestamp: FIXED_TIME,
    })
  )));
  const winners = attempts.filter(({ status }) => status === 'fulfilled');
  const losers = attempts.filter(({ status }) => status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.reasonCode, 'LOCK_HELD');
  const winner = winners[0].value;
  const aborted = (await readTransactions({ stateRoot: context.stateRoot }))
    .find(({ runId }) => runId === interrupted.value.runId);
  assert.equal(aborted.phase, 'aborted');
  assert.equal(aborted.recoveryLockRunId, interruptedRunId);
  assert.equal(aborted.recoveredByRunId, winner.lock.runId);
  assert.notEqual(aborted.recoveredByRunId, aborted.runId);
  await winner.lock.release();
});

test('non-setup transaction recovery remains resumable across repeated recovery crashes', async () => {
  const context = await stateContext();
  await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    state: fixtureState(context),
  });
  const interruptedRunId = 'interrupted-course-reset';
  const interruptedLock = await acquireLock({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    mode: 'write',
    runId: interruptedRunId,
  });
  await beginTransaction({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: interruptedRunId,
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  });

  const makeOwnerStale = async (lock, fingerprintCharacter) => {
    const metadata = JSON.parse(await readFile(lock.path, 'utf8'));
    await writeFile(lock.path, `${canonicalJson({
      ...metadata,
      processStartFingerprint: `sha256:${fingerprintCharacter.repeat(64)}`,
    })}\n`, { mode: 0o600 });
  };
  await makeOwnerStale(interruptedLock, 'a');

  const firstRecovery = await beginMutation({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'reset-recovery-one',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  });
  let transaction = (await readTransactions({ stateRoot: context.stateRoot }))
    .find(({ runId }) => runId === interruptedRunId);
  assert.equal(transaction.phase, 'aborted');
  assert.equal(transaction.recoveryLockRunId, interruptedRunId);
  assert.equal(transaction.recoveredByRunId, firstRecovery.lock.runId);

  await makeOwnerStale(firstRecovery.lock, 'b');
  const secondRecovery = await beginMutation({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'reset-recovery-two',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  });
  transaction = (await readTransactions({ stateRoot: context.stateRoot }))
    .find(({ runId }) => runId === firstRecovery.lock.runId);
  assert.equal(transaction.phase, 'aborted');
  assert.equal(transaction.recoveryLockRunId, firstRecovery.lock.runId);
  assert.equal(transaction.recoveredByRunId, secondRecovery.lock.runId);

  await makeOwnerStale(secondRecovery.lock, 'c');
  const thirdRecovery = await beginMutation({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'reset-recovery-three',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  });
  transaction = (await readTransactions({ stateRoot: context.stateRoot }))
    .find(({ runId }) => runId === secondRecovery.lock.runId);
  assert.equal(transaction.phase, 'aborted');
  assert.equal(transaction.recoveryLockRunId, secondRecovery.lock.runId);
  assert.equal(transaction.recoveredByRunId, thirdRecovery.lock.runId);
  assert.equal((await lstat(thirdRecovery.lock.path)).isFile(), true);
  await thirdRecovery.lock.release();
  assert.equal(await interruptedLock.release(), false);
});

test('mutation claim recovers a pre-begin crash but never replaces its live owner', async () => {
  const context = await stateContext();
  await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    state: fixtureState(context),
  });
  const claimed = await acquireRecoverableWriteLock({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    mode: 'write',
    runId: 'crash-before-transaction-begin',
    mutationOperationId: 'course:reset',
  }, () => {
    throw new Error('a fresh mutation claim must not invoke recovery');
  });
  assert.equal(claimed.metadata.schemaVersion, 2);
  assert.equal(claimed.metadata.protocol, 'mutation-v1');
  assert.equal(claimed.metadata.stateIdentityStatus, 'captured');
  const liveBytes = await readFile(claimed.path, 'utf8');
  await assert.rejects(beginMutation({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'must-not-replace-live-claim',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  }), LockConflictError);
  assert.equal(await readFile(claimed.path, 'utf8'), liveBytes);

  const staleMetadata = JSON.parse(liveBytes);
  await writeFile(claimed.path, `${canonicalJson({
    ...staleMetadata,
    processStartFingerprint: `sha256:${'d'.repeat(64)}`,
  })}\n`, { mode: 0o600 });
  const recovered = await beginMutation({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'recovered-before-transaction-begin',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  });
  assert.equal(recovered.lock.recovered.phase, 'pre-begin');
  assert.equal(recovered.lock.recovered.lockRunId, claimed.runId);
  assert.equal(recovered.transaction.value.phase, 'begun');
  await commitTransaction(recovered.transaction, { stateEpochAfter: 1, timestamp: FIXED_TIME });
  await recovered.lock.release();
  assert.equal(await claimed.release(), false);
});

test('a committed mutation is recoverable when its owner crashes before lock release', async () => {
  const context = await stateContext();
  await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    state: fixtureState(context),
  });
  const committedOwner = await beginMutation({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'committed-before-lock-release',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  });
  await commitTransaction(committedOwner.transaction, { stateEpochAfter: 1, timestamp: FIXED_TIME });
  const committedLock = JSON.parse(await readFile(committedOwner.lock.path, 'utf8'));
  await writeFile(committedOwner.lock.path, `${canonicalJson({
    ...committedLock,
    processStartFingerprint: `sha256:${'e'.repeat(64)}`,
  })}\n`, { mode: 0o600 });

  const recovered = await beginMutation({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'after-committed-owner-crash',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  });
  assert.equal(recovered.lock.recovered.phase, 'committed');
  assert.equal(recovered.lock.recovered.transactionRunId, committedOwner.transaction.value.runId);
  await commitTransaction(recovered.transaction, { stateEpochAfter: 1, timestamp: FIXED_TIME });
  await recovered.lock.release();
  assert.equal(await committedOwner.lock.release(), false);
});

test('hard crashes at pre-begin and post-commit boundaries recover without stealing a live owner', async () => {
  for (const phase of ['pre-begin', 'post-commit']) {
    const context = await stateContext();
    await writeStateAtomically({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      state: fixtureState(context),
    });
    const child = await spawnPausedMutation(context, phase);
    const writerPath = resolve(context.stateRoot, LOCK_DIRECTORY, WRITE_LOCK_FILE);
    try {
      const liveBytes = await readFile(writerPath, 'utf8');
      await assert.rejects(beginMutation({
        stateRoot: context.stateRoot,
        repoRoot: context.repositoryRealpath,
        runId: `live-contender-${phase}`,
        operationId: 'course:reset',
        command: 'reset',
        timestamp: FIXED_TIME,
      }), LockConflictError);
      assert.equal(await readFile(writerPath, 'utf8'), liveBytes);

      await killHard(child);
      const recovered = await beginMutation({
        stateRoot: context.stateRoot,
        repoRoot: context.repositoryRealpath,
        runId: `after-hard-crash-${phase}`,
        operationId: 'course:reset',
        command: 'reset',
        timestamp: FIXED_TIME,
      });
      assert.equal(recovered.lock.recovered.phase, phase === 'pre-begin' ? 'pre-begin' : 'committed');
      await commitTransaction(recovered.transaction, { stateEpochAfter: 1, timestamp: FIXED_TIME });
      await recovered.lock.release();
    } finally {
      await killHard(child);
    }
  }
});

test('normal errors and abort signals finalize WAL before releasing the mutation lock', async () => {
  const scenarios = [
    { name: 'before-state', faultPhase: null, expectedPhase: 'aborted', expectedUpdatedAt: FIXED_TIME },
    {
      name: 'after-prepare',
      faultPhase: 'after-prepare',
      expectedPhase: 'aborted',
      writeUpdatedAt: '2026-07-11T00:00:02.000Z',
      expectedUpdatedAt: FIXED_TIME,
    },
    {
      name: 'after-state-apply',
      faultPhase: 'after-state-apply',
      expectedPhase: 'committed',
      writeUpdatedAt: '2026-07-11T00:00:03.000Z',
      expectedUpdatedAt: '2026-07-11T00:00:03.000Z',
    },
  ];
  for (const scenario of scenarios) {
    const context = await stateContext();
    await writeStateAtomically({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      state: fixtureState(context),
    });
    const mutation = await beginMutation({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      runId: `normal-error-${scenario.name}`,
      operationId: 'course:reset',
      command: 'reset',
      timestamp: FIXED_TIME,
      onProgress: ({ phase }) => {
        if (phase === scenario.faultPhase) throw new Error(`fault at ${phase}`);
      },
    });
    if (scenario.faultPhase) {
      await assert.rejects(
        writeTransactionState(context, mutation.transaction, scenario.writeUpdatedAt),
        new RegExp(`fault at ${scenario.faultPhase}`),
      );
    } else {
      await assert.rejects(
        withMutationContext(mutation.transaction, async () => { throw new Error('ordinary callback failure'); }),
        /ordinary callback failure/,
      );
    }
    assert.equal(await mutation.lock.release(), true);
    const finished = (await readTransactions({ stateRoot: context.stateRoot }))
      .find(({ runId }) => runId === mutation.transaction.value.runId);
    assert.equal(finished.phase, scenario.expectedPhase);
    assert.equal((await loadStateContext({ stateRoot: context.stateRoot })).state.updatedAt, scenario.expectedUpdatedAt);

    const next = await beginMutation({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      runId: `after-normal-error-${scenario.name}`,
      operationId: 'course:reset',
      command: 'reset',
      timestamp: FIXED_TIME,
    });
    await commitTransaction(next.transaction, { stateEpochAfter: 1, timestamp: FIXED_TIME });
    await next.lock.release();
  }

  const context = await stateContext();
  await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    state: fixtureState(context),
  });
  const controller = new AbortController();
  const mutation = await beginMutation({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'signal-aborted-operation',
    operationId: 'course:reset',
    command: 'reset',
    signal: controller.signal,
    timestamp: FIXED_TIME,
  });
  controller.abort(new Error('received SIGINT'));
  await mutation.lock.release();
  const aborted = (await readTransactions({ stateRoot: context.stateRoot }))
    .find(({ runId }) => runId === mutation.transaction.value.runId);
  assert.equal(aborted.phase, 'aborted');
  assert.equal(aborted.recoveryReason, 'operation-aborted');
});

test('hard crashes after begin, prepare, and state apply recover by exact state identity', async () => {
  for (const phase of ['after-begin', 'after-prepare', 'after-state-apply']) {
    const context = await stateContext();
    await writeStateAtomically({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      state: fixtureState(context),
    });
    const beforeDigest = digestCanonical((await loadStateContext({ stateRoot: context.stateRoot })).state);
    const child = await spawnPausedMutation(context, phase);
    const writerPath = resolve(context.stateRoot, LOCK_DIRECTORY, WRITE_LOCK_FILE);
    try {
      const liveBytes = await readFile(writerPath, 'utf8');
      await assert.rejects(beginMutation({
        stateRoot: context.stateRoot,
        repoRoot: context.repositoryRealpath,
        runId: `live-owner-contender-${phase}`,
        operationId: 'course:reset',
        command: 'reset',
        timestamp: FIXED_TIME,
      }), LockConflictError);
      assert.equal(await readFile(writerPath, 'utf8'), liveBytes);

      const interrupted = (await readTransactions({ stateRoot: context.stateRoot }))
        .find(({ runId }) => runId === `hard-crash-${phase}`);
      assert.equal(interrupted.phase, phase === 'after-begin' ? 'begun' : 'prepared');
      await killHard(child);
      const recovered = await beginMutation({
        stateRoot: context.stateRoot,
        repoRoot: context.repositoryRealpath,
        runId: `identity-recovery-${phase}`,
        operationId: 'course:reset',
        command: 'reset',
        timestamp: FIXED_TIME,
      });
      assert.equal(
        recovered.lock.recovered.phase,
        phase === 'after-state-apply' ? 'committed' : 'aborted',
      );
      const current = (await loadStateContext({ stateRoot: context.stateRoot })).state;
      assert.equal(
        digestCanonical(current) === beforeDigest,
        phase !== 'after-state-apply',
      );
      await commitTransaction(recovered.transaction, { stateEpochAfter: 1, timestamp: FIXED_TIME });
      await recovered.lock.release();
    } finally {
      await killHard(child);
    }
  }
});

test('roll-forward recovery remains resumable when recovery itself hard-crashes', async () => {
  const context = await stateContext();
  await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    state: fixtureState(context),
  });
  const interrupted = await spawnPausedMutation(context, 'after-state-apply');
  await killHard(interrupted);
  const recovering = await spawnPausedMutationRecovery(context);
  try {
    const rolledForward = (await readTransactions({ stateRoot: context.stateRoot }))
      .find(({ runId }) => runId === 'hard-crash-after-state-apply');
    assert.equal(rolledForward.phase, 'committed');
    await killHard(recovering);
    const resumed = await beginMutation({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      runId: 'after-recovery-hard-crash',
      operationId: 'course:reset',
      command: 'reset',
      timestamp: FIXED_TIME,
    });
    assert.equal(resumed.lock.recovered.phase, 'committed');
    assert.equal(resumed.lock.recovered.transactionRunId, 'hard-crash-after-state-apply');
    await commitTransaction(resumed.transaction, { stateEpochAfter: 1, timestamp: FIXED_TIME });
    await resumed.lock.release();
  } finally {
    await killHard(recovering);
  }
});

test('ambiguous prepared state fails closed and preserves the stale owner lock', async () => {
  const context = await stateContext();
  await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    state: fixtureState(context),
  });
  const mutation = await beginMutation({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'ambiguous-prepared-owner',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
    onProgress: ({ phase }) => {
      if (phase === 'after-prepare') throw new Error('stop before state apply');
    },
  });
  await assert.rejects(
    writeTransactionState(context, mutation.transaction, '2026-07-11T00:00:04.000Z'),
    /stop before state apply/,
  );
  const current = (await loadStateContext({ stateRoot: context.stateRoot })).state;
  await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    state: { ...current, updatedAt: '2026-07-11T00:00:05.000Z' },
  });
  const staleMetadata = JSON.parse(await readFile(mutation.lock.path, 'utf8'));
  await writeFile(mutation.lock.path, `${canonicalJson({
    ...staleMetadata,
    processStartFingerprint: `sha256:${'9'.repeat(64)}`,
  })}\n`, { mode: 0o600 });
  const staleBytes = await readFile(mutation.lock.path, 'utf8');
  await assert.rejects(mutation.lock.release(), TransactionError);
  await assert.rejects(beginMutation({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'must-not-guess-ambiguous-state',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  }), TransactionError);
  assert.equal(await readFile(mutation.lock.path, 'utf8'), staleBytes);
});

test('begun WAL never hides an unprepared state change for its owner or stale recovery', async () => {
  for (const recovery of ['same-owner', 'stale-owner']) {
    const context = await stateContext();
    await writeStateAtomically({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      state: fixtureState(context),
    });
    const mutation = await beginMutation({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      runId: `unprepared-change-${recovery}`,
      operationId: 'course:reset',
      command: 'reset',
      timestamp: FIXED_TIME,
    });
    const current = (await loadStateContext({ stateRoot: context.stateRoot })).state;
    await writeStateAtomically({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      state: { ...current, updatedAt: '2026-07-11T00:00:06.000Z' },
    });
    if (recovery === 'stale-owner') {
      const metadata = JSON.parse(await readFile(mutation.lock.path, 'utf8'));
      await writeFile(mutation.lock.path, `${canonicalJson({
        ...metadata,
        processStartFingerprint: `sha256:${'7'.repeat(64)}`,
      })}\n`, { mode: 0o600 });
    }
    const lockBytes = await readFile(mutation.lock.path, 'utf8');
    if (recovery === 'same-owner') {
      await assert.rejects(
        mutation.lock.release(),
        (error) => error instanceof TransactionError && /without durable prepare/.test(error.message),
      );
    } else {
      await assert.rejects(beginMutation({
        stateRoot: context.stateRoot,
        repoRoot: context.repositoryRealpath,
        runId: 'must-not-recover-unprepared-change',
        operationId: 'course:reset',
        command: 'reset',
        timestamp: FIXED_TIME,
      }), (error) => error instanceof TransactionError && /changed after/.test(error.message));
    }
    assert.equal(await readFile(mutation.lock.path, 'utf8'), lockBytes);
    const unfinished = (await readTransactions({ stateRoot: context.stateRoot }))
      .find(({ runId }) => runId === mutation.transaction.value.runId);
    assert.equal(unfinished.phase, 'begun');
  }
});

test('existing v3 begun transactions remain recoverable', async () => {
  const context = await stateContext();
  await writeStateAtomically({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    state: fixtureState(context),
  });
  const owner = await acquireLock({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    mode: 'write',
    runId: 'legacy-v3-owner',
  });
  const transaction = await beginTransaction({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'legacy-v3-owner',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  });
  const { stateDigestAfter, mutationId, preparedAt, ...legacy } = transaction.value;
  await writeFile(transaction.path, `${canonicalJson({ ...legacy, schemaVersion: 3 })}\n`, { mode: 0o600 });
  const ownerMetadata = JSON.parse(await readFile(owner.path, 'utf8'));
  await writeFile(owner.path, `${canonicalJson({
    ...ownerMetadata,
    processStartFingerprint: `sha256:${'8'.repeat(64)}`,
  })}\n`, { mode: 0o600 });
  const recovered = await beginMutation({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    runId: 'after-legacy-v3-owner',
    operationId: 'course:reset',
    command: 'reset',
    timestamp: FIXED_TIME,
  });
  assert.equal(recovered.lock.recovered.phase, 'aborted');
  const legacyFinished = (await readTransactions({ stateRoot: context.stateRoot }))
    .find(({ runId }) => runId === 'legacy-v3-owner');
  assert.equal(legacyFinished.schemaVersion, 3);
  assert.equal(legacyFinished.phase, 'aborted');
  await commitTransaction(recovered.transaction, { stateEpochAfter: 1, timestamp: FIXED_TIME });
  await recovered.lock.release();
});

test('purge removes only an identity-matched, symlink-free owned state root', async () => {
  const context = await stateContext();
  await assert.rejects(
    purgeOwnedState({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      courseId: 'auth-authz',
      installId: 'f'.repeat(32),
      sourceRevision: null,
      sourceDigest: SOURCE_DIGEST,
    }),
    StateIdentityError,
  );
  assert.equal((await stat(context.stateRoot)).isDirectory(), true);

  const unsafeTarget = resolve(context.repositoryRealpath, 'not-owned.txt');
  await writeFile(unsafeTarget, 'keep\n');
  await symlink(unsafeTarget, resolve(context.stateRoot, 'unsafe-link'));
  await assert.rejects(
    purgeOwnedState({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      courseId: 'auth-authz',
      installId: context.marker.installId,
      sourceRevision: null,
      sourceDigest: SOURCE_DIGEST,
    }),
    StatePathError,
  );
  assert.equal(await readFile(unsafeTarget, 'utf8'), 'keep\n');
  await rm(resolve(context.stateRoot, 'unsafe-link'));

  const unknown = resolve(context.stateRoot, 'learner-notes.txt');
  await writeFile(unknown, 'keep this too\n');
  await assert.rejects(
    purgeOwnedState({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
      courseId: 'auth-authz',
      installId: context.marker.installId,
    }),
    /unknown state entry/,
  );
  assert.equal(await readFile(unknown, 'utf8'), 'keep this too\n');
  await rm(unknown);

  const result = await purgeOwnedState({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    courseId: 'auth-authz',
    installId: context.marker.installId,
    sourceRevision: null,
    sourceDigest: SOURCE_DIGEST,
  });
  assert.deepEqual(result, { purged: true, installId: context.marker.installId });
  await assert.rejects(stat(context.stateRoot), /ENOENT/);

  const drifted = await stateContext({ installId: '5'.repeat(32) });
  await writeStateAtomically({
    stateRoot: drifted.stateRoot,
    repoRoot: drifted.repositoryRealpath,
    state: fixtureState(drifted),
  });
  await writeFile(drifted.statePath, `${canonicalJson({ ...fixtureState(drifted), schemaVersion: 999 })}\n`);
  const recoveryLock = await acquireLock({
    stateRoot: drifted.stateRoot,
    repoRoot: drifted.repositoryRealpath,
    courseId: 'auth-authz',
    mode: 'write',
    runId: 'schema-recovery',
  });
  await recoveryLock.release();
  const recovered = await purgeOwnedState({
    stateRoot: drifted.stateRoot,
    repoRoot: drifted.repositoryRealpath,
    courseId: 'auth-authz',
    installId: drifted.marker.installId,
    sourceRevision: 'f'.repeat(40),
    sourceDigest: 'b'.repeat(64),
  });
  assert.equal(recovered.purged, true);
  await assert.rejects(stat(drifted.stateRoot), /ENOENT/);
});

test('purge rejects unknown owned-subtree entries and nested symlinks before deleting anything', async () => {
  const cases = [
    { directory: ['logs'], name: 'my-notes.txt' },
    { directory: ['logs'], name: 'my-notes.stdout.log' },
    { directory: ['journal'], name: 'my-notes.txt' },
    { directory: ['transactions'], name: 'my-notes.txt' },
    { directory: ['evidence', 'epoch-000001'], name: 'my-notes.txt' },
    { directory: ['submissions', '01'], name: 'my-notes.txt' },
    { directory: ['processes'], name: 'my-notes.txt' },
  ];
  for (const fixture of cases) {
    const context = await stateContext();
    const directory = await ensureStateDirectory(context, ...fixture.directory);
    const unknown = resolve(directory, fixture.name);
    await writeFile(unknown, 'preserve\n', { mode: 0o600 });
    await assert.rejects(
      purgeOwnedState({
        stateRoot: context.stateRoot,
        repoRoot: context.repositoryRealpath,
        courseId: 'auth-authz',
        installId: context.marker.installId,
      }),
      StatePathError,
    );
    assert.equal(await readFile(unknown, 'utf8'), 'preserve\n');
    assert.equal((await stat(context.markerPath)).isFile(), true);
  }

  const symlinkContext = await stateContext();
  const evidence = await ensureStateDirectory(symlinkContext, 'evidence', 'epoch-000001');
  const outside = resolve(symlinkContext.repositoryRealpath, 'outside-evidence.json');
  await writeFile(outside, 'preserve outside\n', { mode: 0o600 });
  await symlink(outside, resolve(evidence, 'evidence-link.json'));
  await assert.rejects(
    purgeOwnedState({
      stateRoot: symlinkContext.stateRoot,
      repoRoot: symlinkContext.repositoryRealpath,
      courseId: 'auth-authz',
      installId: symlinkContext.marker.installId,
    }),
    StatePathError,
  );
  assert.equal(await readFile(outside, 'utf8'), 'preserve outside\n');
  assert.equal((await stat(symlinkContext.markerPath)).isFile(), true);
});
