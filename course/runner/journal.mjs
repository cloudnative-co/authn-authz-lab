import { constants as fsConstants } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { link, lstat, open, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalJson } from './canonical.mjs';
import { acquireStateRecoveryLease } from './lock.mjs';
import { captureProcessStartFingerprint } from './process.mjs';
import { assertValidSchema, loadJsonSchema } from './schema.mjs';
import {
  assertNoSymlinkComponents,
  ensureStateDirectory,
  loadStateMarkerContext,
  readSecureJson,
  resolveStatePath,
  StateError,
  StatePathError,
  writeJsonAtomically,
} from './state.mjs';

export const JOURNAL_DIRECTORY = 'journal';
export const JOURNAL_SCHEMA = 'curriculum/schemas/journal.schema.json';
export const JOURNAL_APPEND_LOCK = '.append.lock';

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const TEMPORARY_ENTRY = /^\.[0-9a-f-]{36}\.tmp$/;
const JOURNAL_ENTRY = /^(\d{12})\.json$/;

export class JournalError extends StateError {
  constructor(message, { cause, reasonCode = 'STATE_JOURNAL_ERROR' } = {}) {
    super(message, { cause, reasonCode });
    this.name = 'JournalError';
  }
}

export class JournalSchemaError extends JournalError {
  constructor(message, options = {}) {
    super(message, { reasonCode: 'STATE_JOURNAL_SCHEMA_DRIFT', ...options });
    this.name = 'JournalSchemaError';
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

async function journalSchema(context) {
  const path = resolve(context.repositoryRealpath, JOURNAL_SCHEMA);
  await assertNoSymlinkComponents({
    anchor: context.repositoryRealpath,
    target: path,
    expectedLeaf: 'file',
    label: 'journal schema',
  });
  try {
    return await loadJsonSchema(path);
  } catch (error) {
    throw new JournalSchemaError('journal schema cannot be loaded', { cause: error });
  }
}

function assertJournalEntry(entry, schema, context) {
  try {
    assertValidSchema(entry, schema, 'journal entry');
  } catch (error) {
    throw new JournalSchemaError('journal entry does not match the current schema', { cause: error });
  }
  if (entry.courseId !== context.marker.courseId) {
    throw new JournalSchemaError('journal entry belongs to another course');
  }
  return entry;
}

function validateAppendLock(value) {
  const valid = value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'acquiredAt,nonce,pid,processStartFingerprint'
    && Number.isInteger(value.pid)
    && value.pid > 0
    && typeof value.processStartFingerprint === 'string'
    && /^sha256:[a-f0-9]{64}$/.test(value.processStartFingerprint)
    && typeof value.nonce === 'string'
    && /^[a-f0-9]{32}$/.test(value.nonce)
    && typeof value.acquiredAt === 'string'
    && !Number.isNaN(Date.parse(value.acquiredAt));
  if (!valid) throw new JournalError('journal append lock is corrupt', { reasonCode: 'LOCK_CORRUPT' });
  return value;
}

function appendLockInstanceId(context, nonce) {
  return `${context.marker.installId}.${nonce}`;
}

async function captureAppendLockFingerprint(context, pid, nonce) {
  try {
    return await captureProcessStartFingerprint(pid, {
      instanceId: appendLockInstanceId(context, nonce),
    });
  } catch (error) {
    throw new JournalError(`cannot verify journal lock pid ${pid}`, {
      cause: error,
      reasonCode: 'LOCK_OWNER_UNVERIFIABLE',
    });
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw new JournalError(`cannot inspect journal lock pid ${pid}`, {
      cause: error,
      reasonCode: 'LOCK_PID_CHECK_FAILED',
    });
  }
}

async function inspectAppendLock(context, path) {
  const identity = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!identity) return { status: 'absent', metadata: null, identity: null };
  if (identity.isSymbolicLink() || !identity.isFile()) {
    throw new StatePathError('journal append lock is not a regular file');
  }
  const metadata = validateAppendLock(await readSecureJson({
    anchor: context.stateRoot,
    path,
    label: 'journal append lock',
  }));
  if (!processIsAlive(metadata.pid)) return { status: 'stale', metadata, identity };
  const fingerprint = await captureAppendLockFingerprint(context, metadata.pid, metadata.nonce);
  if (fingerprint === null || fingerprint !== metadata.processStartFingerprint) {
    return { status: 'stale', metadata, identity };
  }
  return { status: 'live', metadata, identity };
}

function sameAppendLock(left, right) {
  return left?.nonce === right?.nonce
    && left?.pid === right?.pid
    && left?.processStartFingerprint === right?.processStartFingerprint;
}

async function removeStaleAppendLock(context, path, expected) {
  const lease = await acquireStateRecoveryLease({
    stateRoot: context.stateRoot,
    repoRoot: context.repositoryRealpath,
    courseId: context.marker.courseId,
  });
  try {
    const confirmed = await inspectAppendLock(context, path);
    if (confirmed.status === 'absent') return false;
    if (confirmed.status !== 'stale'
        || !sameAppendLock(confirmed.metadata, expected.metadata)
        || confirmed.identity.dev !== expected.identity.dev
        || confirmed.identity.ino !== expected.identity.ino) {
      return false;
    }
    const current = await lstat(path).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!current) return false;
    if (!current.isFile()
        || current.dev !== confirmed.identity.dev
        || current.ino !== confirmed.identity.ino) {
      return false;
    }
    await unlink(path);
    await syncDirectory(resolve(path, '..'));
    return true;
  } finally {
    await lease.release();
  }
}

