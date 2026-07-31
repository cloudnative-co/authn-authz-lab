import { constants as fsConstants } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { canonicalJson, digestCanonical } from './canonical.mjs';
import { currentMutationHooks } from './mutation-context.mjs';
import { assertValidSchema, loadJsonSchema } from './schema.mjs';
import { LESSON_WORKSPACE_FILES, workspaceFilesForLesson } from './lesson-workspace-layout.mjs';
import { assertOwnedPurgeStructure, PurgeStructureError } from './state-purge-policy.mjs';

export const STATE_MARKER_FILE = 'marker.json';
export const STATE_FILE = 'state.json';
export const STATE_MARKER_SCHEMA = 'curriculum/schemas/state-marker.schema.json';
export const STATE_SCHEMA = 'curriculum/schemas/state.schema.json';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const OWNED_STATE_ENTRIES = new Set([
  STATE_MARKER_FILE,
  STATE_FILE,
  'locks',
  'journal',
  'evidence',
  'logs',
  'processes',
  'containers',
  'secrets.json',
  'submissions',
  'transactions',
]);
const ATOMIC_TEMPORARY_ENTRY = /^\.[0-9a-f-]{32,36}\.tmp$/;
const PURGE_QUARANTINE_SUFFIX = /^\.purge-([a-f0-9]{32})$/;

export class StateError extends Error {
  constructor(message, { cause, reasonCode = 'STATE_ERROR' } = {}) {
    super(message, { cause });
    this.name = 'StateError';
    this.reasonCode = reasonCode;
  }
}

export class StatePathError extends StateError {
  constructor(message, options = {}) {
    super(message, { reasonCode: 'STATE_UNSAFE_PATH', ...options });
    this.name = 'StatePathError';
  }
}

export class StateIdentityError extends StateError {
  constructor(message, options = {}) {
    super(message, { reasonCode: 'STATE_IDENTITY_MISMATCH', ...options });
    this.name = 'StateIdentityError';
  }
}

export class StateDriftError extends StateIdentityError {
  constructor(message, options = {}) {
    super(message, { reasonCode: 'STATE_SOURCE_DRIFT', ...options });
    this.name = 'StateDriftError';
  }
}

export class StateRuntimeDriftError extends StateIdentityError {
  constructor(message, options = {}) {
    super(message, { reasonCode: 'STATE_RUNTIME_DRIFT', ...options });
    this.name = 'StateRuntimeDriftError';
  }
}

