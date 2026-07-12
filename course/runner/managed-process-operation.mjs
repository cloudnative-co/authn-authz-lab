import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, open, readdir, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { canonicalJson } from './canonical.mjs';
import {
  captureProcessStartFingerprint,
  detectProcessPlatform,
} from './process.mjs';
import { assertValidSchema, loadJsonSchema } from './schema.mjs';
import {
  assertNoSymlinkComponents,
  ensureStateDirectory,
  resolveStatePath,
} from './state.mjs';

export const MANAGED_PROCESS_OPERATION_SCHEMA = 'curriculum/schemas/managed-process-operation.schema.json';
export const MANAGED_PROCESS_OPERATION_FILE = '.operation.lock';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const MAX_LOCK_BYTES = 8 * 1024;
const OPERATION_WRITE_TEMPORARY = /^\.operation-write-([1-9][0-9]*)-(op-[a-f0-9]{32})-([a-f0-9]{64})\.tmp$/;

export function isManagedProcessOperationTemporary(name) {
  return typeof name === 'string' && OPERATION_WRITE_TEMPORARY.test(name);
}

export class ManagedProcessOperationError extends Error {
  constructor(reasonCode, message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ManagedProcessOperationError';
    this.reasonCode = reasonCode;
  }
}

async function fsyncDirectory(path) {
  const handle = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertPrivateDirectory(context, path, label) {
  await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: path,
    expectedLeaf: 'directory',
    label,
  });
  const handle = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isDirectory() || (stats.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
      throw new ManagedProcessOperationError('PROCESS_STATE_INSECURE', `${label} must be a 0700 directory`);
    }
  } finally {
    await handle.close();
  }
}

async function operationPaths(context, resourceId, { create = false } = {}) {
  if (create) {
    await ensureStateDirectory(context, 'processes');
    await ensureStateDirectory(context, 'processes', resourceId);
  }
  const directory = resolveStatePath(context, 'processes', resourceId);
  const path = resolveStatePath(context, 'processes', resourceId, MANAGED_PROCESS_OPERATION_FILE);
  await assertPrivateDirectory(context, directory, 'managed resource directory');
  return { directory, path };
}

async function loadOperationSchema(context) {
  const path = resolve(context.repositoryRealpath, MANAGED_PROCESS_OPERATION_SCHEMA);
  await assertNoSymlinkComponents({
    anchor: context.repositoryRealpath,
    target: path,
    expectedLeaf: 'file',
    label: 'managed process operation schema',
  });
  return loadJsonSchema(path);
}

