import { constants as fsConstants, watch } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { link, lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { canonicalJson, digestCanonical, sha256Hex } from './canonical.mjs';
import { captureProcessStartFingerprint } from './process.mjs';
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

export const LOCK_DIRECTORY = 'locks';
export const WRITE_LOCK_FILE = 'write.lock';
export const READ_LOCK_DIRECTORY = 'readers';
export const PURGE_LOCK_FILE = 'purge.lock';
export const PURGE_RECOVERY_LOCK_FILE = 'purge-recovery.lock';

const LEGACY_LOCK_SCHEMA_VERSION = 1;
const MUTATION_LOCK_SCHEMA_VERSION = 2;
const MUTATION_LOCK_PROTOCOL = 'mutation-v1';
const MUTATION_OPERATION_ID = /^(?:course:(?:setup|reset|stop)|lesson:(?:setup|0[1-9]|1[0-5]|capstone):(?:setup|check|reset|stop))$/;
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const RECOVERY_LEASE_PORT_BASE = 10_000;
const RECOVERY_LEASE_PORT_SPAN = 10_000;

export class LockError extends StateError {
  constructor(message, { cause, reasonCode = 'LOCK_ERROR' } = {}) {
    super(message, { cause, reasonCode });
    this.name = 'LockError';
  }
}

export class LockConflictError extends LockError {
  constructor(message, options = {}) {
    super(message, { reasonCode: 'LOCK_HELD', ...options });
    this.name = 'LockConflictError';
  }
}

export class LockCorruptError extends LockError {
  constructor(message, options = {}) {
    super(message, { reasonCode: 'LOCK_CORRUPT', ...options });
    this.name = 'LockCorruptError';
  }
}

export class LockOwnershipError extends LockError {
  constructor(message, options = {}) {
    super(message, { reasonCode: 'LOCK_OWNERSHIP_MISMATCH', ...options });
    this.name = 'LockOwnershipError';
  }
}

export class LockStaleError extends LockError {
  constructor(message, options = {}) {
    super(message, { reasonCode: 'LOCK_STALE', ...options });
    this.name = 'LockStaleError';
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function stateOptions(options) {
  return {
    stateRoot: options.stateRoot,
    repoRoot: options.repoRoot,
    ...(options.courseId !== undefined ? { courseId: options.courseId } : {}),
    ...(hasOwn(options, 'sourceRevision') ? { sourceRevision: options.sourceRevision } : {}),
    ...(options.sourceDigest !== undefined ? { sourceDigest: options.sourceDigest } : {}),
    ...(options.nodeMajor !== undefined ? { nodeMajor: options.nodeMajor } : {}),
  };
}

async function syncDirectory(path) {
  const handle = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function recoveryLeasePort(context) {
  const identity = `${context.repositoryRealpath}\0${context.marker.courseId}`;
  return RECOVERY_LEASE_PORT_BASE
    + (Number.parseInt(sha256Hex(identity).slice(0, 4), 16) % RECOVERY_LEASE_PORT_SPAN);
}

// Files record operation ownership. This repository/course-scoped listener is
// the crash-released mutex that closes acquisition and purge-deletion windows.
async function acquireRecoveryLease(context, { monitorStateRoot = true, waitForReleaseMs = 0 } = {}) {
  const port = recoveryLeasePort(context);
  const deadline = Date.now() + waitForReleaseMs;
  let server;
  while (!server) {
    const candidate = createServer((socket) => socket.destroy());
    try {
      await new Promise((resolvePromise, rejectPromise) => {
        const onError = (error) => {
          candidate.off('listening', onListening);
          rejectPromise(error);
        };
        const onListening = () => {
          candidate.off('error', onError);
          resolvePromise();
        };
        candidate.once('error', onError);
        candidate.once('listening', onListening);
        candidate.listen({ host: '127.0.0.1', port, exclusive: true });
      });
      server = candidate;
    } catch (error) {
      if (error.code === 'EADDRINUSE' && Date.now() < deadline) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
        continue;
      }
      if (error.code === 'EADDRINUSE') {
        throw new LockConflictError(`purge recovery lease is held on loopback port ${port}`, { cause: error });
      }
      throw new LockError(`cannot acquire purge recovery lease on loopback port ${port}`, {
        cause: error,
        reasonCode: 'LOCK_RECOVERY_LEASE_FAILED',
      });
    }
  }
  server.unref();

  let released = false;
  let stateWatcher = null;
  let removalPoll = null;
  const release = async () => {
    if (released) return false;
    released = true;
    stateWatcher?.close();
    if (removalPoll) clearInterval(removalPoll);
    if (server.listening) {
      await new Promise((resolvePromise) => server.close(resolvePromise));
    }
    return true;
  };
  const releaseIfStateWasRemoved = async () => {
    try {
      await lstat(context.stateRoot);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await release();
        return;
      }
    }
  };
  if (monitorStateRoot) {
    try {
      stateWatcher = watch(context.stateRoot, { persistent: false }, () => {
        void releaseIfStateWasRemoved();
      });
      stateWatcher.on('error', () => {
        void releaseIfStateWasRemoved();
      });
      removalPoll = setInterval(() => {
        void releaseIfStateWasRemoved();
      }, 25);
      removalPoll.unref?.();
    } catch (error) {
      await release();
      throw new LockError('cannot monitor purge recovery lease state root', {
        cause: error,
        reasonCode: 'LOCK_RECOVERY_LEASE_FAILED',
      });
    }
  }
  return { port, release };
}

export async function acquireCourseCoordinationLease({
  repoRoot,
  courseId,
  waitForReleaseMs = 0,
} = {}) {
  if (!repoRoot) throw new TypeError('repoRoot is required');
  if (typeof courseId !== 'string' || courseId.length === 0) {
    throw new TypeError('courseId must be a non-empty string');
  }
  const repositoryRealpath = await realpath(repoRoot);
  return acquireRecoveryLease(
    { repositoryRealpath, marker: { courseId } },
    { monitorStateRoot: false, waitForReleaseMs },
  );
}

export async function acquireStateRecoveryLease(options = {}) {
  const context = await loadStateMarkerContext(stateOptions(options));
  return acquireRecoveryLease(context, { waitForReleaseMs: options.waitForReleaseMs ?? 1_000 });
}

function validateMetadata(metadata, expectedMode, path) {
  const common = metadata
    && typeof metadata === 'object'
    && !Array.isArray(metadata)
    && metadata.mode === expectedMode
    && typeof metadata.runId === 'string'
    && metadata.runId.length > 0
    && Number.isInteger(metadata.pid)
    && metadata.pid > 0
    && typeof metadata.processStartFingerprint === 'string'
    && /^sha256:[a-f0-9]{64}$/.test(metadata.processStartFingerprint)
    && typeof metadata.acquiredAt === 'string'
    && !Number.isNaN(Date.parse(metadata.acquiredAt))
    && typeof metadata.nonce === 'string'
    && /^[a-f0-9]{32}$/.test(metadata.nonce);
  const legacy = common
    && metadata.schemaVersion === LEGACY_LOCK_SCHEMA_VERSION
    && Object.keys(metadata).sort().join(',') === 'acquiredAt,mode,nonce,pid,processStartFingerprint,runId,schemaVersion';
  const mutation = common
    && metadata.schemaVersion === MUTATION_LOCK_SCHEMA_VERSION
    && expectedMode === 'write'
    && Object.keys(metadata).sort().join(',') === 'acquiredAt,mode,nonce,operationId,pid,processStartFingerprint,protocol,runId,schemaVersion,stateDigestAtClaim,stateEpochAtClaim,stateIdentityStatus'
    && metadata.protocol === MUTATION_LOCK_PROTOCOL
    && typeof metadata.operationId === 'string'
    && MUTATION_OPERATION_ID.test(metadata.operationId)
    && ['absent', 'captured', 'unavailable'].includes(metadata.stateIdentityStatus)
    && (metadata.stateEpochAtClaim === null
      || (Number.isSafeInteger(metadata.stateEpochAtClaim) && metadata.stateEpochAtClaim >= 1))
    && (metadata.stateDigestAtClaim === null
      || (typeof metadata.stateDigestAtClaim === 'string'
        && /^[a-f0-9]{64}$/.test(metadata.stateDigestAtClaim)))
    && (metadata.stateIdentityStatus === 'captured'
      ? metadata.stateEpochAtClaim !== null && metadata.stateDigestAtClaim !== null
      : metadata.stateEpochAtClaim === null && metadata.stateDigestAtClaim === null);
  if (!legacy && !mutation) throw new LockCorruptError(`lock metadata is invalid: ${path}`);
  return metadata;
}

function lockProcessInstanceId(context, runId) {
  return `${context.marker.installId}.${sha256Hex(runId)}`;
}

async function captureLockProcessFingerprint(context, pid, runId) {
  try {
    return await captureProcessStartFingerprint(pid, {
      instanceId: lockProcessInstanceId(context, runId),
    });
  } catch (error) {
    throw new LockError(`cannot verify lock owner pid ${pid}`, {
      cause: error,
      reasonCode: 'LOCK_OWNER_UNVERIFIABLE',
    });
  }
}

async function newLockMetadata(context, mode, options) {
  const pid = process.pid;
  const processStartFingerprint = await captureLockProcessFingerprint(context, pid, options.runId);
  if (processStartFingerprint === null) {
    throw new LockError(`cannot capture lock owner pid ${pid}`, {
      reasonCode: 'LOCK_OWNER_UNVERIFIABLE',
    });
  }
  const common = {
    mode,
    runId: options.runId,
    pid,
    processStartFingerprint,
    acquiredAt: options.acquiredAt ?? new Date().toISOString(),
    nonce: options.nonce ?? randomBytes(16).toString('hex'),
  };
  if (options.mutationOperationId === undefined) {
    return { schemaVersion: LEGACY_LOCK_SCHEMA_VERSION, ...common };
  }
  if (mode !== 'write'
      || typeof options.mutationOperationId !== 'string'
      || !MUTATION_OPERATION_ID.test(options.mutationOperationId)) {
    throw new TypeError('mutationOperationId requires a supported write mutation');
  }
  let stateIdentityStatus;
  let stateEpochAtClaim = null;
  let stateDigestAtClaim = null;
  try {
    const state = (await loadStateContext(stateOptions(options))).state;
    stateIdentityStatus = state ? 'captured' : 'absent';
    stateEpochAtClaim = state?.epoch ?? null;
    stateDigestAtClaim = state ? digestCanonical(state) : null;
  } catch (error) {
    if (!options.mutationOperationId.endsWith(':stop')) throw error;
    stateIdentityStatus = 'unavailable';
  }
  return {
    schemaVersion: MUTATION_LOCK_SCHEMA_VERSION,
    ...common,
    protocol: MUTATION_LOCK_PROTOCOL,
    operationId: options.mutationOperationId,
    stateIdentityStatus,
    stateEpochAtClaim,
    stateDigestAtClaim,
  };
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw new LockError(`cannot inspect lock owner pid ${pid}`, { cause: error, reasonCode: 'LOCK_PID_CHECK_FAILED' });
  }
}

async function readLock(context, path, mode) {
  try {
    const metadata = await readSecureJson({ anchor: context.stateRoot, path, label: `${mode} lock` });
    return validateMetadata(metadata, mode, path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof LockError) throw error;
    throw new LockCorruptError(`cannot read ${mode} lock`, { cause: error });
  }
}

async function inspectLock(context, path, mode) {
  const stats = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stats) return { status: 'absent', metadata: null, identity: null };
  if (stats.isSymbolicLink() || !stats.isFile()) throw new StatePathError(`${mode} lock is not a regular file`);
  const metadata = await readLock(context, path, mode);
  if (metadata === null) return { status: 'absent', metadata: null, identity: null };
  if (!processIsAlive(metadata.pid)) return {
    status: 'stale', metadata, identity: stats, staleReason: 'owner-exited',
  };
  const currentFingerprint = await captureLockProcessFingerprint(context, metadata.pid, metadata.runId);
  if (currentFingerprint === null) return {
    status: 'stale', metadata, identity: stats, staleReason: 'owner-exited',
  };
  if (currentFingerprint !== metadata.processStartFingerprint) {
    return { status: 'stale', metadata, identity: stats, staleReason: 'pid-reused' };
  }
  return { status: 'live', metadata, identity: stats, staleReason: null };
}