export class StateSchemaError extends StateError {
  constructor(message, options = {}) {
    super(message, { reasonCode: 'STATE_SCHEMA_DRIFT', ...options });
    this.name = 'StateSchemaError';
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertDigest(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 digest`);
  }
}

function pathInside(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

export function assertRootContainment(root, candidate, label = 'path') {
  if (!pathInside(root, candidate)) {
    throw new StatePathError(`${label} escapes the repository root`);
  }
  return candidate;
}

async function missingLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function assertNoSymlinkComponents({
  anchor,
  target,
  allowMissingLeaf = false,
  expectedLeaf = null,
  label = 'path',
}) {
  const absoluteAnchor = resolve(anchor);
  const absoluteTarget = resolve(target);
  assertRootContainment(absoluteAnchor, absoluteTarget, label);
  const anchorStat = await missingLstat(absoluteAnchor);
  if (!anchorStat?.isDirectory() || anchorStat.isSymbolicLink()) {
    throw new StatePathError(`${label} anchor is not a real directory`);
  }

  const segments = relative(absoluteAnchor, absoluteTarget).split(sep).filter(Boolean);
  let current = absoluteAnchor;
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]);
    const stats = await missingLstat(current);
    const leaf = index === segments.length - 1;
    if (!stats) {
      if (allowMissingLeaf && leaf) return null;
      const error = new StatePathError(`${label} is missing at ${relative(absoluteAnchor, current)}`);
      error.code = 'ENOENT';
      throw error;
    }
    if (stats.isSymbolicLink()) throw new StatePathError(`${label} contains a symbolic link`);
    if (!leaf && !stats.isDirectory()) throw new StatePathError(`${label} has a non-directory component`);
    if (leaf && expectedLeaf === 'directory' && !stats.isDirectory()) {
      throw new StatePathError(`${label} is not a directory`);
    }
    if (leaf && expectedLeaf === 'file' && !stats.isFile()) {
      throw new StatePathError(`${label} is not a regular file`);
    }
  }
  return missingLstat(absoluteTarget);
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function setPrivateDirectoryMode(path, label) {
  const handle = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isDirectory()) throw new StatePathError(`${label} is not a directory`);
    await handle.chmod(PRIVATE_DIRECTORY_MODE);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function secureReadFile({ anchor, path, label }) {
  await assertNoSymlinkComponents({ anchor, target: path, expectedLeaf: 'file', label });
  const handle = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new StatePathError(`${label} is not a regular file`);
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

export async function readSecureJson({ anchor, path, label = 'JSON file' }) {
  const source = await secureReadFile({ anchor, path, label });
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new StateSchemaError(`${label} is not valid JSON`, { cause: error });
  }
}

async function ensureDirectory({ anchor, path, label }) {
  assertRootContainment(anchor, path, label);
  const segments = relative(anchor, path).split(sep).filter(Boolean);
  let current = anchor;
  for (const segment of segments) {
    current = resolve(current, segment);
    const stats = await missingLstat(current);
    if (!stats) {
      let createdEntry = false;
      await mkdir(current, { mode: PRIVATE_DIRECTORY_MODE })
        .then(() => { createdEntry = true; })
        .catch((error) => {
          if (error.code !== 'EEXIST') throw error;
        });
      const createdStats = await missingLstat(current);
      if (!createdStats || createdStats.isSymbolicLink() || !createdStats.isDirectory()) {
        throw new StatePathError(`${label} contains an unsafe path component`);
      }
      await setPrivateDirectoryMode(current, label);
      if (createdEntry) await fsyncDirectory(resolve(current, '..'));
      continue;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new StatePathError(`${label} contains an unsafe path component`);
    }
  }
  await assertNoSymlinkComponents({ anchor, target: path, expectedLeaf: 'directory', label });
  return path;
}

export async function ensureStateDirectory(context, ...segments) {
  const path = resolve(context.stateRoot, ...segments);
  assertRootContainment(context.stateRoot, path, 'state child directory');
  return ensureDirectory({ anchor: context.stateRoot, path, label: 'state child directory' });
}

export function resolveStatePath(context, ...segments) {
  const path = resolve(context.stateRoot, ...segments);
  return assertRootContainment(context.stateRoot, path, 'state path');
}

export async function writeJsonAtomically({
  anchor,
  path,
  value,
  exclusive = false,
  label = 'JSON file',
}) {
  const directory = resolve(path, '..');
  await assertNoSymlinkComponents({ anchor, target: directory, expectedLeaf: 'directory', label: `${label} directory` });
  const existing = await assertNoSymlinkComponents({
    anchor,
    target: path,
    allowMissingLeaf: true,
    expectedLeaf: 'file',
    label,
  });
  if (exclusive && existing) throw new StateIdentityError(`${label} already exists`, { reasonCode: 'STATE_ALREADY_EXISTS' });

  const temporaryPath = resolve(directory, `.${randomUUID()}.tmp`);
  assertRootContainment(anchor, temporaryPath, `${label} temporary path`);
  let handle;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    await handle.chmod(PRIVATE_FILE_MODE);
    await handle.writeFile(`${canonicalJson(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    if (exclusive) {
      await link(temporaryPath, path);
      await unlink(temporaryPath);
    } else {
      await assertNoSymlinkComponents({ anchor, target: directory, expectedLeaf: 'directory', label: `${label} directory` });
      await rename(temporaryPath, path);
    }
    await fsyncDirectory(directory);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
  }
  return path;
}

async function loadSchema(repositoryRealpath, schemaPath, label) {
  const path = resolve(repositoryRealpath, schemaPath);
  await assertNoSymlinkComponents({
    anchor: repositoryRealpath,
    target: path,
    expectedLeaf: 'file',
    label: `${label} schema`,
  });
  try {
    return await loadJsonSchema(path);
  } catch (error) {
    throw new StateSchemaError(`${label} schema cannot be loaded`, { cause: error });
  }
}

async function validateAgainstSchema(value, repositoryRealpath, schemaPath, label) {
  const schema = await loadSchema(repositoryRealpath, schemaPath, label);
  try {
    return assertValidSchema(value, schema, label);
  } catch (error) {
    throw new StateSchemaError(`${label} does not match the current schema`, { cause: error });
  }
}

function normalizeIdentityArguments(markerOrOptions, expected) {
  if (markerOrOptions && hasOwn(markerOrOptions, 'marker')) {
    const { marker, ...identity } = markerOrOptions;
    return { marker, expected: identity };
  }
  return { marker: markerOrOptions, expected: expected ?? {} };
}

export function assertStateIdentity(markerOrOptions, expected) {
  const normalized = normalizeIdentityArguments(markerOrOptions, expected);
  const marker = normalized.marker;
  const identity = normalized.expected;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    throw new StateIdentityError('state marker is missing or invalid');
  }
  if (marker.$schema !== STATE_MARKER_SCHEMA || ![1, 2].includes(marker.schemaVersion)) {
    throw new StateSchemaError('state marker schema version has drifted');
  }
  if (identity.courseId !== undefined && marker.courseId !== identity.courseId) {
    throw new StateIdentityError('state marker belongs to another course', { reasonCode: 'STATE_COURSE_MISMATCH' });
  }
  const expectedRepository = identity.repositoryRealpath ?? identity.repoRoot;
  if (expectedRepository !== undefined && marker.repositoryRealpath !== expectedRepository) {
    throw new StateIdentityError('state marker belongs to another repository', { reasonCode: 'STATE_REPOSITORY_MISMATCH' });
  }
  if (identity.installId !== undefined && marker.installId !== identity.installId) {
    throw new StateIdentityError('state marker installId does not match', { reasonCode: 'STATE_INSTALL_MISMATCH' });
  }
  if (identity.nodeMajor !== undefined
      && (marker.schemaVersion !== 2 || marker.nodeMajor !== identity.nodeMajor)) {
    throw new StateRuntimeDriftError('state Node.js major version has drifted');
  }
  if (hasOwn(identity, 'sourceRevision') && marker.sourceRevision !== identity.sourceRevision) {
    throw new StateDriftError('state source revision has drifted');
  }
  if (identity.sourceDigest !== undefined && marker.sourceDigest !== identity.sourceDigest) {
    throw new StateDriftError('state source digest has drifted');
  }
  return marker;
}

function exactUniqueIds(actualEntries, expectedEntries) {
  const actual = actualEntries.map(({ id }) => id);
  const expected = expectedEntries.map(({ id }) => id);
  return new Set(actual).size === actual.length
    && actual.length === expected.length
    && actual.every((id, index) => id === expected[index]);
}

export function assertStateMatchesManifest(state, manifest) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new StateSchemaError('state is missing for manifest validation', { reasonCode: 'STATE_MANIFEST_DRIFT' });
  }
  if (!manifest || !Array.isArray(manifest.lessons) || !Array.isArray(manifest.resources)) {
    throw new TypeError('validated manifest is required');
  }
  if (!exactUniqueIds(state.lessons, manifest.lessons)) {
    throw new StateSchemaError('state lesson IDs do not match the manifest', { reasonCode: 'STATE_MANIFEST_DRIFT' });
  }
  if (!exactUniqueIds(state.resources, manifest.resources)) {
    throw new StateSchemaError('state resource IDs do not match the manifest', { reasonCode: 'STATE_MANIFEST_DRIFT' });
  }
  return state;
}

