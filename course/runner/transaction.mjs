import { randomBytes } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestCanonical } from './canonical.mjs';
import { acquireRecoverableWriteLock, LockStaleError } from './lock.mjs';
import { runWithMutationHooks } from './mutation-context.mjs';
import { assertValidSchema, loadJsonSchema } from './schema.mjs';
import {
  assertNoSymlinkComponents,
  ensureStateDirectory,
  loadStateContext,
  loadStateMarkerContext,
  readSecureJson,
  resolveStatePath,
  StateError,
  StatePathError,
  writeJsonAtomically,
} from './state.mjs';

export const TRANSACTION_DIRECTORY = 'transactions';
export const TRANSACTION_SCHEMA = 'curriculum/schemas/transaction.schema.json';
export const LESSON_01_SETUP_OPERATION = 'lesson:01:setup';

const ATOMIC_TRANSACTION_TEMPORARY_ENTRY = /^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
const OPERATION_ID = /^(?:course:(?:setup|reset|stop)|lesson:(?:setup|0[1-9]|1[0-5]|capstone):(?:setup|check|reset|stop))$/;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MUTATION_ID = /^[a-f0-9]{32}$/;
const PENDING_PHASES = new Set(['begun', 'prepared']);

export class TransactionError extends StateError {
  constructor(message, { cause, reasonCode = 'STATE_INCOMPLETE_TRANSACTION' } = {}) {
    super(message, { cause, reasonCode });
    this.name = 'TransactionError';
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new TransactionError('operation was aborted', { reasonCode: 'TIMEOUT_COMMAND' });
}

async function transactionSchema(context) {
  return loadJsonSchema(resolve(context.repositoryRealpath, TRANSACTION_SCHEMA));
}

function assertTransactionInvariants(value) {
  if (!OPERATION_ID.test(value.operationId) || value.operationId.split(':').at(-1) !== value.command) {
    throw new TransactionError('transaction operationId does not match command');
  }
  if (Date.parse(value.updatedAt) < Date.parse(value.startedAt)) {
    throw new TransactionError('transaction updatedAt predates startedAt');
  }
  if ((value.stateEpochBefore === null) !== (value.stateDigestBefore === null)) {
    throw new TransactionError('transaction before-state identity is incomplete');
  }
  if (value.schemaVersion === 3
      && ['stateDigestAfter', 'mutationId', 'preparedAt'].some((key) => Object.hasOwn(value, key))) {
    throw new TransactionError('legacy transaction contains v4 fields');
  }
  if (value.schemaVersion === 4) {
    if (!MUTATION_ID.test(value.mutationId)) {
      throw new TransactionError('transaction mutationId is invalid');
    }
    if ((value.stateEpochAfter === null) !== (value.stateDigestAfter === null)) {
      throw new TransactionError('transaction after-state identity is incomplete');
    }
    if (value.preparedAt !== null && Date.parse(value.preparedAt) < Date.parse(value.startedAt)) {
      throw new TransactionError('transaction preparedAt predates startedAt');
    }
    if (value.preparedAt !== null && Date.parse(value.updatedAt) < Date.parse(value.preparedAt)) {
      throw new TransactionError('transaction updatedAt predates preparedAt');
    }
    if (value.phase === 'prepared'
        && value.stateEpochBefore === value.stateEpochAfter
        && value.stateDigestBefore === value.stateDigestAfter) {
      throw new TransactionError('prepared transaction must change state identity');
    }
  }
  if (value.phase === 'aborted' && value.recoveredByRunId === value.runId) {
    throw new TransactionError('aborted transaction cannot recover itself');
  }
  if (value.phase === 'aborted' && value.recoveryLockRunId !== null
      && value.recoveryLockRunId === value.recoveredByRunId) {
    throw new TransactionError('recovery lock owner and recovery successor must differ');
  }
  return value;
}

function stateIdentity(state) {
  return {
    epoch: state?.epoch ?? null,
    digest: state ? digestCanonical(state) : null,
  };
}

function transactionBeforeIdentity(transaction) {
  return { epoch: transaction.stateEpochBefore, digest: transaction.stateDigestBefore };
}

function transactionAfterIdentity(transaction) {
  return { epoch: transaction.stateEpochAfter, digest: transaction.stateDigestAfter };
}

function sameIdentity(left, right) {
  return left.epoch === right.epoch && left.digest === right.digest;
}

async function loadCurrentIdentity({ stateRoot, repoRoot }) {
  return stateIdentity((await loadStateContext({ stateRoot, repoRoot })).state);
}

function transactionTimestamp(transaction, timestamp) {
  const requested = timestamp ?? new Date().toISOString();
  const floor = transaction.preparedAt ?? transaction.startedAt;
  return Date.parse(requested) < Date.parse(floor) ? floor : requested;
}

async function reportProgress(transaction, phase, details = {}) {
  if (typeof transaction.onProgress !== 'function') return;
  await transaction.onProgress({
    phase,
    transaction: { ...transaction.value },
    ...details,
  });
}

async function transactionDirectory(context, { create }) {
  if (create) return ensureStateDirectory(context, TRANSACTION_DIRECTORY);
  const path = resolveStatePath(context, TRANSACTION_DIRECTORY);
  const stats = await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: path,
    allowMissingLeaf: true,
    expectedLeaf: 'directory',
    label: 'transaction directory',
  });
  return stats ? path : null;
}