async function createLockFile(context, path, metadata) {
  await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: resolve(path, '..'),
    expectedLeaf: 'directory',
    label: 'lock directory',
  });
  const temporaryPath = resolveStatePath(
    context,
    LOCK_DIRECTORY,
    `.${randomBytes(16).toString('hex')}.tmp`,
  );
  let handle;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | O_NOFOLLOW,
      0o600,
    );
    await handle.chmod(0o600);
    await handle.writeFile(`${canonicalJson(metadata)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporaryPath, path);
    await syncDirectory(resolve(path, '..'));
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
  }
  await syncDirectory(resolve(temporaryPath, '..'));
}

async function claimExclusive(context, path, metadata) {
  try {
    await createLockFile(context, path, metadata);
    return;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const inspected = await inspectLock(context, path, metadata.mode);
    if (inspected.status === 'stale') {
      throw new LockStaleError(`${metadata.mode} lock was left by dead pid ${inspected.metadata.pid}`);
    }
    if (inspected.status === 'live') {
      throw new LockConflictError(`${metadata.mode} lock is held by pid ${inspected.metadata.pid}`);
    }
    throw new LockConflictError(`${metadata.mode} lock changed while it was inspected`);
  }
}

async function liveReaders(context, readerDirectory) {
  const live = [];
  for (const name of (await readdir(readerDirectory)).sort()) {
    if (!/^[a-f0-9]{64}\.lock$/.test(name)) throw new LockCorruptError(`unexpected reader lock entry: ${name}`);
    const path = resolve(readerDirectory, name);
    const inspected = await inspectLock(context, path, 'read');
    if (inspected.status === 'stale') {
      const confirmed = await inspectLock(context, path, 'read');
      if (confirmed.status !== 'stale'
          || !sameLockIdentity(confirmed.metadata, inspected.metadata)
          || confirmed.identity.dev !== inspected.identity.dev
          || confirmed.identity.ino !== inspected.identity.ino) {
        throw new LockConflictError('stale read lock changed while recovery was claimed');
      }
      const current = await lstat(path).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!current) continue;
      if (!current.isFile()
          || current.dev !== confirmed.identity.dev
          || current.ino !== confirmed.identity.ino) {
        throw new LockConflictError('stale read lock changed before removal');
      }
      await unlink(path);
      await syncDirectory(readerDirectory);
      continue;
    }
    if (inspected.status === 'live') live.push(inspected.metadata);
  }
  return live;
}

async function assertNoPurgeBarrier(context, purgePath, recoveryPath) {
  const recovery = await inspectLock(context, recoveryPath, 'purge-recovery');
  if (recovery.status === 'stale') {
    throw new LockStaleError(`purge recovery lock was left by dead pid ${recovery.metadata.pid}`);
  }
  if (recovery.status === 'live') {
    throw new LockConflictError(`purge recovery lock is held by pid ${recovery.metadata.pid}`);
  }
  const purge = await inspectLock(context, purgePath, 'purge');
  if (purge.status === 'stale') {
    throw new LockStaleError(`purge lock was left by dead pid ${purge.metadata.pid}`);
  }
  if (purge.status === 'live') {
    throw new LockConflictError(`purge lock is held by pid ${purge.metadata.pid}`);
  }
}

function sameLockIdentity(left, right) {
  return left?.nonce === right?.nonce
    && left?.runId === right?.runId
    && left?.pid === right?.pid
    && left?.processStartFingerprint === right?.processStartFingerprint
    && left?.schemaVersion === right?.schemaVersion
    && left?.protocol === right?.protocol
    && left?.operationId === right?.operationId
    && left?.stateIdentityStatus === right?.stateIdentityStatus
    && left?.stateEpochAtClaim === right?.stateEpochAtClaim
    && left?.stateDigestAtClaim === right?.stateDigestAtClaim;
}

async function replaceStaleLock(context, path, expected, metadata) {
  const expectedMetadata = expected.metadata ?? expected;
  const confirmed = await inspectLock(context, path, metadata.mode);
  if (confirmed.status !== 'stale'
      || !sameLockIdentity(confirmed.metadata, expectedMetadata)
      || (expected.identity && (
        confirmed.identity.dev !== expected.identity.dev
        || confirmed.identity.ino !== expected.identity.ino
      ))) {
    throw new LockConflictError(`${metadata.mode} lock changed while recovery was claimed`);
  }
  const current = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!current
      || !current.isFile()
      || current.dev !== confirmed.identity.dev
      || current.ino !== confirmed.identity.ino) {
    throw new LockConflictError(`${metadata.mode} lock changed before recovery replacement`);
  }
  await writeJsonAtomically({
    anchor: context.stateRoot,
    path,
    value: metadata,
    label: `${metadata.mode} lock replacement`,
  });
}

async function releaseOwned(context, path, metadata) {
  const current = await readLock(context, path, metadata.mode);
  if (!current) return false;
  if (current.nonce !== metadata.nonce
      || current.runId !== metadata.runId
      || current.pid !== metadata.pid
      || current.processStartFingerprint !== metadata.processStartFingerprint) {
    throw new LockOwnershipError('refusing to release a lock owned by another run');
  }
  await unlink(path);
  await syncDirectory(resolve(path, '..'));
  return true;
}

async function acquireLockWithContext(options, context, { recoverStaleWriter = null } = {}) {
  const lockDirectory = await ensureStateDirectory(context, LOCK_DIRECTORY);
  const readerDirectory = await ensureStateDirectory(context, LOCK_DIRECTORY, READ_LOCK_DIRECTORY);
  const writerPath = resolveStatePath(context, LOCK_DIRECTORY, WRITE_LOCK_FILE);
  const purgePath = resolveStatePath(context, LOCK_DIRECTORY, PURGE_LOCK_FILE);
  const recoveryPath = resolveStatePath(context, LOCK_DIRECTORY, PURGE_RECOVERY_LOCK_FILE);
  await assertNoPurgeBarrier(context, purgePath, recoveryPath);
  const metadata = await newLockMetadata(context, options.mode, options);
  validateMetadata(metadata, options.mode, '(new lock)');

  let path;
  let recovered = null;
  if (options.mode === 'read') {
    const writer = await inspectLock(context, writerPath, 'write');
    if (writer.status === 'stale') {
      throw new LockStaleError(`write lock was left by dead pid ${writer.metadata.pid}`);
    }
    if (writer.status === 'live') {
      throw new LockConflictError(`write lock is held by pid ${writer.metadata.pid}`);
    }
    path = resolve(readerDirectory, `${sha256Hex(options.runId)}.lock`);
    await claimExclusive(context, path, metadata);
    const writerAfterClaim = await inspectLock(context, writerPath, 'write');
    if (writerAfterClaim.status !== 'absent') {
      await releaseOwned(context, path, metadata);
      if (writerAfterClaim.status === 'stale') {
        throw new LockStaleError(`write lock was left by dead pid ${writerAfterClaim.metadata.pid}`);
      }
      throw new LockConflictError(`write lock is held by pid ${writerAfterClaim.metadata.pid}`);
    }
  } else {
    path = writerPath;
    const existingWriter = recoverStaleWriter
      ? await inspectLock(context, writerPath, 'write')
      : null;
    if (existingWriter?.status === 'stale') {
      recovered = await recoverStaleWriter({
        runId: existingWriter.metadata.runId,
        reason: existingWriter.staleReason,
        metadata: { ...existingWriter.metadata },
        identity: {
          dev: existingWriter.identity.dev,
          ino: existingWriter.identity.ino,
        },
      });
      await replaceStaleLock(context, path, existingWriter, metadata);
    } else {
      await claimExclusive(context, path, metadata);
    }
    try {
      const readers = await liveReaders(context, readerDirectory);
      if (readers.length > 0) {
        throw new LockConflictError(`read lock is held by ${readers.length} live process(es)`);
      }
    } catch (error) {
      await releaseOwned(context, path, metadata);
      throw error;
    }
  }

  try {
    await assertNoPurgeBarrier(context, purgePath, recoveryPath);
  } catch (error) {
    await releaseOwned(context, path, metadata);
    throw error;
  }

  let released = false;
  return {
    mode: options.mode,
    runId: options.runId,
    path,
    metadata: { ...metadata },
    recovered,
    async release() {
      if (released) return false;
      const result = await releaseOwned(context, path, metadata);
      released = true;
      return result;
    },
  };
}

function validateAcquireLockOptions(options) {
  if (!['read', 'write'].includes(options.mode)) throw new TypeError('mode must be read or write');
  if (typeof options.runId !== 'string' || options.runId.length === 0 || options.runId.length > 256) {
    throw new TypeError('runId must be a non-empty string of at most 256 characters');
  }
}

export async function acquireLock(options = {}) {
  validateAcquireLockOptions(options);
  const context = await loadStateMarkerContext(stateOptions(options));
  await assertNoPurgeBarrier(
    context,
    resolveStatePath(context, LOCK_DIRECTORY, PURGE_LOCK_FILE),
    resolveStatePath(context, LOCK_DIRECTORY, PURGE_RECOVERY_LOCK_FILE),
  );
  const coordinationLease = await acquireRecoveryLease(context, { waitForReleaseMs: 1_000 });
  try {
    return await acquireLockWithContext(options, context);
  } finally {
    await coordinationLease.release();
  }
}

export async function acquireRecoverableWriteLock(options = {}, recoverStaleWriter) {
  validateAcquireLockOptions(options);
  if (options.mode !== 'write') throw new TypeError('recoverable lock must use write mode');
  if (typeof recoverStaleWriter !== 'function') throw new TypeError('recoverStaleWriter callback is required');
  const context = await loadStateMarkerContext(stateOptions(options));
  await assertNoPurgeBarrier(
    context,
    resolveStatePath(context, LOCK_DIRECTORY, PURGE_LOCK_FILE),
    resolveStatePath(context, LOCK_DIRECTORY, PURGE_RECOVERY_LOCK_FILE),
  );
  const coordinationLease = await acquireRecoveryLease(context, { waitForReleaseMs: 1_000 });
  try {
    return await acquireLockWithContext(options, context, { recoverStaleWriter });
  } finally {
    await coordinationLease.release();
  }
}

function validateInterruptedLessonSetupOptions(options) {
  if (typeof options.interruptedRunId !== 'string' || options.interruptedRunId.length === 0) {
    throw new TypeError('interruptedRunId is required');
  }
  if (typeof options.stateDigestBefore !== 'string' || !/^[a-f0-9]{64}$/.test(options.stateDigestBefore)) {
    throw new TypeError('stateDigestBefore must be a lowercase SHA-256 digest');
  }
}

async function inspectInterruptedLessonSetup(context, options) {
  const lockDirectory = resolveStatePath(context, LOCK_DIRECTORY);
  const readerDirectory = resolveStatePath(context, LOCK_DIRECTORY, READ_LOCK_DIRECTORY);
  await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: lockDirectory,
    expectedLeaf: 'directory',
    label: 'lock directory',
  });
  await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: readerDirectory,
    expectedLeaf: 'directory',
    label: 'reader lock directory',
  });
  const writerPath = resolveStatePath(context, LOCK_DIRECTORY, WRITE_LOCK_FILE);
  const purgePath = resolveStatePath(context, LOCK_DIRECTORY, PURGE_LOCK_FILE);
  const recoveryPath = resolveStatePath(context, LOCK_DIRECTORY, PURGE_RECOVERY_LOCK_FILE);
  await assertNoPurgeBarrier(context, purgePath, recoveryPath);
  const writer = await inspectLock(context, writerPath, 'write');
  if (writer.status === 'absent') {
    throw new LockStaleError('interrupted lesson setup has no stale write lock');
  }
  if (writer.status === 'live') {
    throw new LockConflictError(`write lock is held by pid ${writer.metadata.pid}`);
  }
  if (writer.metadata.runId !== options.interruptedRunId) {
    throw new LockStaleError('stale write lock does not belong to the interrupted lesson setup');
  }
  const state = (await loadStateContext(stateOptions(options))).state;
  if (!state || digestCanonical(state) !== options.stateDigestBefore) {
    throw new LockStaleError('state changed after the interrupted lesson setup began');
  }
  const readers = await liveReaders(context, readerDirectory);
  if (readers.length > 0) {
    throw new LockConflictError(`read lock is held by ${readers.length} live process(es)`);
  }
  return { writer, writerPath };
}

export async function inspectInterruptedLessonSetupLock(options = {}) {
  validateInterruptedLessonSetupOptions(options);
  const context = await loadStateMarkerContext(stateOptions(options));
  const recoveryLease = await acquireRecoveryLease(context, { waitForReleaseMs: 1_000 });
  try {
    const { writer } = await inspectInterruptedLessonSetup(context, options);
    return { recoverable: true, runId: writer.metadata.runId, reason: writer.staleReason };
  } finally {
    await recoveryLease.release();
  }
}

async function acquirePurgeGuardWithContext(options, context, recoveryLease) {
  await ensureStateDirectory(context, LOCK_DIRECTORY);
  const readerDirectory = await ensureStateDirectory(context, LOCK_DIRECTORY, READ_LOCK_DIRECTORY);
  const purgePath = resolveStatePath(context, LOCK_DIRECTORY, PURGE_LOCK_FILE);
  const recoveryPath = resolveStatePath(context, LOCK_DIRECTORY, PURGE_RECOVERY_LOCK_FILE);
  const writerPath = resolveStatePath(context, LOCK_DIRECTORY, WRITE_LOCK_FILE);
  const existingPurge = await inspectLock(context, purgePath, 'purge');
  const existingRecovery = await inspectLock(context, recoveryPath, 'purge-recovery');
  let metadata;
  let ownsPurgeLock = false;
  let ownsRecoveryLock = false;
  let recoveredStale = false;
  if (existingPurge.status === 'live') {
    throw new LockConflictError(`purge lock is held by pid ${existingPurge.metadata.pid}`);
  }
  if (existingRecovery.status === 'live') {
    throw new LockConflictError(`purge recovery lock is held by pid ${existingRecovery.metadata.pid}`);
  }
  if (existingPurge.status === 'stale' || existingRecovery.status === 'stale') {
    const confirmedPurge = await inspectLock(context, purgePath, 'purge');
    if (existingPurge.status === 'stale'
        ? confirmedPurge.status !== 'stale'
          || !sameLockIdentity(confirmedPurge.metadata, existingPurge.metadata)
        : confirmedPurge.status !== 'absent') {
      throw new LockConflictError('stale purge lock changed while recovery was claimed');
    }
    const confirmedRecovery = await inspectLock(context, recoveryPath, 'purge-recovery');
    if (existingRecovery.status === 'stale'
        ? confirmedRecovery.status !== 'stale'
          || !sameLockIdentity(confirmedRecovery.metadata, existingRecovery.metadata)
        : confirmedRecovery.status !== 'absent') {
      throw new LockConflictError('purge recovery lock changed while recovery was claimed');
    }
    metadata = await newLockMetadata(context, 'purge-recovery', options);
    validateMetadata(metadata, 'purge-recovery', '(new purge recovery lock)');
    if (confirmedRecovery.status === 'stale') {
      await replaceStaleLock(context, recoveryPath, confirmedRecovery.metadata, metadata);
    } else {
      await claimExclusive(context, recoveryPath, metadata);
    }
    ownsRecoveryLock = true;
    recoveredStale = true;
  } else {
    metadata = await newLockMetadata(context, 'purge', options);
    validateMetadata(metadata, 'purge', '(new purge lock)');
    await claimExclusive(context, purgePath, metadata);
    ownsPurgeLock = true;
  }
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      const writer = await inspectLock(context, writerPath, 'write');
      if (writer.status === 'live') throw new LockConflictError(`write lock is held by pid ${writer.metadata.pid}`);
      for (const name of (await readdir(readerDirectory)).sort()) {
        if (!/^[a-f0-9]{64}\.lock$/.test(name)) throw new LockCorruptError(`unexpected reader lock entry: ${name}`);
        const reader = await inspectLock(context, resolve(readerDirectory, name), 'read');
        if (reader.status === 'live') throw new LockConflictError(`read lock is held by pid ${reader.metadata.pid}`);
      }
      if (pass === 0) await new Promise((resolvePromise) => setImmediate(resolvePromise));
    }
  } catch (error) {
    if (ownsPurgeLock) await releaseOwned(context, purgePath, metadata);
    if (ownsRecoveryLock) await releaseOwned(context, recoveryPath, metadata);
    throw error;
  }
  let released = false;
  return {
    path: ownsRecoveryLock ? recoveryPath : purgePath,
    metadata: { ...metadata },
    recoveredStale,
    async release() {
      if (released) return false;
      released = true;
      try {
        const stateRootExists = await lstat(context.stateRoot).then(
          () => true,
          (error) => {
            if (error.code === 'ENOENT') return false;
            throw error;
          },
        );
        if (!stateRootExists) return false;
        let result;
        if (ownsPurgeLock) result = await releaseOwned(context, purgePath, metadata);
        else result = await releaseOwned(context, recoveryPath, metadata);
        return result;
      } finally {
        await recoveryLease.release();
      }
    },
  };
}

export async function acquirePurgeGuard(options = {}) {
  if (typeof options.runId !== 'string' || options.runId.length === 0 || options.runId.length > 256) {
    throw new TypeError('runId must be a non-empty string of at most 256 characters');
  }
  const context = await loadStateMarkerContext(stateOptions(options));
  const recoveryLease = await acquireRecoveryLease(context);
  try {
    return await acquirePurgeGuardWithContext(options, context, recoveryLease);
  } catch (error) {
    await recoveryLease.release();
    throw error;
  }
}