async function bootstrapContext({ stateRoot, repoRoot }) {
  if (!stateRoot) throw new TypeError('stateRoot is required');
  let repositoryRealpath = null;
  if (repoRoot) repositoryRealpath = await realpath(repoRoot);
  const requestedRoot = repositoryRealpath && !isAbsolute(stateRoot)
    ? resolve(repositoryRealpath, stateRoot)
    : resolve(stateRoot);
  const rootStats = await missingLstat(requestedRoot);
  if (!rootStats || rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new StatePathError('stateRoot is not a real directory');
  }
  const canonicalStateRoot = await realpath(requestedRoot);
  if (repoRoot) {
    assertRootContainment(repositoryRealpath, requestedRoot, 'stateRoot');
    if (requestedRoot === repositoryRealpath) throw new StatePathError('stateRoot must be below the repository root');
    await assertNoSymlinkComponents({
      anchor: repositoryRealpath,
      target: requestedRoot,
      expectedLeaf: 'directory',
      label: 'stateRoot',
    });
    if (canonicalStateRoot !== requestedRoot) throw new StatePathError('stateRoot realpath does not match its path');
  } else {
    const markerPath = resolve(canonicalStateRoot, STATE_MARKER_FILE);
    const marker = await readSecureJson({ anchor: canonicalStateRoot, path: markerPath, label: 'state marker' });
    repositoryRealpath = marker.repositoryRealpath;
    assertNonEmptyString(repositoryRealpath, 'marker.repositoryRealpath');
    const canonicalRepository = await realpath(repositoryRealpath).catch((error) => {
      throw new StateIdentityError('marker repository no longer exists', { cause: error });
    });
    if (canonicalRepository !== repositoryRealpath) {
      throw new StateIdentityError('marker repositoryRealpath is not canonical');
    }
    assertRootContainment(repositoryRealpath, canonicalStateRoot, 'stateRoot');
    await assertNoSymlinkComponents({
      anchor: repositoryRealpath,
      target: canonicalStateRoot,
      expectedLeaf: 'directory',
      label: 'stateRoot',
    });
  }
  const mode = (await lstat(canonicalStateRoot)).mode & 0o777;
  if (mode !== PRIVATE_DIRECTORY_MODE) {
    throw new StatePathError('stateRoot permissions must be 0700', { reasonCode: 'STATE_INSECURE_PERMISSIONS' });
  }
  return { repositoryRealpath, stateRoot: canonicalStateRoot };
}