async function readOperation(context, resourceId) {
  const paths = await operationPaths(context, resourceId);
  await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: paths.path,
    expectedLeaf: 'file',
    label: 'managed process operation lock',
  });
  const handle = await open(paths.path, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    const identity = await handle.stat();
    if (!identity.isFile() || identity.nlink !== 1 || (identity.mode & 0o777) !== PRIVATE_FILE_MODE) {
      throw new ManagedProcessOperationError('PROCESS_STATE_INSECURE', 'managed process operation lock is unsafe');
    }
    if (identity.size > MAX_LOCK_BYTES) {
      throw new ManagedProcessOperationError('PROCESS_OPERATION_INVALID', 'managed process operation lock is too large');
    }
    let metadata;
    try {
      metadata = JSON.parse(await handle.readFile('utf8'));
    } catch (error) {
      throw new ManagedProcessOperationError('PROCESS_OPERATION_INVALID', 'managed process operation lock is not JSON', {
        cause: error,
      });
    }
    try {
      assertValidSchema(metadata, await loadOperationSchema(context), 'managed process operation lock');
    } catch (error) {
      throw new ManagedProcessOperationError('PROCESS_OPERATION_INVALID', 'managed process operation lock schema is invalid', {
        cause: error,
      });
    }
    if (metadata.resourceId !== resourceId || !metadata.instanceId.startsWith(`${context.marker.installId}.`)) {
      throw new ManagedProcessOperationError('PROCESS_OPERATION_INVALID', 'managed process operation identity differs');
    }
    return { ...paths, handle, identity, metadata };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function inspectOwner(operation, platformSupport) {
  let fingerprint;
  try {
    fingerprint = await captureProcessStartFingerprint(operation.metadata.pid, {
      instanceId: operation.metadata.instanceId,
      platformSupport,
    });
  } catch (error) {
    return { status: 'unverifiable', error };
  }
  if (fingerprint === null) return { status: 'gone' };
  if (fingerprint !== operation.metadata.processStartFingerprint) return { status: 'mismatch' };
  return { status: 'match' };
}

function parseOperationTemporaryName(name, context) {
  const match = OPERATION_WRITE_TEMPORARY.exec(name);
  if (!match) return null;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const operationId = match[2];
  return {
    name,
    pid,
    operationId,
    instanceId: `${context.marker.installId}.operation-${operationId.slice(3)}`,
    processStartFingerprint: `sha256:${match[3]}`,
  };
}

async function inspectTemporaryOwner(temporary, platformSupport) {
  let fingerprint;
  try {
    fingerprint = await captureProcessStartFingerprint(temporary.pid, {
      instanceId: temporary.instanceId,
      platformSupport,
    });
  } catch (error) {
    return { status: 'unverifiable', error };
  }
  if (fingerprint === null) return { status: 'gone' };
  return fingerprint === temporary.processStartFingerprint
    ? { status: 'match' }
    : { status: 'mismatch' };
}

async function readOperationTemporary(context, resourceId, directory, temporary) {
  const path = resolve(directory, temporary.name);
  await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: path,
    expectedLeaf: 'file',
    label: 'managed process operation temporary file',
  });
  const handle = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    const identity = await handle.stat();
    if (!identity.isFile() || ![1, 2].includes(identity.nlink)
        || (identity.mode & 0o777) !== PRIVATE_FILE_MODE || identity.size > MAX_LOCK_BYTES) {
      throw new ManagedProcessOperationError(
        'PROCESS_OPERATION_INVALID',
        'managed process operation temporary file is unsafe',
      );
    }
    const source = await handle.readFile('utf8');
    let metadata = null;
    try {
      const candidate = JSON.parse(source);
      assertValidSchema(candidate, await loadOperationSchema(context), 'managed process operation temporary file');
      if (source !== `${canonicalJson(candidate)}\n`
          || candidate.resourceId !== resourceId
          || candidate.operationId !== temporary.operationId
          || candidate.pid !== temporary.pid
          || candidate.instanceId !== temporary.instanceId
          || candidate.processStartFingerprint !== temporary.processStartFingerprint) {
        throw new Error('temporary operation identity differs');
      }
      metadata = candidate;
    } catch {
      // A kill or write failure may leave an unpublished partial file. The
      // owner fingerprint encoded in its name still makes recovery decidable.
    }
    return { ...temporary, path, identity, metadata };
  } finally {
    await handle.close();
  }
}

async function clearInterruptedOperationWrites({ context, resourceId, directory, path, platformSupport }) {
  const names = (await readdir(directory)).filter(isManagedProcessOperationTemporary).sort();
  for (const name of names) {
    const parsed = parseOperationTemporaryName(name, context);
    if (!parsed) {
      throw new ManagedProcessOperationError('PROCESS_OPERATION_INVALID', 'operation temporary name is invalid');
    }
    const temporary = await readOperationTemporary(context, resourceId, directory, parsed);
    const owner = await inspectTemporaryOwner(temporary, platformSupport);
    if (owner.status === 'match') {
      throw new ManagedProcessOperationError('PROCESS_OPERATION_LOCKED', 'operation writer is still running');
    }
    if (owner.status === 'unverifiable') {
      throw new ManagedProcessOperationError(
        'PROCESS_OPERATION_UNVERIFIABLE',
        'operation writer cannot be verified',
        { cause: owner.error },
      );
    }
    const target = await lstat(path).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const sameTarget = target
      && target.isFile()
      && !target.isSymbolicLink()
      && target.dev === temporary.identity.dev
      && target.ino === temporary.identity.ino;
    if (temporary.identity.nlink === 2 && (!sameTarget || target.nlink !== 2)) {
      throw new ManagedProcessOperationError(
        'PROCESS_OPERATION_INVALID',
        'operation temporary hard-link publication is ambiguous',
      );
    }
    const current = await lstat(temporary.path);
    if (!current.isFile()
        || current.dev !== temporary.identity.dev
        || current.ino !== temporary.identity.ino
        || current.nlink !== temporary.identity.nlink) {
      throw new ManagedProcessOperationError('PROCESS_OPERATION_LOCK_CHANGED', 'operation temporary file changed');
    }
    if (temporary.identity.nlink === 2 && temporary.metadata === null) await unlink(path);
    await unlink(temporary.path);
    await fsyncDirectory(directory);
  }
}

