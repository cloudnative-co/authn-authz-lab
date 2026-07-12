import { constants as fsConstants } from 'node:fs';
import { lstat, open, readdir, rmdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from './canonical.mjs';
import { assertValidSchema, loadJsonSchema } from './schema.mjs';
import {
  assertNoSymlinkComponents,
  ensureStateDirectory,
  loadStateContext,
  loadStateMarkerContext,
  resolveStatePath,
  writeJsonAtomically,
} from './state.mjs';
import {
  fsyncManagedProcessDirectory,
  isManagedProcessOperationTemporary,
  MANAGED_PROCESS_OPERATION_FILE,
} from './managed-process-operation.mjs';

export const MANAGED_PROCESS_SCHEMA = 'curriculum/schemas/managed-process.schema.json';
export const PROCESS_CONTROL_SECRET_SCHEMA = 'curriculum/schemas/process-control-secret.schema.json';
export const MANAGED_PROCESS_POINTER_SCHEMA = 'curriculum/schemas/managed-process-pointer.schema.json';
export const MANAGED_PROCESS_LAUNCH_SCHEMA = 'curriculum/schemas/managed-process-launch.schema.json';

export const PROCESS_DIRECTORY = 'processes';
export const GENERATION_DIRECTORY = 'generations';
export const CURRENT_FILE = 'current.json';
export const INTENT_FILE = 'intent.json';
export const RECORD_FILE = 'record.json';
export const CONTROL_FILE = 'control.json';

const RESOURCE_ID = /^[a-z][a-z0-9-]{2,63}$/;
const GENERATION_ID = /^gen-[a-f0-9]{32}$/;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const MAX_JSON_BYTES = 32 * 1024;
const ATOMIC_TEMPORARY_ENTRY = /^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;

export class ManagedProcessError extends Error {
  constructor(reasonCode, message, { cause, cleanup } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ManagedProcessError';
    this.reasonCode = reasonCode;
    if (cleanup !== undefined) this.cleanup = cleanup;
  }
}

export function assertTimestamp(value, label) {
  const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value !== 'string' || !rfc3339.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must return an RFC 3339 timestamp`);
  }
  return value;
}

export function assertResourceId(resourceId, allowedResourceIds) {
  if (typeof resourceId !== 'string' || !RESOURCE_ID.test(resourceId)) {
    throw new TypeError('resourceId must be a lowercase path-safe identifier');
  }
  const values = allowedResourceIds instanceof Set
    ? [...allowedResourceIds]
    : Array.isArray(allowedResourceIds) ? allowedResourceIds : null;
  if (!values || values.length === 0 || values.some((value) => typeof value !== 'string' || !RESOURCE_ID.test(value))) {
    throw new TypeError('allowedResourceIds must be a non-empty allowlist of path-safe resource IDs');
  }
  if (!values.includes(resourceId)) {
    throw new ManagedProcessError('PROCESS_RESOURCE_NOT_ALLOWED', 'resourceId is not in the managed process allowlist');
  }
  return resourceId;
}

export function publicRecord(record) {
  return Object.freeze({ ...record });
}

export async function loadManagedContext({ stateRoot, repoRoot }) {
  const context = await loadStateContext({ stateRoot, repoRoot });
  if (!context.state) {
    throw new ManagedProcessError('PROCESS_STATE_UNINITIALIZED', 'managed processes require initialized course state');
  }
  return context;
}

export async function loadManagedCleanupContext({ stateRoot, repoRoot }) {
  return loadStateMarkerContext({ stateRoot, repoRoot });
}

export function managedProcessPaths(context, resourceId, generationId = null) {
  const processes = resolveStatePath(context, PROCESS_DIRECTORY);
  const resource = resolveStatePath(context, PROCESS_DIRECTORY, resourceId);
  const generations = resolveStatePath(context, PROCESS_DIRECTORY, resourceId, GENERATION_DIRECTORY);
  const generation = generationId === null
    ? null
    : resolveStatePath(context, PROCESS_DIRECTORY, resourceId, GENERATION_DIRECTORY, generationId);
  return {
    processes,
    resource,
    generations,
    current: resolveStatePath(context, PROCESS_DIRECTORY, resourceId, CURRENT_FILE),
    generation,
    intent: generation === null ? null : resolve(generation, INTENT_FILE),
    record: generation === null ? null : resolve(generation, RECORD_FILE),
    control: generation === null ? null : resolve(generation, CONTROL_FILE),
  };
}

export async function assertManagedPrivateDirectory({ context, path, label }) {
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
      throw new ManagedProcessError('PROCESS_STATE_INSECURE', `${label} must be a 0700 directory`);
    }
  } finally {
    await handle.close();
  }
}

export async function ensureManagedProcessStorage(context, resourceId) {
  const paths = managedProcessPaths(context, resourceId);
  await ensureStateDirectory(context, PROCESS_DIRECTORY);
  await ensureStateDirectory(context, PROCESS_DIRECTORY, resourceId);
  await ensureStateDirectory(context, PROCESS_DIRECTORY, resourceId, GENERATION_DIRECTORY);
  await assertManagedPrivateDirectory({ context, path: paths.processes, label: 'managed process directory' });
  await assertManagedPrivateDirectory({ context, path: paths.resource, label: 'managed resource directory' });
  await assertManagedPrivateDirectory({ context, path: paths.generations, label: 'managed generation directory' });
  return paths;
}

async function findStorage(context, resourceId) {
  const paths = managedProcessPaths(context, resourceId);
  const processStats = await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: paths.processes,
    allowMissingLeaf: true,
    expectedLeaf: 'directory',
    label: 'managed process directory',
  });
  if (!processStats) return null;
  await assertManagedPrivateDirectory({ context, path: paths.processes, label: 'managed process directory' });
  const resourceStats = await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: paths.resource,
    allowMissingLeaf: true,
    expectedLeaf: 'directory',
    label: 'managed resource directory',
  });
  if (!resourceStats) return null;
  await assertManagedPrivateDirectory({ context, path: paths.resource, label: 'managed resource directory' });
  const generationStats = await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: paths.generations,
    allowMissingLeaf: true,
    expectedLeaf: 'directory',
    label: 'managed generation directory',
  });
  if (!generationStats) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'managed resource is missing its generations directory');
  }
  await assertManagedPrivateDirectory({ context, path: paths.generations, label: 'managed generation directory' });
  return paths;
}

export async function listManagedProcessResourceIds(context) {
  const processes = resolveStatePath(context, PROCESS_DIRECTORY);
  const stats = await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: processes,
    allowMissingLeaf: true,
    expectedLeaf: 'directory',
    label: 'managed process directory',
  });
  if (!stats) return [];
  await assertManagedPrivateDirectory({ context, path: processes, label: 'managed process directory' });
  const resourceIds = (await readdir(processes)).sort();
  for (const resourceId of resourceIds) {
    if (!RESOURCE_ID.test(resourceId)) {
      throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', `managed process entry name is invalid: ${resourceId}`);
    }
    await assertManagedPrivateDirectory({
      context,
      path: resolve(processes, resourceId),
      label: `managed resource directory ${resourceId}`,
    });
  }
  return resourceIds;
}

export async function loadManagedProcessSchemas(context) {
  const entries = await Promise.all([
    [MANAGED_PROCESS_SCHEMA, 'managed process record'],
    [PROCESS_CONTROL_SECRET_SCHEMA, 'process control secret'],
    [MANAGED_PROCESS_POINTER_SCHEMA, 'managed process pointer'],
    [MANAGED_PROCESS_LAUNCH_SCHEMA, 'managed process launch intent'],
  ].map(async ([schemaPath, label]) => {
    const path = resolve(context.repositoryRealpath, schemaPath);
    await assertNoSymlinkComponents({
      anchor: context.repositoryRealpath,
      target: path,
      expectedLeaf: 'file',
      label: `${label} schema`,
    });
    return loadJsonSchema(path);
  }));
  return { record: entries[0], control: entries[1], pointer: entries[2], intent: entries[3] };
}

async function readPrivateJson({ context, path, schema, label }) {
  await assertNoSymlinkComponents({ anchor: context.stateRoot, target: path, expectedLeaf: 'file', label });
  const handle = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.nlink !== 1 || (stats.mode & 0o777) !== PRIVATE_FILE_MODE) {
      throw new ManagedProcessError('PROCESS_STATE_INSECURE', `${label} must be a private regular file`);
    }
    if (stats.size > MAX_JSON_BYTES) {
      throw new ManagedProcessError('PROCESS_STATE_INVALID', `${label} exceeds the size limit`);
    }
    let value;
    try {
      value = JSON.parse(await handle.readFile('utf8'));
    } catch (error) {
      throw new ManagedProcessError('PROCESS_STATE_INVALID', `${label} is not valid JSON`, { cause: error });
    }
    try {
      return assertValidSchema(value, schema, label);
    } catch (error) {
      throw new ManagedProcessError('PROCESS_STATE_SCHEMA_DRIFT', `${label} does not match its schema`, { cause: error });
    }
  } finally {
    await handle.close();
  }
}

function atomicRecoveryRequired(message) {
  return new ManagedProcessError('PROCESS_ATOMIC_RECOVERY_REQUIRED', message);
}

async function readAtomicTemporaryJson({ context, path, schema, label }) {
  await assertNoSymlinkComponents({ anchor: context.stateRoot, target: path, expectedLeaf: 'file', label });
  const handle = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || ![1, 2].includes(stats.nlink) || (stats.mode & 0o777) !== PRIVATE_FILE_MODE) {
      throw new ManagedProcessError('PROCESS_STATE_INSECURE', `${label} is not a private atomic-write artifact`);
    }
    if (stats.size > MAX_JSON_BYTES) {
      throw new ManagedProcessError('PROCESS_STATE_INVALID', `${label} exceeds the size limit`);
    }
    const source = await handle.readFile('utf8');
    let value;
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new ManagedProcessError('PROCESS_STATE_INVALID', `${label} is not valid JSON`, { cause: error });
    }
    if (source !== `${canonicalJson(value)}\n`) {
      throw new ManagedProcessError('PROCESS_STATE_INVALID', `${label} is not a canonical atomic-write artifact`);
    }
    try {
      assertValidSchema(value, schema, label);
    } catch (error) {
      throw new ManagedProcessError('PROCESS_STATE_SCHEMA_DRIFT', `${label} does not match its schema`, { cause: error });
    }
    return { value, stats };
  } finally {
    await handle.close();
  }
}

async function repairAtomicTemporary({ context, directory, temporaryName, targetName, schema, label, validate }) {
  const temporaryPath = resolve(directory, temporaryName);
  const targetPath = resolve(directory, targetName);
  const temporary = await readAtomicTemporaryJson({ context, path: temporaryPath, schema, label });
  validate(temporary.value);
  const targetStats = await lstat(targetPath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (targetStats && (targetStats.isSymbolicLink() || !targetStats.isFile()
      || (targetStats.mode & 0o777) !== PRIVATE_FILE_MODE)) {
    throw new ManagedProcessError('PROCESS_STATE_INSECURE', `${label} target is unsafe`);
  }
  const sameInode = targetStats
    && targetStats.dev === temporary.stats.dev
    && targetStats.ino === temporary.stats.ino;
  if (temporary.stats.nlink === 2 && (!sameInode || targetStats.nlink !== 2)) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', `${label} hard-link publication is ambiguous`);
  }
  if (temporary.stats.nlink === 1 && sameInode) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', `${label} link count is inconsistent`);
  }
  const currentTemporary = await lstat(temporaryPath);
  if (!currentTemporary.isFile()
      || currentTemporary.dev !== temporary.stats.dev
      || currentTemporary.ino !== temporary.stats.ino
      || currentTemporary.nlink !== temporary.stats.nlink) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', `${label} changed during recovery`);
  }
  await unlink(temporaryPath);
  await fsyncManagedProcessDirectory(directory);
  return temporary.stats.nlink === 2 ? 'published' : 'discarded';
}

function assertTemporaryIdentity(value, { context, resourceId, generationId = null }) {
  if (value.resourceId !== resourceId
      || (generationId !== null && value.generationId !== generationId)) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'atomic-write artifact belongs to another generation');
  }
  if (value.installId !== undefined && value.installId !== context.marker.installId) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'atomic-write artifact belongs to another installation');
  }
  if (value.instanceId !== undefined
      && !value.instanceId.startsWith(`${context.marker.installId}.`)) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'atomic-write artifact identity differs');
  }
}

async function repairDirectoryAtomicTemporary({
  context,
  directory,
  entries,
  allowedTargets,
  identity,
}) {
  const temporaryNames = entries.filter((entry) => ATOMIC_TEMPORARY_ENTRY.test(entry));
  if (temporaryNames.length === 0) return { repaired: 0, discarded: 0 };
  if (temporaryNames.length !== 1) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'multiple atomic-write artifacts are ambiguous');
  }
  const temporaryName = temporaryNames[0];
  const temporaryPath = resolve(directory, temporaryName);
  let source;
  const handle = await open(temporaryPath, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || ![1, 2].includes(stats.nlink) || (stats.mode & 0o777) !== PRIVATE_FILE_MODE
        || stats.size > MAX_JSON_BYTES) {
      throw new ManagedProcessError('PROCESS_STATE_INSECURE', 'atomic-write artifact is unsafe');
    }
    source = await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
  let candidate;
  try {
    candidate = JSON.parse(source);
  } catch (error) {
    throw new ManagedProcessError('PROCESS_STATE_INVALID', 'atomic-write artifact is not valid JSON', { cause: error });
  }
  const target = allowedTargets.get(candidate?.$schema);
  if (!target) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'atomic-write artifact has an unexpected schema');
  }
  const outcome = await repairAtomicTemporary({
    context,
    directory,
    temporaryName,
    ...target,
    validate: (value) => {
      target.validateValue?.(value);
      assertTemporaryIdentity(value, { context, ...identity });
    },
  });
  return { repaired: 1, discarded: outcome === 'discarded' ? 1 : 0 };
}

export async function repairManagedProcessAtomicWrites({ context, resourceId }) {
  const paths = await findStorage(context, resourceId);
  if (!paths) return { status: 'clean', repaired: 0, discarded: 0 };
  const schemas = await loadManagedProcessSchemas(context);
  let repaired = 0;
  let discarded = 0;
  const pointerResult = await repairDirectoryAtomicTemporary({
    context,
    directory: paths.resource,
    entries: await readdir(paths.resource),
    allowedTargets: new Map([[MANAGED_PROCESS_POINTER_SCHEMA, {
      targetName: CURRENT_FILE,
      schema: schemas.pointer,
      label: 'managed process pointer atomic-write artifact',
    }]]),
    identity: { resourceId },
  });
  repaired += pointerResult.repaired;
  discarded += pointerResult.discarded;
  for (const generationId of (await readdir(paths.generations)).sort()) {
    if (!GENERATION_ID.test(generationId)) {
      throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'generation directory name is invalid');
    }
    const generationPaths = managedProcessPaths(context, resourceId, generationId);
    await assertManagedPrivateDirectory({
      context,
      path: generationPaths.generation,
      label: 'managed process generation',
    });
    const result = await repairDirectoryAtomicTemporary({
      context,
      directory: generationPaths.generation,
      entries: await readdir(generationPaths.generation),
      allowedTargets: new Map([
        [PROCESS_CONTROL_SECRET_SCHEMA, {
          targetName: CONTROL_FILE,
          schema: schemas.control,
          label: 'process control secret atomic-write artifact',
          validateValue: assertControlSemantics,
        }],
        [MANAGED_PROCESS_LAUNCH_SCHEMA, {
          targetName: INTENT_FILE,
          schema: schemas.intent,
          label: 'managed process launch intent atomic-write artifact',
          validateValue: assertIntentSemantics,
        }],
        [MANAGED_PROCESS_SCHEMA, {
          targetName: RECORD_FILE,
          schema: schemas.record,
          label: 'managed process record atomic-write artifact',
          validateValue: assertRecordSemantics,
        }],
      ]),
      identity: { resourceId, generationId },
    });
    repaired += result.repaired;
    discarded += result.discarded;
  }
  return { status: repaired === 0 ? 'clean' : 'repaired', repaired, discarded };
}

export function assertRecordSemantics(record) {
  let origin;
  try {
    origin = new URL(record.origin);
  } catch (error) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'managed process origin is invalid', { cause: error });
  }
  if (!['127.0.0.1', '[::1]'].includes(origin.hostname) || !origin.port || origin.origin !== record.origin) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'managed process origin is not an exact loopback origin');
  }
  if (record.status === 'running') {
    if (record.stoppedAt !== null || record.stopMethod !== null || record.stopReasonCode !== null) {
      throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'running process record contains stop metadata');
    }
  } else if (record.stoppedAt === null || record.stopMethod === null) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'stopped process record lacks stop metadata');
  }
}

export function assertIntentSemantics(intent) {
  let origin;
  try {
    origin = new URL(intent.origin);
  } catch (error) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'managed launch origin is invalid', { cause: error });
  }
  if (!['127.0.0.1', '[::1]'].includes(origin.hostname) || !origin.port || origin.origin !== intent.origin) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'managed launch origin is not an exact loopback origin');
  }
  if (intent.instanceId !== `${intent.installId}.${intent.runId}`) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'managed launch identity is inconsistent');
  }
  if (intent.status === 'pending' && (intent.abortedAt !== null || intent.abortReasonCode !== null)) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'pending launch contains abort metadata');
  }
  if (intent.status === 'aborted' && (intent.abortedAt === null || intent.abortReasonCode === null)) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'aborted launch lacks abort metadata');
  }
}

export function assertControlSemantics(control) {
  if (control.status === 'active') {
    if (typeof control.shutdownToken !== 'string' || control.retiredAt !== null) {
      throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'active control secret is malformed');
    }
  } else if (control.shutdownToken !== null || control.retiredAt === null) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'retired control secret retains active material');
  }
}

export function assertGenerationIdentity(intent, record, control, resourceId, generationId, installId) {
  if (
    intent.resourceId !== resourceId
    || control.resourceId !== resourceId
    || intent.generationId !== generationId
    || control.generationId !== generationId
    || intent.installId !== installId
    || intent.instanceId !== control.instanceId
    || intent.createdAt !== control.createdAt
    || (record && (
      record.resourceId !== resourceId
      || record.generationId !== generationId
      || record.instanceId !== intent.instanceId
      || record.origin !== intent.origin
    ))
  ) throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'launch, record, and control identities differ');
  if (intent.status === 'pending' && (!record || record.status === 'running') && control.status !== 'active') {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'pending or running process has no active control secret');
  }
  // aborted + active is a recoverable crash boundary between the two atomic files.
}

async function readGeneration({ context, resourceId, generationId, schemas }) {
  if (!GENERATION_ID.test(generationId)) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'generation directory name is invalid');
  }
  const paths = managedProcessPaths(context, resourceId, generationId);
  await assertManagedPrivateDirectory({ context, path: paths.generation, label: 'managed process generation' });
  const entries = new Set(await readdir(paths.generation));
  if ([...entries].some((entry) => ATOMIC_TEMPORARY_ENTRY.test(entry))) {
    throw atomicRecoveryRequired('managed process generation has an interrupted atomic write');
  }
  if (!entries.has(CONTROL_FILE) || !entries.has(INTENT_FILE)
      || [...entries].some((entry) => ![CONTROL_FILE, INTENT_FILE, RECORD_FILE].includes(entry))) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'managed process generation is incomplete or contains unknown entries');
  }
  const [intent, control] = await Promise.all([
    readPrivateJson({ context, path: paths.intent, schema: schemas.intent, label: 'managed process launch intent' }),
    readPrivateJson({ context, path: paths.control, schema: schemas.control, label: 'process control secret' }),
  ]);
  const record = entries.has(RECORD_FILE)
    ? await readPrivateJson({ context, path: paths.record, schema: schemas.record, label: 'managed process record' })
    : null;
  assertIntentSemantics(intent);
  if (record) assertRecordSemantics(record);
  assertControlSemantics(control);
  assertGenerationIdentity(intent, record, control, resourceId, generationId, context.marker.installId);
  return { paths, intent, record, control };
}

export async function inspectManagedProcessResource({
  context,
  resourceId,
  allowOperation = false,
  allowStaleGenerations = false,
}) {
  const paths = await findStorage(context, resourceId);
  if (!paths) return { paths: null, pointer: null, current: null, history: [] };
  const schemas = await loadManagedProcessSchemas(context);
  const entries = new Set(await readdir(paths.resource));
  if ([...entries].some((entry) => isManagedProcessOperationTemporary(entry))) {
    throw new ManagedProcessError(
      'PROCESS_OPERATION_STALE_RECOVERY_REQUIRED',
      'managed resource has an interrupted operation publication',
    );
  }
  if ([...entries].some((entry) => ATOMIC_TEMPORARY_ENTRY.test(entry))) {
    throw atomicRecoveryRequired('managed resource has an interrupted atomic write');
  }
  for (const entry of entries) {
    if (![CURRENT_FILE, GENERATION_DIRECTORY, MANAGED_PROCESS_OPERATION_FILE].includes(entry)) {
      throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', `managed resource contains an unknown entry: ${entry}`);
    }
  }
  if (entries.has(MANAGED_PROCESS_OPERATION_FILE) && !allowOperation) {
    throw new ManagedProcessError('PROCESS_OPERATION_LOCKED', 'managed resource has an active or stale operation lock');
  }
  let pointer = null;
  if (entries.has(CURRENT_FILE)) {
    pointer = await readPrivateJson({ context, path: paths.current, schema: schemas.pointer, label: 'managed process pointer' });
    if (pointer.resourceId !== resourceId) {
      throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'managed process pointer belongs to another resource');
    }
  }
  const history = [];
  for (const generationId of (await readdir(paths.generations)).sort()) {
    history.push(await readGeneration({ context, resourceId, generationId, schemas }));
  }
  const current = pointer === null
    ? null
    : history.find((entry) => entry.intent.generationId === pointer.generationId) ?? null;
  if (pointer !== null && current === null) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'managed process pointer targets a missing generation');
  }
  if (current && pointer.activatedAt !== current.intent.createdAt) {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'managed process pointer activation does not match its launch intent');
  }
  if (!allowStaleGenerations) {
    for (const entry of history) {
      if (entry !== current && (entry.record?.status === 'running'
          || (!entry.record && entry.intent.status === 'pending'))) {
        throw new ManagedProcessError('PROCESS_STALE_GENERATION', 'a non-current managed process generation requires recovery');
      }
    }
  }
  return { paths, schemas, pointer, current, history };
}

export function stoppedRecord(record, timestamp, { method, reasonCode }) {
  return {
    ...record,
    status: 'stopped',
    updatedAt: timestamp,
    stoppedAt: timestamp,
    stopMethod: method,
    stopReasonCode: reasonCode ?? null,
  };
}

export function retiredControl(control, timestamp) {
  return { ...control, status: 'retired', shutdownToken: null, retiredAt: timestamp };
}

export async function retireStoppedSecrets({ snapshot, context, writeImplementation, timestamp }) {
  for (const generation of snapshot.history) {
    if ((generation.record?.status === 'stopped'
        || (!generation.record && generation.intent.status === 'aborted'))
        && generation.control.status === 'active') {
      const retired = retiredControl(generation.control, timestamp);
      await writeImplementation({
        anchor: context.stateRoot,
        path: generation.paths.control,
        value: retired,
        label: 'process control secret',
      });
      generation.control = retired;
    }
  }
}

export async function cleanupUncommittedGeneration({ context, resourceId, generationId }) {
  const paths = managedProcessPaths(context, resourceId, generationId);
  const stats = await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: paths.generation,
    allowMissingLeaf: true,
    expectedLeaf: 'directory',
    label: 'uncommitted managed process generation',
  });
  if (!stats) return { status: 'clean' };
  const entries = await readdir(paths.generation);
  if (entries.some((name) => ![RECORD_FILE, CONTROL_FILE, INTENT_FILE].includes(name))) {
    return { status: 'blocked', reasonCode: 'PROCESS_ROLLBACK_UNSAFE_STATE' };
  }
  for (const name of entries) {
    const path = resolve(paths.generation, name);
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      return { status: 'blocked', reasonCode: 'PROCESS_ROLLBACK_UNSAFE_STATE' };
    }
    await unlink(path);
  }
  await rmdir(paths.generation);
  await fsyncManagedProcessDirectory(paths.generations);
  return { status: 'clean' };
}

export async function generationIsCurrent(context, resourceId, generationId) {
  try {
    const current = managedProcessPaths(context, resourceId).current;
    const stats = await assertNoSymlinkComponents({
      anchor: context.stateRoot,
      target: current,
      allowMissingLeaf: true,
      expectedLeaf: 'file',
      label: 'managed process pointer',
    });
    if (!stats) return false;
    const pointer = await readPrivateJson({
      context,
      path: current,
      schema: (await loadManagedProcessSchemas(context)).pointer,
      label: 'managed process pointer',
    });
    return pointer.generationId === generationId;
  } catch {
    return null;
  }
}

export function abortedIntent(intent, timestamp, reasonCode) {
  return { ...intent, status: 'aborted', abortedAt: timestamp, abortReasonCode: reasonCode };
}

export async function persistAbortedLaunch({ context, paths, intent, control, record = null, rollback, reasonCode }) {
  const timestamp = new Date().toISOString();
  try {
    if (record) {
      const rollbackMethod = rollback?.method;
      const method = ['authenticated-shutdown', 'already-gone', 'rollback-child-handle', 'activation-aborted']
        .includes(rollbackMethod)
        ? rollbackMethod
        : rollbackMethod?.startsWith('child-handle-') ? 'rollback-child-handle' : 'already-gone';
      await writeJsonAtomically({
        anchor: context.stateRoot,
        path: paths.record,
        value: stoppedRecord(record, timestamp, {
          method,
          reasonCode,
        }),
        label: 'managed process record',
      });
    }
    await writeJsonAtomically({
      anchor: context.stateRoot,
      path: paths.intent,
      value: abortedIntent(intent, timestamp, reasonCode),
      label: 'managed process launch intent',
    });
    await writeJsonAtomically({
      anchor: context.stateRoot,
      path: paths.control,
      value: retiredControl(control, timestamp),
      label: 'retired process control secret',
    });
    return { status: 'reconciled' };
  } catch {
    return { status: 'blocked', reasonCode: 'PROCESS_ROLLBACK_STATE_WRITE_FAILED' };
  }
}

export async function cleanupInterruptedPrelaunch(context, resourceId) {
  const paths = await findStorage(context, resourceId);
  if (!paths) return { status: 'clean', removed: 0 };
  const schemas = await loadManagedProcessSchemas(context);
  const resourceEntries = new Set(await readdir(paths.resource));
  let currentGenerationId = null;
  if (resourceEntries.has(CURRENT_FILE)) {
    const pointer = await readPrivateJson({
      context,
      path: paths.current,
      schema: schemas.pointer,
      label: 'managed process pointer',
    });
    if (pointer.resourceId !== resourceId) {
      throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'managed process pointer belongs to another resource');
    }
    currentGenerationId = pointer.generationId;
  }
  let removed = 0;
  for (const generationId of await readdir(paths.generations)) {
    if (generationId === currentGenerationId) continue;
    if (!GENERATION_ID.test(generationId)) {
      throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'generation directory name is invalid');
    }
    const generationPaths = managedProcessPaths(context, resourceId, generationId);
    await assertManagedPrivateDirectory({ context, path: generationPaths.generation, label: 'managed process generation' });
    const entries = await readdir(generationPaths.generation);
    if (entries.includes(RECORD_FILE)
        || (entries.includes(CONTROL_FILE) && entries.includes(INTENT_FILE))) continue;
    if (entries.some((entry) => ![CONTROL_FILE, INTENT_FILE].includes(entry))) {
      throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'interrupted prelaunch contains an unknown entry');
    }
    const cleaned = await cleanupUncommittedGeneration({ context, resourceId, generationId });
    if (cleaned.status !== 'clean') {
      throw new ManagedProcessError(cleaned.reasonCode, 'interrupted prelaunch could not be removed safely');
    }
    removed += 1;
  }
  return { status: 'clean', removed };
}