export async function readTransactions(options = {}) {
  const context = await loadStateMarkerContext(options);
  const directory = await transactionDirectory(context, { create: false });
  if (!directory) return [];
  const schema = await transactionSchema(context);
  const transactions = [];
  for (const name of (await readdir(directory)).sort()) {
    if (ATOMIC_TRANSACTION_TEMPORARY_ENTRY.test(name)) {
      const temporaryPath = resolve(directory, name);
      const temporaryStats = await lstat(temporaryPath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!temporaryStats) continue;
      if (temporaryStats.isSymbolicLink() || !temporaryStats.isFile()) {
        throw new StatePathError(`unsafe transaction temporary entry: ${name}`);
      }
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}\.json$/.test(name)) {
      throw new TransactionError(`unexpected transaction entry: ${name}`);
    }
    const path = resolve(directory, name);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new StatePathError(`unsafe transaction entry: ${name}`);
    const value = await readSecureJson({ anchor: context.stateRoot, path, label: `transaction ${name}` });
    try {
      assertValidSchema(value, schema, 'transaction');
      assertTransactionInvariants(value);
    } catch (error) {
      throw new TransactionError(`invalid transaction entry: ${name}`, { cause: error });
    }
    if (value.courseId !== context.marker.courseId || `${value.runId}.json` !== name) {
      throw new TransactionError(`transaction identity mismatch: ${name}`);
    }
    transactions.push(value);
  }
  return transactions;
}