export async function loadStateMarkerContext(options = {}) {
  const base = await bootstrapContext(options);
  const markerPath = resolve(base.stateRoot, STATE_MARKER_FILE);
  if (!await missingLstat(markerPath)) {
    throw new StateIdentityError('stateRoot has no course ownership marker', {
      reasonCode: 'STATE_UNOWNED_ROOT',
    });
  }
  const marker = await readSecureJson({ anchor: base.stateRoot, path: markerPath, label: 'state marker' });
  await validateAgainstSchema(marker, base.repositoryRealpath, STATE_MARKER_SCHEMA, 'state marker');
  const canonicalExpectedRepo = options.repoRoot ? base.repositoryRealpath : undefined;
  assertStateIdentity(marker, {
    courseId: options.courseId,
    repositoryRealpath: canonicalExpectedRepo,
    ...(hasOwn(options, 'sourceRevision') ? { sourceRevision: options.sourceRevision } : {}),
    ...(options.sourceDigest !== undefined ? { sourceDigest: options.sourceDigest } : {}),
    ...(options.installId !== undefined ? { installId: options.installId } : {}),
    ...(options.nodeMajor !== undefined ? { nodeMajor: options.nodeMajor } : {}),
  });
  if (marker.repositoryRealpath !== base.repositoryRealpath) {
    throw new StateIdentityError('state marker repository identity does not match stateRoot');
  }

  const markerDigest = digestCanonical(marker);
  const statePath = resolve(base.stateRoot, STATE_FILE);
  return { ...base, markerPath, statePath, marker, markerDigest };
}

export async function loadStateContext(options = {}) {
  const markerContext = await loadStateMarkerContext(options);
  const { statePath } = markerContext;
  const stateStats = await assertNoSymlinkComponents({
    anchor: markerContext.stateRoot,
    target: statePath,
    allowMissingLeaf: true,
    expectedLeaf: 'file',
    label: 'state file',
  });
  let state = null;
  if (stateStats) {
    state = await readSecureJson({ anchor: markerContext.stateRoot, path: statePath, label: 'state file' });
    await validateAgainstSchema(state, markerContext.repositoryRealpath, STATE_SCHEMA, 'state file');
    if (!Number.isInteger(state.epoch) || state.epoch < 1) {
      throw new StateSchemaError('state epoch must be a positive integer');
    }
    if (state.courseId !== markerContext.marker.courseId
        || state.installId !== markerContext.marker.installId
        || state.markerDigest !== markerContext.markerDigest) {
      throw new StateIdentityError('state file is not bound to its marker');
    }
  }
  return { ...markerContext, state };
}

function parsePurgeQuarantineName(stateRoot, name) {
  const prefix = `${basename(stateRoot)}.purge-`;
  if (!name.startsWith(prefix)) return null;
  const suffix = `.purge-${name.slice(prefix.length)}`;
  const match = PURGE_QUARANTINE_SUFFIX.exec(suffix);
  return match ? { name, installId: match[1] } : null;
}