export async function acquireManagedProcessOperation({
  context,
  resourceId,
  command,
  createStorage = command === 'start',
  now = () => new Date().toISOString(),
  platformSupport = detectProcessPlatform(),
} = {}) {
  if (!['start', 'stop', 'recover'].includes(command)) throw new TypeError('command is invalid');
  const paths = await operationPaths(context, resourceId, { create: createStorage });
  if ((await readdir(paths.directory)).some(isManagedProcessOperationTemporary)) {
    throw new ManagedProcessOperationError(
      'PROCESS_OPERATION_STALE_RECOVERY_REQUIRED',
      'interrupted managed process operation publication requires explicit recovery',
    );
  }
  const operationId = `op-${randomBytes(16).toString('hex')}`;
  const instanceId = `${context.marker.installId}.operation-${operationId.slice(3)}`;
  const processStartFingerprint = await captureProcessStartFingerprint(process.pid, {
    instanceId,
    platformSupport,
  });
  if (processStartFingerprint === null) {
    throw new ManagedProcessOperationError('PROCESS_OPERATION_OWNER_UNAVAILABLE', 'operation owner could not be fingerprinted');
  }
  const metadata = {
    $schema: MANAGED_PROCESS_OPERATION_SCHEMA,
    schemaVersion: 1,
    resourceId,
    operationId,
    command,
    pid: process.pid,
    instanceId,
    processStartFingerprint,
    createdAt: now(),
  };
  assertValidSchema(metadata, await loadOperationSchema(context), 'managed process operation lock');
  const temporaryName = `.operation-write-${process.pid}-${operationId}-${processStartFingerprint.slice(7)}.tmp`;
  const temporaryPath = resolve(paths.directory, temporaryName);
  let handle;
  let temporaryIdentity;
  let published = false;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    await handle.chmod(PRIVATE_FILE_MODE);
    await handle.writeFile(`${canonicalJson(metadata)}\n`, 'utf8');
    await handle.sync();
    temporaryIdentity = await handle.stat();
    await link(temporaryPath, paths.path);
    published = true;
    await unlink(temporaryPath);
    const identity = await handle.stat();
    await fsyncDirectory(paths.directory);
    return { ...paths, handle, identity, metadata };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (published && temporaryIdentity) {
      const current = await lstat(paths.path).catch(() => null);
      if (current?.isFile()
          && current.dev === temporaryIdentity.dev
          && current.ino === temporaryIdentity.ino) {
        await unlink(paths.path).catch(() => {});
      }
    }
    await unlink(temporaryPath).catch(() => {});
    await fsyncDirectory(paths.directory).catch(() => {});
    if (error.code !== 'EEXIST') throw error;
    let existing;
    try {
      existing = await readOperation(context, resourceId);
      const owner = await inspectOwner(existing, platformSupport);
      if (owner.status === 'match') {
        throw new ManagedProcessOperationError('PROCESS_OPERATION_LOCKED', 'managed process operation owner is still running');
      }
      if (owner.status === 'unverifiable') {
        throw new ManagedProcessOperationError('PROCESS_OPERATION_UNVERIFIABLE', 'managed process operation owner cannot be verified', {
          cause: owner.error,
        });
      }
      throw new ManagedProcessOperationError(
        'PROCESS_OPERATION_STALE_RECOVERY_REQUIRED',
        'stale managed process operation requires explicit recovery',
      );
    } finally {
      await existing?.handle.close().catch(() => {});
    }
  }
}