export async function beginTransaction({
  stateRoot,
  repoRoot,
  runId,
  operationId,
  command,
  signal,
  timestamp,
  onProgress,
} = {}) {
  if (typeof runId !== 'string' || !SAFE_RUN_ID.test(runId)) {
    throw new TypeError('runId must be a path-safe identifier');
  }
  if (!['setup', 'check', 'reset', 'stop'].includes(command)) throw new TypeError('unsupported transaction command');
  if (typeof operationId !== 'string' || !OPERATION_ID.test(operationId) || operationId.split(':').at(-1) !== command) {
    throw new TypeError('operationId is invalid');
  }
  throwIfAborted(signal);
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const existing = await readTransactions({ stateRoot, repoRoot });
  const pending = existing.find(({ phase }) => PENDING_PHASES.has(phase));
  if (pending) throw new TransactionError(`run ${pending.runId} did not commit`);
  const directory = await transactionDirectory(context, { create: true });
  let stateEpochBefore = null;
  let stateDigestBefore = null;
  try {
    const current = (await loadStateContext({ stateRoot, repoRoot })).state;
    stateEpochBefore = current?.epoch ?? null;
    stateDigestBefore = current ? digestCanonical(current) : null;
  } catch (error) {
    if (command !== 'stop') throw error;
  }
  const now = timestamp ?? new Date().toISOString();
  const value = {
    $schema: TRANSACTION_SCHEMA,
    schemaVersion: 4,
    runId,
    courseId: context.marker.courseId,
    operationId,
    command,
    phase: 'begun',
    stateEpochBefore,
    stateDigestBefore,
    stateEpochAfter: null,
    stateDigestAfter: null,
    mutationId: randomBytes(16).toString('hex'),
    preparedAt: null,
    recoveryLockRunId: null,
    recoveredByRunId: null,
    recoveryReason: null,
    startedAt: now,
    updatedAt: now,
  };
  assertValidSchema(value, await transactionSchema(context), 'transaction');
  assertTransactionInvariants(value);
  const path = resolve(directory, `${runId}.json`);
  await writeJsonAtomically({ anchor: context.stateRoot, path, value, exclusive: true, label: 'transaction' });
  const transaction = {
    context,
    path,
    value,
    signal,
    timestamp,
    onProgress,
    noopWrite: false,
  };
  try {
    await reportProgress(transaction, 'after-begin');
  } catch (error) {
    if (error && typeof error === 'object') error.transaction = transaction;
    throw error;
  }
  return transaction;
}

export async function commitTransaction(transaction, { stateEpochAfter = null, signal, timestamp } = {}) {
  if (!transaction?.context || !transaction?.path || !PENDING_PHASES.has(transaction.value?.phase)) {
    throw new TypeError('pending transaction is required');
  }
  throwIfAborted(signal);
  const current = await loadCurrentIdentity({
    stateRoot: transaction.context.stateRoot,
    repoRoot: transaction.context.repositoryRealpath,
  });
  const expected = transaction.value.phase === 'prepared'
    ? transactionAfterIdentity(transaction.value)
    : transactionBeforeIdentity(transaction.value);
  if (!sameIdentity(current, expected)) {
    throw new TransactionError('state does not match the transaction commit identity');
  }
  if (stateEpochAfter !== null && stateEpochAfter !== current.epoch) {
    throw new TransactionError('reported commit epoch does not match durable state');
  }
  const now = transactionTimestamp(transaction.value, timestamp);
  const value = {
    ...transaction.value,
    phase: 'committed',
    stateEpochAfter: current.epoch,
    stateDigestAfter: current.digest,
    preparedAt: transaction.value.preparedAt ?? now,
    updatedAt: now,
  };
  assertValidSchema(value, await transactionSchema(transaction.context), 'transaction');
  assertTransactionInvariants(value);
  await writeJsonAtomically({
    anchor: transaction.context.stateRoot,
    path: transaction.path,
    value,
    label: 'transaction',
  });
  transaction.value = value;
  await reportProgress(transaction, 'after-commit');
  return value;
}

async function prepareStateTransition(transaction, { context, before, after }) {
  if (!transaction?.context || transaction.value?.phase !== 'begun') {
    throw new TransactionError('transaction permits exactly one state transition');
  }
  if (context.stateRoot !== transaction.context.stateRoot
      || context.marker.courseId !== transaction.context.marker.courseId
      || context.markerDigest !== transaction.context.markerDigest) {
    throw new TransactionError('state write does not belong to the active transaction');
  }
  const beforeIdentity = stateIdentity(before);
  const afterIdentity = stateIdentity(after);
  if (!sameIdentity(beforeIdentity, transactionBeforeIdentity(transaction.value))) {
    throw new TransactionError('state changed before transaction prepare');
  }
  if (sameIdentity(beforeIdentity, afterIdentity)) {
    transaction.noopWrite = true;
    return;
  }
  const now = transactionTimestamp(transaction.value, transaction.timestamp);
  const value = {
    ...transaction.value,
    phase: 'prepared',
    stateEpochAfter: afterIdentity.epoch,
    stateDigestAfter: afterIdentity.digest,
    preparedAt: now,
    updatedAt: now,
  };
  assertValidSchema(value, await transactionSchema(transaction.context), 'transaction');
  assertTransactionInvariants(value);
  await writeJsonAtomically({
    anchor: transaction.context.stateRoot,
    path: transaction.path,
    value,
    label: 'prepared transaction',
  });
  transaction.value = value;
  await reportProgress(transaction, 'after-prepare');
}