async function listPurgeQuarantines(stateRoot) {
  const parent = resolve(stateRoot, '..');
  const entries = await readdir(parent);
  return entries
    .map((name) => parsePurgeQuarantineName(stateRoot, name))
    .filter(Boolean)
    .map((entry) => ({ ...entry, path: resolve(parent, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function assertNoInterruptedPurge(stateRoot) {
  if ((await listPurgeQuarantines(stateRoot)).length > 0) {
    throw new StatePathError('state purge must be resumed before creating course state', {
      reasonCode: 'STATE_PURGE_RECOVERY_REQUIRED',
    });
  }
}

export async function createStateRoot({
  repoRoot,
  stateRoot = '.lab',
  courseId,
  sourceRevision = null,
  sourceDigest,
  installId = randomBytes(16).toString('hex'),
  createdAt = new Date().toISOString(),
  nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10),
} = {}) {
  if (!repoRoot) throw new TypeError('repoRoot is required');
  assertNonEmptyString(courseId, 'courseId');
  assertDigest(sourceDigest, 'sourceDigest');
  if (sourceRevision !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceRevision)) {
    throw new TypeError('sourceRevision must be null or a full lowercase revision');
  }
  if (!/^[a-f0-9]{32}$/.test(installId)) throw new TypeError('installId must contain 32 lowercase hex characters');
  if (![24, 26].includes(nodeMajor)) throw new TypeError('nodeMajor must be 24 or 26');

  const repositoryRealpath = await realpath(repoRoot);
  const requestedRoot = isAbsolute(stateRoot) ? resolve(stateRoot) : resolve(repositoryRealpath, stateRoot);
  assertRootContainment(repositoryRealpath, requestedRoot, 'stateRoot');
  if (requestedRoot === repositoryRealpath) throw new StatePathError('stateRoot must be below the repository root');
  await assertNoInterruptedPurge(requestedRoot);
  await ensureDirectory({ anchor: repositoryRealpath, path: requestedRoot, label: 'stateRoot' });
  const canonicalStateRoot = await realpath(requestedRoot);
  if (canonicalStateRoot !== requestedRoot) throw new StatePathError('stateRoot is not canonical');

  const markerPath = resolve(canonicalStateRoot, STATE_MARKER_FILE);
  const markerStats = await assertNoSymlinkComponents({
    anchor: canonicalStateRoot,
    target: markerPath,
    allowMissingLeaf: true,
    expectedLeaf: 'file',
    label: 'state marker',
  });
  if (markerStats) {
    return loadStateContext({ repoRoot: repositoryRealpath, stateRoot: canonicalStateRoot, courseId, sourceRevision, sourceDigest, nodeMajor });
  }
  const entries = await readdir(canonicalStateRoot);
  if (entries.length > 0) {
    throw new StateIdentityError('refusing to claim a non-empty stateRoot without a marker', {
      reasonCode: 'STATE_UNOWNED_ROOT',
    });
  }
  await setPrivateDirectoryMode(canonicalStateRoot, 'stateRoot');
  const marker = {
    $schema: STATE_MARKER_SCHEMA,
    schemaVersion: 2,
    nodeMajor,
    courseId,
    repositoryRealpath,
    installId,
    sourceRevision,
    sourceDigest,
    createdAt,
  };
  await validateAgainstSchema(marker, repositoryRealpath, STATE_MARKER_SCHEMA, 'state marker');
  await writeJsonAtomically({
    anchor: canonicalStateRoot,
    path: markerPath,
    value: marker,
    exclusive: true,
    label: 'state marker',
  });
  return loadStateContext({ repoRoot: repositoryRealpath, stateRoot: canonicalStateRoot, courseId, sourceRevision, sourceDigest, nodeMajor });
}

export async function writeStateAtomically({
  stateRoot,
  repoRoot,
  state,
  sourceRevision,
  sourceDigest,
  nodeMajor,
  incrementEpoch = false,
} = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('state is required');
  const context = await loadStateContext({
    stateRoot,
    repoRoot,
    ...(hasOwn(arguments[0] ?? {}, 'sourceRevision') ? { sourceRevision } : {}),
    ...(sourceDigest !== undefined ? { sourceDigest } : {}),
    ...(nodeMajor !== undefined ? { nodeMajor } : {}),
  });
  const currentEpoch = context.state?.epoch ?? 0;
  const next = { ...state };
  if (incrementEpoch) next.epoch = currentEpoch + 1;
  if (!Number.isInteger(next.epoch) || next.epoch < 1) {
    throw new StateSchemaError('state epoch must be a positive integer');
  }
  if (!incrementEpoch && next.epoch !== Math.max(currentEpoch, 1)) {
    throw new StateDriftError('state epoch changes require incrementEpoch', { reasonCode: 'STATE_EPOCH_DRIFT' });
  }
  if (incrementEpoch && next.epoch !== currentEpoch + 1) {
    throw new StateDriftError('reset must advance state epoch exactly once', { reasonCode: 'STATE_EPOCH_DRIFT' });
  }
  if (next.courseId !== context.marker.courseId
      || next.installId !== context.marker.installId
      || next.markerDigest !== context.markerDigest) {
    throw new StateIdentityError('refusing to write state not bound to the current marker');
  }
  await validateAgainstSchema(next, context.repositoryRealpath, STATE_SCHEMA, 'state file');
  const mutation = currentMutationHooks();
  if (mutation) {
    await mutation.prepare({ context, before: context.state, after: next });
  }
  await writeJsonAtomically({
    anchor: context.stateRoot,
    path: context.statePath,
    value: next,
    label: 'state file',
  });
  if (mutation) {
    await mutation.applied({ context, after: next });
  }
  return { ...context, state: next };
}

async function resolveSystemRm() {
  for (const candidate of ['/bin/rm', '/usr/bin/rm', '/run/current-system/sw/bin/rm']) {
    const canonical = await realpath(candidate).catch(() => null);
    if (!canonical) continue;
    const stats = await lstat(canonical).catch(() => null);
    if (stats?.isFile()) return canonical;
  }
  throw new StatePathError('purge requires the platform rm utility', {
    reasonCode: 'STATE_PURGE_UTILITY_UNAVAILABLE',
  });
}

async function removeQuarantinedEntry({ quarantineRoot, name, rmPath }) {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new StatePathError('purge entry name is unsafe');
  }
  const child = spawn(rmPath, ['-rf', '--', `./${name}`], {
    cwd: quarantineRoot,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  const result = await new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  }).catch((error) => {
    throw new StatePathError('purge utility could not be started', { cause: error });
  });
  if (result.code !== 0 || result.signal !== null) {
    throw new StatePathError('purge utility did not remove an owned entry');
  }
  if (await missingLstat(resolve(quarantineRoot, name))) {
    throw new StatePathError('purge utility left an owned entry behind');
  }
  await fsyncDirectory(quarantineRoot);
}

async function assertSafePurgeTree(root, path) {
  assertRootContainment(root, path, 'purge path');
  const stats = await missingLstat(path);
  if (!stats) return;
  if (stats.isSymbolicLink()) throw new StatePathError('purge refuses symbolic links');
  if (!stats.isDirectory()) {
    if (!stats.isFile()) throw new StatePathError('purge refuses non-regular filesystem entries');
    return;
  }
  for (const name of await readdir(path)) await assertSafePurgeTree(root, resolve(path, name));
}

export async function purgeEmptyStateRoot({ stateRoot, repoRoot } = {}) {
  const context = await bootstrapContext({ stateRoot, repoRoot });
  if ((await readdir(context.stateRoot)).length > 0) return { purged: false };
  try {
    await rmdir(context.stateRoot);
  } catch (error) {
    if (['EEXIST', 'ENOTEMPTY'].includes(error.code)) return { purged: false };
    throw error;
  }
  await fsyncDirectory(resolve(context.stateRoot, '..'));
  return { purged: true };
}

async function inspectLessonWorkspace(context, lessonId) {
  const allowedFiles = workspaceFilesForLesson(lessonId);
  const submissions = resolveStatePath(context, 'submissions');
  const submissionsStats = await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: submissions,
    allowMissingLeaf: true,
    expectedLeaf: 'directory',
    label: 'submission directory',
  });
  if (!submissionsStats) return null;
  const lesson = resolveStatePath(context, 'submissions', lessonId);
  const lessonStats = await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: lesson,
    allowMissingLeaf: true,
    expectedLeaf: 'directory',
    label: `lesson ${lessonId} submission directory`,
  });
  if (!lessonStats) return null;
  const entries = (await readdir(lesson)).sort();
  for (const name of entries) {
    if (!allowedFiles.includes(name) && !ATOMIC_TEMPORARY_ENTRY.test(name)) {
      throw new StatePathError(`reset refuses unknown lesson ${lessonId} submission entry: ${name}`);
    }
    const stats = await lstat(resolve(lesson, name));
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new StatePathError(`reset refuses invalid lesson ${lessonId} submission entry: ${name}`);
    }
  }
  return { submissions, lesson, entries };
}