async function createAppendLock(path, metadata) {
  const temporaryPath = resolve(path, '..', `.${randomUUID()}.tmp`);
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

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new JournalError('journal append was aborted', { reasonCode: 'TIMEOUT_COMMAND' });
}

async function acquireAppendLock(context, timeoutMs, signal) {
  const path = resolveStatePath(context, JOURNAL_DIRECTORY, JOURNAL_APPEND_LOCK);
  const nonce = randomBytes(16).toString('hex');
  const processStartFingerprint = await captureAppendLockFingerprint(context, process.pid, nonce);
  if (processStartFingerprint === null) {
    throw new JournalError(`cannot capture journal lock pid ${process.pid}`, {
      reasonCode: 'LOCK_OWNER_UNVERIFIABLE',
    });
  }
  const metadata = {
    pid: process.pid,
    processStartFingerprint,
    acquiredAt: new Date().toISOString(),
    nonce,
  };
  const deadline = Date.now() + timeoutMs;
  while (true) {
    throwIfAborted(signal);
    try {
      await createAppendLock(path, metadata);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing;
      try {
        existing = await inspectAppendLock(context, path);
      } catch (readError) {
        if (readError.code === 'ENOENT') continue;
        throw readError;
      }
      if (existing.status === 'absent') continue;
      if (existing.status === 'stale') {
        await removeStaleAppendLock(context, path, existing);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new JournalError('journal append lock is held by a live process', { reasonCode: 'LOCK_HELD' });
      }
      await delay(10);
    }
  }
  return async () => {
    let current;
    try {
      current = validateAppendLock(await readSecureJson({
        anchor: context.stateRoot,
        path,
        label: 'journal append lock',
      }));
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    if (current.nonce !== metadata.nonce
        || current.pid !== metadata.pid
        || current.processStartFingerprint !== metadata.processStartFingerprint) {
      throw new JournalError('refusing to release another journal writer lock', {
        reasonCode: 'LOCK_OWNERSHIP_MISMATCH',
      });
    }
    await unlink(path);
    await syncDirectory(resolve(path, '..'));
    return true;
  };
}

async function readEntries(context, schema) {
  const directory = resolveStatePath(context, JOURNAL_DIRECTORY);
  const directoryStats = await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: directory,
    allowMissingLeaf: true,
    expectedLeaf: 'directory',
    label: 'journal directory',
  });
  if (!directoryStats) return [];
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name);
    const transient = name === JOURNAL_APPEND_LOCK || TEMPORARY_ENTRY.test(name);
    const stats = await lstat(path).catch((error) => {
      if (transient && error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stats) continue;
    if (stats.isSymbolicLink() || !stats.isFile()) throw new StatePathError(`unsafe journal entry: ${name}`);
    if (name === JOURNAL_APPEND_LOCK) continue;
    if (TEMPORARY_ENTRY.test(name)) continue;
    const match = JOURNAL_ENTRY.exec(name);
    if (!match) throw new JournalSchemaError(`unexpected journal entry: ${name}`);
    const fileSequence = Number(match[1]);
    const entry = await readSecureJson({ anchor: context.stateRoot, path, label: `journal entry ${name}` });
    assertJournalEntry(entry, schema, context);
    if (entry.sequence !== fileSequence) throw new JournalSchemaError(`journal sequence does not match filename: ${name}`);
    entries.push(entry);
  }
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].sequence !== index + 1) throw new JournalSchemaError('journal sequence contains a gap or duplicate');
  }
  return entries;
}

export async function readJournal(options = {}) {
  const context = await loadStateMarkerContext(stateOptions(options));
  const schema = await journalSchema(context);
  return readEntries(context, schema);
}

function entryInput(options) {
  if (options.entry !== undefined) return options.entry;
  const ignored = new Set([
    'stateRoot', 'repoRoot', 'courseId', 'sourceRevision', 'sourceDigest',
    'appendLockTimeoutMs', 'entry', 'signal',
  ]);
  return Object.fromEntries(Object.entries(options).filter(([key]) => !ignored.has(key)));
}

export async function appendJournal(options = {}) {
  throwIfAborted(options.signal);
  const input = entryInput(options);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('journal entry is required');
  const context = await loadStateMarkerContext(stateOptions(options));
  await ensureStateDirectory(context, JOURNAL_DIRECTORY);
  const schema = await journalSchema(context);
  const release = await acquireAppendLock(context, options.appendLockTimeoutMs ?? 5000, options.signal);
  try {
    throwIfAborted(options.signal);
    const existing = await readEntries(context, schema);
    const nextSequence = existing.length + 1;
    if (input.sequence !== undefined && input.sequence !== nextSequence) {
      throw new JournalSchemaError(`journal sequence must be ${nextSequence}`);
    }
    const entry = {
      $schema: JOURNAL_SCHEMA,
      schemaVersion: 1,
      ...input,
      sequence: nextSequence,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
    assertJournalEntry(entry, schema, context);
    const path = resolveStatePath(context, JOURNAL_DIRECTORY, `${String(nextSequence).padStart(12, '0')}.json`);
    const exists = await lstat(path).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (exists) throw new JournalSchemaError(`journal sequence ${nextSequence} already exists`);
    await writeJsonAtomically({
      anchor: context.stateRoot,
      path,
      value: entry,
      label: 'journal entry',
    });
    throwIfAborted(options.signal);
    return { entry, path };
  } finally {
    await release();
  }
}