async function markStateApplied(transaction, { context, after }) {
  if (context.stateRoot !== transaction.context.stateRoot
      || context.markerDigest !== transaction.context.markerDigest) {
    throw new TransactionError('applied state does not belong to the active transaction');
  }
  const expected = transaction.value.phase === 'prepared'
    ? transactionAfterIdentity(transaction.value)
    : transactionBeforeIdentity(transaction.value);
  if (transaction.value.phase !== 'prepared' && !transaction.noopWrite) {
    throw new TransactionError('state was applied without durable prepare');
  }
  if (!sameIdentity(stateIdentity(after), expected)) {
    throw new TransactionError('applied state does not match durable prepare');
  }
  await reportProgress(transaction, 'after-state-apply');
}

export function withMutationContext(transaction, callback) {
  if (!transaction?.context || !PENDING_PHASES.has(transaction.value?.phase)) {
    throw new TypeError('pending transaction is required');
  }
  return runWithMutationHooks({
    prepare: (transition) => prepareStateTransition(transaction, transition),
    applied: (transition) => markStateApplied(transaction, transition),
  }, callback);
}

function assertRecoveryRunId(value, name) {
  if (typeof value !== 'string' || !SAFE_RUN_ID.test(value)) {
    throw new TypeError(`${name} must be a path-safe run identifier`);
  }
}

async function assertStateUnchanged(transaction, { stateRoot, repoRoot }) {
  const currentState = (await loadStateContext({ stateRoot, repoRoot })).state;
  const currentEpoch = currentState?.epoch ?? null;
  const currentDigest = currentState ? digestCanonical(currentState) : null;
  if (currentEpoch !== transaction.stateEpochBefore
      || currentDigest !== transaction.stateDigestBefore) {
    throw new TransactionError('state digest or epoch changed after the interrupted transaction began');
  }
}

function recoveryTimestamp(transaction, timestamp) {
  const requested = timestamp ?? new Date().toISOString();
  const floor = transaction.preparedAt ?? transaction.startedAt;
  return Date.parse(requested) < Date.parse(floor)
    ? floor
    : requested;
}

async function writeRecoveredTransaction(context, transaction, {
  recoveryLockRunId,
  recoveredByRunId,
  recoveryReason,
  timestamp,
}) {
  const value = {
    ...transaction,
    phase: 'aborted',
    stateEpochAfter: null,
    ...(transaction.schemaVersion === 4 ? {
      stateDigestAfter: null,
      preparedAt: null,
    } : {}),
    recoveryLockRunId,
    recoveredByRunId,
    recoveryReason,
    updatedAt: recoveryTimestamp(transaction, timestamp),
  };
  assertValidSchema(value, await transactionSchema(context), 'transaction');
  assertTransactionInvariants(value);
  await writeJsonAtomically({
    anchor: context.stateRoot,
    path: resolveStatePath(context, TRANSACTION_DIRECTORY, `${transaction.runId}.json`),
    value,
    label: 'recovered transaction',
  });
  return value;
}

async function writeRolledForwardTransaction(context, transaction, { timestamp } = {}) {
  if (transaction.schemaVersion !== 4 || transaction.phase !== 'prepared') {
    throw new TypeError('prepared v4 transaction is required');
  }
  const value = {
    ...transaction,
    phase: 'committed',
    updatedAt: recoveryTimestamp(transaction, timestamp),
  };
  assertValidSchema(value, await transactionSchema(context), 'transaction');
  assertTransactionInvariants(value);
  await writeJsonAtomically({
    anchor: context.stateRoot,
    path: resolveStatePath(context, TRANSACTION_DIRECTORY, `${transaction.runId}.json`),
    value,
    label: 'rolled-forward transaction',
  });
  return value;
}