async function removeInspectedWorkspace(context, inspected) {
  if (!inspected) return false;
  const { submissions, lesson, entries } = inspected;
  for (const name of entries) await unlink(resolve(lesson, name));
  await fsyncDirectory(lesson);
  await rmdir(lesson);
  await fsyncDirectory(submissions);
  if ((await readdir(submissions)).length === 0) {
    await rmdir(submissions);
    await fsyncDirectory(context.stateRoot);
  }
  return true;
}

export async function clearLessonWorkspace({ stateRoot, repoRoot, lessonId } = {}) {
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const inspected = await inspectLessonWorkspace(context, lessonId);
  const removed = await removeInspectedWorkspace(context, inspected);
  return { removed };
}

export async function assertLessonWorkspaceResettable({ stateRoot, repoRoot, lessonId } = {}) {
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  return { present: (await inspectLessonWorkspace(context, lessonId)) !== null };
}

export async function clearCourseLessonWorkspaces({ stateRoot, repoRoot } = {}) {
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const submissions = resolveStatePath(context, 'submissions');
  const stats = await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: submissions,
    allowMissingLeaf: true,
    expectedLeaf: 'directory',
    label: 'submission directory',
  });
  if (!stats) return { removed: [] };
  const lessonIds = (await readdir(submissions)).sort();
  for (const lessonId of lessonIds) {
    if (!LESSON_WORKSPACE_FILES[lessonId]) {
      throw new StatePathError(`reset refuses unknown submission lesson: ${lessonId}`);
    }
  }
  const inspected = [];
  for (const lessonId of lessonIds) {
    inspected.push([lessonId, await inspectLessonWorkspace(context, lessonId)]);
  }
  const removed = [];
  for (const [lessonId, workspace] of inspected) {
    if (await removeInspectedWorkspace(context, workspace)) removed.push(lessonId);
  }
  return { removed };
}