async function clearStaleManagedProcessOperation({
  context,
  resourceId,
  createStorage = false,
  platformSupport = detectProcessPlatform(),
} = {}) {
  const paths = await operationPaths(context, resourceId, { create: createStorage });
  await clearInterruptedOperationWrites({
    context,
    resourceId,
    directory: paths.directory,
    path: paths.path,
    platformSupport,
  });
  const stats = await lstat(paths.path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stats) return { status: 'absent' };
  const operation = await readOperation(context, resourceId);
  try {
    const owner = await inspectOwner(operation, platformSupport);
    if (owner.status === 'match') {
      throw new ManagedProcessOperationError('PROCESS_OPERATION_LOCKED', 'managed process operation owner is still running');
    }
    if (owner.status === 'unverifiable') {
      throw new ManagedProcessOperationError('PROCESS_OPERATION_UNVERIFIABLE', 'managed process operation owner cannot be verified', {
        cause: owner.error,
      });
    }
    const current = await lstat(operation.path);
    if (current.isSymbolicLink() || !current.isFile()
        || current.dev !== operation.identity.dev || current.ino !== operation.identity.ino) {
      throw new ManagedProcessOperationError('PROCESS_OPERATION_LOCK_CHANGED', 'managed process operation lock identity changed');
    }
    await unlink(operation.path);
    await fsyncDirectory(operation.directory);
    return { status: 'cleared', reasonCode: owner.status === 'gone' ? 'OWNER_GONE' : 'PID_REUSED' };
  } finally {
    await operation.handle.close();
  }
}

async function acquireRecoveryLease(context, resourceId) {
  const material = `${context.marker.repositoryRealpath}\0${context.marker.installId}\0${resourceId}`;
  const digest = createHash('sha256').update(material).digest();
  const port = 20_000 + (digest.readUInt16BE(0) % 10_000);
  const server = createServer();
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise);
      server.listen({ host: '127.0.0.1', port, exclusive: true }, resolvePromise);
    });
  } catch (error) {
    server.close();
    throw new ManagedProcessOperationError(
      error.code === 'EADDRINUSE' ? 'PROCESS_RECOVERY_LEASE_BUSY' : 'PROCESS_RECOVERY_LEASE_UNAVAILABLE',
      'managed process recovery lease could not be acquired',
      { cause: error },
    );
  }
  return {
    async release() {
      await new Promise((resolvePromise, rejectPromise) => {
        server.close((error) => error ? rejectPromise(error) : resolvePromise());
      });
    },
  };
}

export async function acquireRecoveredManagedProcessOperation({
  context,
  resourceId,
  createStorage = false,
  now = () => new Date().toISOString(),
  platformSupport = detectProcessPlatform(),
} = {}) {
  const lease = await acquireRecoveryLease(context, resourceId);
  try {
    await clearStaleManagedProcessOperation({ context, resourceId, createStorage, platformSupport });
    return await acquireManagedProcessOperation({
      context,
      resourceId,
      command: 'recover',
      createStorage,
      now,
      platformSupport,
    });
  } finally {
    await lease.release();
  }
}

export async function releaseManagedProcessOperation(operation) {
  try {
    const current = await lstat(operation.path);
    if (current.isSymbolicLink() || !current.isFile()
        || current.dev !== operation.identity.dev || current.ino !== operation.identity.ino) {
      throw new ManagedProcessOperationError('PROCESS_OPERATION_LOCK_CHANGED', 'managed process operation lock identity changed');
    }
    await unlink(operation.path);
    await fsyncDirectory(operation.directory);
  } finally {
    await operation.handle.close();
  }
}

export { fsyncDirectory as fsyncManagedProcessDirectory };