async function abortInterruptedTransaction(transaction, {
  stateRoot,
  repoRoot,
  recoveryLockRunId,
  recoveredByRunId,
  recoveryReason,
  signal,
  timestamp,
} = {}) {
  if (!transaction || !PENDING_PHASES.has(transaction.phase)) {
    throw new TypeError('pending transaction is required');
  }
  assertRecoveryRunId(recoveryLockRunId, 'recoveryLockRunId');
  assertRecoveryRunId(recoveredByRunId, 'recoveredByRunId');
  if (recoveredByRunId === transaction.runId) {
    throw new TypeError('recoveredByRunId must identify a different run');
  }
  if (recoveryLockRunId === recoveredByRunId) {
    throw new TypeError('recoveryLockRunId must identify the replaced lock owner');
  }
  if (!['owner-exited', 'pid-reused'].includes(recoveryReason)) {
    throw new TypeError('recoveryReason is invalid');
  }
  throwIfAborted(signal);
  const transactions = await readTransactions({ stateRoot, repoRoot });
  const pending = transactions.filter(({ phase }) => PENDING_PHASES.has(phase));
  if (pending.length !== 1 || pending[0].runId !== transaction.runId) {
    throw new TransactionError('interrupted transaction changed during recovery');
  }
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  let value;
  if (transaction.schemaVersion === 4 && transaction.phase === 'prepared') {
    const current = await loadCurrentIdentity({ stateRoot, repoRoot });
    if (sameIdentity(current, transactionAfterIdentity(transaction))) {
      value = await writeRolledForwardTransaction(context, transaction, { timestamp });
    } else if (sameIdentity(current, transactionBeforeIdentity(transaction))) {
      value = await writeRecoveredTransaction(context, transaction, {
        recoveryLockRunId,
        recoveredByRunId,
        recoveryReason,
        timestamp,
      });
    } else {
      throw new TransactionError('prepared transaction state matches neither pre-state nor post-state');
    }
  } else {
    await assertStateUnchanged(transaction, { stateRoot, repoRoot });
    value = await writeRecoveredTransaction(context, transaction, {
      recoveryLockRunId,
      recoveredByRunId,
      recoveryReason,
      timestamp,
    });
  }
  throwIfAborted(signal);
  return value;
}

async function handoffAbortedTransaction(transaction, {
  stateRoot,
  repoRoot,
  recoveryLockRunId,
  recoveredByRunId,
  recoveryReason,
  signal,
  timestamp,
}) {
  throwIfAborted(signal);
  const transactions = await readTransactions({ stateRoot, repoRoot });
  const current = transactions.find(({ runId }) => runId === transaction.runId);
  if (!current || current.phase !== 'aborted'
      || ![current.runId, current.recoveryLockRunId, current.recoveredByRunId].includes(recoveryLockRunId)) {
    throw new TransactionError('aborted transaction recovery ownership changed');
  }
  if (current.schemaVersion === 3) {
    await assertStateUnchanged(current, { stateRoot, repoRoot });
  }
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const value = await writeRecoveredTransaction(context, current, {
    recoveryLockRunId,
    recoveredByRunId,
    recoveryReason,
    timestamp,
  });
  throwIfAborted(signal);
  return value;
}

async function assertMutationClaimUnchanged(metadata, { stateRoot, repoRoot }) {
  if (metadata.schemaVersion !== 2 || metadata.protocol !== 'mutation-v1') {
    throw new LockStaleError('stale write lock has no recoverable mutation claim');
  }
  if (metadata.stateIdentityStatus === 'unavailable') {
    if (!metadata.operationId.endsWith(':stop')) {
      throw new LockStaleError('only stop may have an unavailable mutation state identity');
    }
    return;
  }
  const current = (await loadStateContext({ stateRoot, repoRoot })).state;
  const currentStatus = current ? 'captured' : 'absent';
  const currentEpoch = current?.epoch ?? null;
  const currentDigest = current ? digestCanonical(current) : null;
  if (currentStatus !== metadata.stateIdentityStatus
      || currentEpoch !== metadata.stateEpochAtClaim
      || currentDigest !== metadata.stateDigestAtClaim) {
    throw new TransactionError('state changed after the mutation lock was claimed');
  }
}