export async function clearLesson01Workspace(options = {}) {
  return clearLessonWorkspace({ ...options, lessonId: '01' });
}

async function validateOwnedPurgeContext(context) {
  const entries = (await readdir(context.stateRoot)).sort();
  for (const name of entries) {
    if (!OWNED_STATE_ENTRIES.has(name) && !ATOMIC_TEMPORARY_ENTRY.test(name)) {
      throw new StatePathError(`purge refuses unknown state entry: ${name}`);
    }
  }
  await assertSafePurgeTree(context.stateRoot, context.stateRoot);
  try {
    await assertOwnedPurgeStructure({
      stateRoot: context.stateRoot,
      entries,
      markerFile: STATE_MARKER_FILE,
      stateFile: STATE_FILE,
    });
  } catch (error) {
    if (!(error instanceof PurgeStructureError)) throw error;
    throw new StatePathError(error.message, { cause: error });
  }
  return entries;
}

function purgeEntryPriority(name) {
  const priorities = new Map([
    ['logs', 10],
    ['evidence', 20],
    ['journal', 30],
    ['submissions', 40],
    ['transactions', 50],
    [STATE_FILE, 60],
    ['secrets.json', 70],
    ['processes', 80],
    ['locks', 90],
  ]);
  return priorities.get(name) ?? 75;
}

async function removeOwnedPurgeQuarantine({ context, onProgress, rmPath }) {
  const entries = await validateOwnedPurgeContext(context);
  const removable = entries
    .filter((name) => name !== STATE_MARKER_FILE)
    .sort((left, right) => purgeEntryPriority(left) - purgeEntryPriority(right)
      || left.localeCompare(right));
  for (const name of removable) {
    await onProgress?.({ phase: 'before-entry-removal', entry: name, quarantineRoot: context.stateRoot });
    await removeQuarantinedEntry({ quarantineRoot: context.stateRoot, name, rmPath });
    await onProgress?.({ phase: 'after-entry-removal', entry: name, quarantineRoot: context.stateRoot });
  }
  await onProgress?.({ phase: 'before-marker-removal', quarantineRoot: context.stateRoot });
  const remaining = (await readdir(context.stateRoot)).sort();
  if (remaining.length !== 1 || remaining[0] !== STATE_MARKER_FILE) {
    throw new StatePathError('purge refuses state entries created after ownership validation');
  }
  await unlink(resolve(context.stateRoot, STATE_MARKER_FILE));
  await fsyncDirectory(context.stateRoot);
  await onProgress?.({ phase: 'after-marker-removal', quarantineRoot: context.stateRoot });
  if ((await readdir(context.stateRoot)).length !== 0) {
    throw new StatePathError('purge refuses entries created after marker removal');
  }
  await rmdir(context.stateRoot);
  await fsyncDirectory(resolve(context.stateRoot, '..'));
  return { purged: true, installId: context.marker.installId };
}

export async function resumeOwnedStatePurge({
  stateRoot,
  repoRoot,
  courseId,
  onProgress,
} = {}) {
  if (onProgress !== undefined && typeof onProgress !== 'function') {
    throw new TypeError('onProgress must be a function');
  }
  const repositoryRealpath = await realpath(repoRoot);
  const requestedRoot = isAbsolute(stateRoot) ? resolve(stateRoot) : resolve(repositoryRealpath, stateRoot);
  assertRootContainment(repositoryRealpath, requestedRoot, 'stateRoot');
  const quarantines = await listPurgeQuarantines(requestedRoot);
  if (quarantines.length === 0) return { purged: false };
  if (quarantines.length !== 1 || await missingLstat(requestedRoot)) {
    throw new StatePathError('purge recovery found conflicting state roots', {
      reasonCode: 'STATE_PURGE_RECOVERY_CONFLICT',
    });
  }
  const quarantine = quarantines[0];
  const stats = await lstat(quarantine.path);
  if (stats.isSymbolicLink() || !stats.isDirectory() || (stats.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
    throw new StatePathError('purge quarantine is unsafe');
  }
  const entries = await readdir(quarantine.path);
  if (!entries.includes(STATE_MARKER_FILE)) {
    if (entries.length !== 0) {
      throw new StateIdentityError('purge quarantine lost its ownership marker');
    }
    await rmdir(quarantine.path);
    await fsyncDirectory(resolve(quarantine.path, '..'));
    return { purged: true, installId: quarantine.installId };
  }
  const context = await loadStateMarkerContext({
    stateRoot: quarantine.path,
    repoRoot: repositoryRealpath,
    courseId,
    installId: quarantine.installId,
  });
  const rmPath = await resolveSystemRm();
  return removeOwnedPurgeQuarantine({ context, onProgress, rmPath });
}

export async function purgeOwnedState({
  stateRoot,
  repoRoot,
  courseId,
  installId,
  onProgress,
} = {}) {
  if (onProgress !== undefined && typeof onProgress !== 'function') {
    throw new TypeError('onProgress must be a function');
  }
  const identityOptions = {
    stateRoot,
    repoRoot,
    courseId,
    installId,
  };
  const context = await loadStateMarkerContext(identityOptions);
  assertStateIdentity(context.marker, {
    courseId,
    repositoryRealpath: context.repositoryRealpath,
    ...(installId !== undefined ? { installId } : {}),
  });
  await validateOwnedPurgeContext(context);
  const rmPath = await resolveSystemRm();
  const quarantinePath = `${context.stateRoot}.purge-${context.marker.installId}`;
  if (await missingLstat(quarantinePath)) {
    throw new StatePathError('purge quarantine already exists', {
      reasonCode: 'STATE_PURGE_RECOVERY_CONFLICT',
    });
  }
  const rootIdentity = await lstat(context.stateRoot);
  await rename(context.stateRoot, quarantinePath);
  await fsyncDirectory(resolve(context.stateRoot, '..'));
  const quarantineIdentity = await lstat(quarantinePath);
  if (!quarantineIdentity.isDirectory()
      || quarantineIdentity.dev !== rootIdentity.dev
      || quarantineIdentity.ino !== rootIdentity.ino) {
    throw new StatePathError('purge quarantine identity changed');
  }
  const quarantineContext = {
    ...context,
    stateRoot: quarantinePath,
    markerPath: resolve(quarantinePath, STATE_MARKER_FILE),
    statePath: resolve(quarantinePath, STATE_FILE),
  };
  await onProgress?.({ phase: 'after-state-quarantine', quarantineRoot: quarantinePath });
  return removeOwnedPurgeQuarantine({ context: quarantineContext, onProgress, rmPath });
}