async function assertCommittedStateCompatible(transaction, { stateRoot, repoRoot }) {
  const current = await loadCurrentIdentity({ stateRoot, repoRoot });
  if (transaction.schemaVersion === 4) {
    if (!sameIdentity(current, transactionAfterIdentity(transaction))) {
      throw new TransactionError('state identity changed after the transaction committed');
    }
  } else if (transaction.stateEpochAfter !== null && current.epoch !== transaction.stateEpochAfter) {
    throw new TransactionError('state epoch changed after the transaction committed');
  }
}

async function recoverMutationWriter(options, writer) {
  const { stateRoot, repoRoot, runId, signal, timestamp } = options;
  throwIfAborted(signal);
  const transactions = await readTransactions({ stateRoot, repoRoot });
  const pending = transactions.filter(({ phase }) => PENDING_PHASES.has(phase));
  if (pending.length > 1) {
    throw new TransactionError('multiple interrupted transactions cannot be recovered automatically');
  }

  let recovered;
  if (pending.length === 1) {
    const interrupted = pending[0];
    const legacyLessonSetupHandoff = interrupted.operationId === LESSON_01_SETUP_OPERATION
      && writer.metadata.schemaVersion === 1
      && UUID_V4.test(writer.runId);
    if (interrupted.runId !== writer.runId && !legacyLessonSetupHandoff) {
      throw new LockStaleError('stale write lock does not own the interrupted transaction');
    }
    if (writer.metadata.schemaVersion === 2
        && interrupted.operationId !== writer.metadata.operationId) {
      throw new LockStaleError('mutation lock operation does not match the interrupted transaction');
    }
    recovered = await abortInterruptedTransaction(interrupted, {
      stateRoot,
      repoRoot,
      recoveryLockRunId: writer.runId,
      recoveredByRunId: runId,
      recoveryReason: writer.reason,
      signal,
      timestamp,
    });
  } else {
    const abortedCandidates = transactions.filter((transaction) => transaction.phase === 'aborted'
      && [transaction.runId, transaction.recoveryLockRunId, transaction.recoveredByRunId]
        .includes(writer.runId));
    if (abortedCandidates.length === 1) {
      recovered = await handoffAbortedTransaction(abortedCandidates[0], {
        stateRoot,
        repoRoot,
        recoveryLockRunId: writer.runId,
        recoveredByRunId: runId,
        recoveryReason: writer.reason,
        signal,
        timestamp,
      });
    } else if (abortedCandidates.length > 1) {
      throw new LockStaleError('stale write lock has multiple aborted transaction owners');
    } else {
      const committedCandidates = transactions.filter((transaction) => transaction.phase === 'committed'
        && transaction.runId === writer.runId);
      if (committedCandidates.length === 1) {
        if (writer.metadata.schemaVersion === 2
            && committedCandidates[0].operationId !== writer.metadata.operationId) {
          throw new LockStaleError('mutation lock operation does not match the committed transaction');
        }
        await assertCommittedStateCompatible(committedCandidates[0], { stateRoot, repoRoot });
        recovered = committedCandidates[0];
      } else if (committedCandidates.length > 1) {
        throw new LockStaleError('stale write lock has multiple committed transaction owners');
      } else {
        await assertMutationClaimUnchanged(writer.metadata, { stateRoot, repoRoot });
        return {
          transactionRunId: null,
          operationId: writer.metadata.operationId,
          lockRunId: writer.runId,
          reason: writer.reason,
          phase: 'pre-begin',
        };
      }
    }
  }
  if (typeof options.onProgress === 'function') {
    await options.onProgress({
      phase: 'after-recovery-decision',
      recovered: { ...recovered },
      lockRunId: writer.runId,
    });
  }
  return {
    transactionRunId: recovered.runId,
    operationId: recovered.operationId,
    lockRunId: writer.runId,
    reason: writer.reason,
    phase: recovered.phase,
  };
}

async function finalizeOwnedTransaction(transaction) {
  if (!transaction?.context || !transaction?.value) {
    throw new TypeError('transaction is required');
  }
  const transactions = await readTransactions({
    stateRoot: transaction.context.stateRoot,
    repoRoot: transaction.context.repositoryRealpath,
  });
  const current = transactions.find(({ runId }) => runId === transaction.value.runId);
  if (!current || current.operationId !== transaction.value.operationId
      || (current.schemaVersion === 4 && current.mutationId !== transaction.value.mutationId)) {
    throw new TransactionError('owned transaction changed before lock release');
  }
  transaction.value = current;
  if (!PENDING_PHASES.has(current.phase)) return current;
  if (current.schemaVersion !== 4) {
    throw new TransactionError('legacy pending transaction cannot be finalized by its owner');
  }
  const context = transaction.context;
  let value;
  if (current.phase === 'begun') {
    const currentIdentity = await loadCurrentIdentity({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
    });
    if (!sameIdentity(currentIdentity, transactionBeforeIdentity(current))) {
      throw new TransactionError('begun transaction state changed without durable prepare');
    }
    value = await writeRecoveredTransaction(context, current, {
      recoveryLockRunId: null,
      recoveredByRunId: null,
      recoveryReason: transaction.signal?.aborted ? 'operation-aborted' : 'operation-error',
      timestamp: transaction.timestamp,
    });
  } else {
    const currentIdentity = await loadCurrentIdentity({
      stateRoot: context.stateRoot,
      repoRoot: context.repositoryRealpath,
    });
    if (sameIdentity(currentIdentity, transactionAfterIdentity(current))) {
      value = await writeRolledForwardTransaction(context, current, {
        timestamp: transaction.timestamp,
      });
    } else if (sameIdentity(currentIdentity, transactionBeforeIdentity(current))) {
      value = await writeRecoveredTransaction(context, current, {
        recoveryLockRunId: null,
        recoveredByRunId: null,
        recoveryReason: transaction.signal?.aborted ? 'operation-aborted' : 'operation-error',
        timestamp: transaction.timestamp,
      });
    } else {
      throw new TransactionError('prepared transaction state matches neither pre-state nor post-state');
    }
  }
  transaction.value = value;
  return value;
}

const TRANSACTION_LOCK = Symbol('transactionLock');

export function attachTransactionToLock(lock, transaction) {
  if (!lock || typeof lock.release !== 'function') throw new TypeError('lock is required');
  if (!transaction?.context || !transaction?.value) throw new TypeError('transaction is required');
  if (lock[TRANSACTION_LOCK]) {
    if (lock[TRANSACTION_LOCK] !== transaction) {
      throw new TypeError('lock already protects a different transaction');
    }
    return lock;
  }
  const releaseLock = lock.release.bind(lock);
  let releaseInFlight = null;
  Object.defineProperty(lock, TRANSACTION_LOCK, { value: transaction });
  lock.release = async () => {
    if (releaseInFlight) return releaseInFlight;
    releaseInFlight = (async () => {
      await finalizeOwnedTransaction(transaction);
      return releaseLock();
    })();
    try {
      return await releaseInFlight;
    } finally {
      releaseInFlight = null;
    }
  };
  return lock;
}

export async function beginMutation(options = {}) {
  const { operationId, command } = options;
  const lock = await acquireRecoverableWriteLock({
    ...options,
    mode: 'write',
    mutationOperationId: operationId,
  }, (writer) => recoverMutationWriter(options, writer));
  try {
    const transaction = await beginTransaction({ ...options, operationId, command });
    attachTransactionToLock(lock, transaction);
    return { lock, transaction };
  } catch (error) {
    if (error?.transaction) {
      await finalizeOwnedTransaction(error.transaction).catch(() => {});
    }
    await lock.release().catch(() => {});
    throw error;
  }
}
