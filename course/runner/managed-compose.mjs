import { constants as fsConstants } from 'node:fs';
import { lstat, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { digestCanonical } from './canonical.mjs';
import {
  composeArguments,
  environmentObject,
  inspectDockerPrerequisites,
  ManagedComposeError,
  positiveInteger,
  resolvedConfigDigest,
  runBoundedCommand,
  runDocker,
} from './managed-compose-command.mjs';
import {
  CONTAINERS_DIRECTORY,
  MAX_DEFAULT_OUTPUT_BYTES,
  RECORD_FILE,
  RECORD_SCHEMA,
  SAFE_RESOURCE_ID,
  SAFE_SERVICE_NAME,
  SAFE_SUPPLEMENTAL_FILE,
  TEMPORARY_FILE,
} from './managed-compose-constants.mjs';
import {
  candidateIds,
  inspectInternal,
  inspectNetworks,
  inspectVolumes,
  persistedContainers,
  publicInspection,
} from './managed-compose-inspection.mjs';
import { probeTcpPort } from './port.mjs';
import { assertValidSchema, loadJsonSchema } from './schema.mjs';
import {
  assertNoSymlinkComponents,
  ensureStateDirectory,
  loadStateMarkerContext,
  readSecureJson,
  resolveStatePath,
  writeJsonAtomically,
} from './state.mjs';

export {
  inspectDockerPrerequisites,
  ManagedComposeError,
  runBoundedCommand,
};

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
export function deriveComposeProjectName({ courseId, installId, resourceId } = {}) {
  if (typeof courseId !== 'string' || !/^[a-z][a-z0-9-]{2,63}$/u.test(courseId)) {
    throw new TypeError('courseId is invalid');
  }
  if (typeof installId !== 'string' || !/^[a-f0-9]{32}$/u.test(installId)) {
    throw new TypeError('installId is invalid');
  }
  if (typeof resourceId !== 'string' || !SAFE_RESOURCE_ID.test(resourceId)) {
    throw new TypeError('resourceId is invalid');
  }
  const coursePrefix = courseId.replaceAll(/[^a-z0-9]/gu, '').slice(0, 12);
  const resourcePrefix = resourceId.replaceAll(/[^a-z0-9]/gu, '').slice(0, 12);
  return `aa-${coursePrefix}-${resourcePrefix}-${installId}`;
}

function pathInside(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

function exactUniqueStrings(value, pattern, name) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32
      || value.some((entry) => typeof entry !== 'string' || !pattern.test(entry))
      || new Set(value).size !== value.length) {
    throw new TypeError(`${name} must be a non-empty unique string array`);
  }
  return [...value].sort();
}

function uniqueResourceKeys(value, name) {
  if (!Array.isArray(value) || value.length > 32
      || value.some((entry) => typeof entry !== 'string' || !/^[a-z][a-z0-9_-]{0,62}$/u.test(entry))
      || new Set(value).size !== value.length) {
    throw new TypeError(`${name} must be a unique resource key array`);
  }
  return [...value].sort();
}

function normalizeEnvironment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('composeEnvironment must be an object');
  }
  const entries = [];
  for (const [name, entry] of Object.entries(value)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(name)
        || typeof entry !== 'string'
        || entry.length < 1
        || entry.length > 1024
        || /[\u0000\r\n]/u.test(entry)) {
      throw new TypeError('composeEnvironment contains an invalid entry');
    }
    if (/(?:PASSWORD|TOKEN|CREDENTIAL|PRIVATE_KEY|KEYTAB)/u.test(name)
        && !/(?:_FILE|_PATH|_DIR)$/u.test(name)) {
      throw new TypeError('composeEnvironment must not contain secret values');
    }
    entries.push({ name, value: entry });
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return entries;
}

function normalizePorts(value, expectedServices) {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError('publishedPorts must be an array');
  const unique = new Set();
  return value.map((port) => {
    if (!port || typeof port !== 'object' || Array.isArray(port)
        || !expectedServices.includes(port.serviceName)
        || port.host !== '127.0.0.1'
        || port.protocol !== 'tcp') {
      throw new TypeError('publishedPorts contains an invalid entry');
    }
    positiveInteger(port.hostPort, 'publishedPorts.hostPort');
    positiveInteger(port.containerPort, 'publishedPorts.containerPort');
    if (port.hostPort > 65_535 || port.containerPort > 65_535) throw new TypeError('published port is too large');
    const key = `${port.serviceName}:${port.hostPort}:${port.containerPort}`;
    if (unique.has(key)) throw new TypeError('publishedPorts contains duplicates');
    unique.add(key);
    return Object.freeze({
      serviceName: port.serviceName,
      host: port.host,
      hostPort: port.hostPort,
      containerPort: port.containerPort,
      protocol: port.protocol,
    });
  }).sort((left, right) => left.serviceName.localeCompare(right.serviceName)
    || left.hostPort - right.hostPort);
}

async function normalizeSpec({ context, repoRoot, spec }) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('spec is required');
  if (!SAFE_RESOURCE_ID.test(spec.resourceId ?? '')) throw new TypeError('spec.resourceId is invalid');
  if (typeof spec.composeFile !== 'string'
      || isAbsolute(spec.composeFile)
      || spec.composeFile.includes('\\')
      || spec.composeFile.split('/').includes('..')) {
    throw new TypeError('spec.composeFile is invalid');
  }
  const composeFile = await realpath(resolve(repoRoot, spec.composeFile)).catch((error) => {
    throw new ManagedComposeError('CONTAINER_CONFIG_MISSING', 'Compose file is missing', { cause: error });
  });
  if (!pathInside(repoRoot, composeFile)) throw new TypeError('spec.composeFile escapes the repository');
  const buildServices = exactUniqueStrings(spec.buildServices, SAFE_SERVICE_NAME, 'buildServices');
  const targetServices = exactUniqueStrings(spec.targetServices, SAFE_SERVICE_NAME, 'targetServices');
  const expectedServices = exactUniqueStrings(spec.expectedServices, SAFE_SERVICE_NAME, 'expectedServices');
  if (targetServices.some((service) => !expectedServices.includes(service))) {
    throw new TypeError('targetServices must be included in expectedServices');
  }
  if (typeof spec.noDependencies !== 'boolean') throw new TypeError('spec.noDependencies must be boolean');
  const supplementalFiles = uniqueResourceKeys(
    spec.supplementalFiles ?? [],
    'supplementalFiles',
  );
  if (supplementalFiles.some((name) => !SAFE_SUPPLEMENTAL_FILE.test(name))) {
    throw new TypeError('supplementalFiles contains an invalid name');
  }
  if (supplementalFiles.includes(RECORD_FILE)) throw new TypeError('supplementalFiles includes the record');
  const composeEnvironment = normalizeEnvironment({
    ...spec.composeEnvironment,
    COURSE_INSTALL_ID: context.marker.installId,
  });
  return Object.freeze({
    resourceId: spec.resourceId,
    composeFile: relative(repoRoot, composeFile),
    composeFileAbsolute: composeFile,
    buildServices,
    targetServices,
    expectedServices,
    expectedNetworks: uniqueResourceKeys(spec.expectedNetworks ?? [], 'expectedNetworks'),
    expectedVolumes: uniqueResourceKeys(spec.expectedVolumes ?? [], 'expectedVolumes'),
    noDependencies: spec.noDependencies,
    publishedPorts: normalizePorts(spec.publishedPorts ?? [], expectedServices),
    composeEnvironment,
    supplementalFiles,
  });
}

function expectedLabels(context, resourceId, composeProject) {
  return Object.freeze({
    courseId: context.marker.courseId,
    installId: context.marker.installId,
    resourceId,
    composeProject,
  });
}

async function recordSchema(repoRoot) {
  return loadJsonSchema(resolve(repoRoot, RECORD_SCHEMA));
}

function assertRecordSemantics(record, context) {
  if (record.courseId !== context.marker.courseId || record.installId !== context.marker.installId) {
    throw new ManagedComposeError('CONTAINER_OWNERSHIP_MISMATCH', 'managed Compose identity does not match state');
  }
  if (record.composeProject !== deriveComposeProjectName({
    courseId: record.courseId, installId: record.installId, resourceId: record.resourceId,
  })) {
    throw new ManagedComposeError('CONTAINER_OWNERSHIP_MISMATCH', 'Compose project does not match install identity');
  }
  const expected = expectedLabels(context, record.resourceId, record.composeProject);
  if (digestCanonical(record.labels) !== digestCanonical(expected)) {
    throw new ManagedComposeError('CONTAINER_OWNERSHIP_MISMATCH', 'recorded labels do not match state');
  }
  const services = record.containers.map(({ serviceName }) => serviceName);
  if (new Set(services).size !== services.length
      || services.some((service) => !record.expectedServices.includes(service))) {
    throw new ManagedComposeError('CONTAINER_RECORD_INVALID', 'recorded container services are invalid');
  }
  if (record.status === 'pending' && record.containers.length !== 0) {
    throw new ManagedComposeError('CONTAINER_RECORD_INVALID', 'pending record contains containers');
  }
  if (record.status === 'pending' && (record.networks.length !== 0 || record.volumes.length !== 0)) {
    throw new ManagedComposeError('CONTAINER_RECORD_INVALID', 'pending record contains project resources');
  }
  if (record.status !== 'pending' && (
    record.containers.length !== record.expectedServices.length
    || record.networks.length !== record.expectedNetworks.length
    || record.volumes.length !== record.expectedVolumes.length
  )) {
    throw new ManagedComposeError('CONTAINER_RECORD_INVALID', 'recorded container set is incomplete');
  }
  return record;
}

async function writeRecord({ context, record }) {
  const directory = await ensureStateDirectory(context, CONTAINERS_DIRECTORY, record.resourceId);
  const path = resolve(directory, RECORD_FILE);
  assertValidSchema(record, await recordSchema(context.repositoryRealpath), 'managed Compose record');
  assertRecordSemantics(record, context);
  await writeJsonAtomically({
    anchor: context.stateRoot,
    path,
    value: record,
    label: 'managed Compose record',
  });
  return path;
}

async function readRecord({ context, resourceId }) {
  const path = resolveStatePath(context, CONTAINERS_DIRECTORY, resourceId, RECORD_FILE);
  let record;
  try {
    record = await readSecureJson({ anchor: context.stateRoot, path, label: 'managed Compose record' });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  assertValidSchema(record, await recordSchema(context.repositoryRealpath), 'managed Compose record');
  return assertRecordSemantics(record, context);
}

function recordFromSpec(context, spec, timestamp) {
  const composeProject = deriveComposeProjectName({
    courseId: context.marker.courseId,
    installId: context.marker.installId,
    resourceId: spec.resourceId,
  });
  return {
    $schema: RECORD_SCHEMA,
    schemaVersion: 1,
    courseId: context.marker.courseId,
    installId: context.marker.installId,
    resourceId: spec.resourceId,
    composeProject,
    composeFile: spec.composeFile,
    buildServices: spec.buildServices,
    targetServices: spec.targetServices,
    expectedServices: spec.expectedServices,
    expectedNetworks: spec.expectedNetworks,
    expectedVolumes: spec.expectedVolumes,
    noDependencies: spec.noDependencies,
    publishedPorts: spec.publishedPorts,
    composeEnvironment: spec.composeEnvironment,
    supplementalFiles: spec.supplementalFiles,
    configDigest: '0'.repeat(64),
    labels: expectedLabels(context, spec.resourceId, composeProject),
    containers: [],
    networks: [],
    volumes: [],
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function contextAndRecord({ stateRoot, repoRoot, resourceId }) {
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  return { context, record: await readRecord({ context, resourceId }) };
}

export async function inspectManagedComposeProject({
  stateRoot, repoRoot, spec, signal, dependencies,
} = {}) {
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const normalized = await normalizeSpec({ context, repoRoot: context.repositoryRealpath, spec });
  const record = await readRecord({ context, resourceId: normalized.resourceId });
  if (!record) return Object.freeze({ status: 'absent', healthy: false, serviceCount: 0, adopted: false });
  const inspected = await inspectInternal({ context, record, signal, dependencies });
  return publicInspection(inspected);
}

export async function ensureManagedComposeProject({
  stateRoot,
  repoRoot,
  spec,
  signal,
  now = () => new Date().toISOString(),
  dependencies,
} = {}) {
  const prerequisites = await inspectDockerPrerequisites({ repoRoot, signal, dependencies });
  if (!prerequisites.supported) {
    throw new ManagedComposeError(prerequisites.reasonCode, 'Docker prerequisites are not available');
  }
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const normalized = await normalizeSpec({ context, repoRoot: context.repositoryRealpath, spec });
  let record = await readRecord({ context, resourceId: normalized.resourceId });
  const timestamp = now();
  if (!record) {
    record = recordFromSpec(context, normalized, timestamp);
    record.configDigest = await resolvedConfigDigest(record, {
      repoRoot: context.repositoryRealpath, signal, dependencies,
    });
    await writeRecord({ context, record });
  } else {
    const identityFields = [
      'resourceId', 'composeFile', 'buildServices', 'targetServices', 'expectedServices',
      'expectedNetworks', 'expectedVolumes',
      'noDependencies', 'publishedPorts', 'composeEnvironment', 'supplementalFiles',
    ];
    for (const field of identityFields) {
      if (digestCanonical(record[field]) !== digestCanonical(normalized[field])) {
        throw new ManagedComposeError('CONTAINER_SPEC_DRIFT', `managed Compose ${field} changed`);
      }
    }
  }

  let inspected = await inspectInternal({ context, record, signal, dependencies });
  if (inspected.status === 'running' && inspected.healthy) {
    if (record.status === 'pending') {
      record = {
        ...record,
        containers: persistedContainers(inspected.containers),
        networks: inspected.networks,
        volumes: inspected.volumes,
        status: 'running',
        updatedAt: timestamp,
      };
      await writeRecord({ context, record });
      return Object.freeze({ ...publicInspection(inspected, { adopted: true }), started: false });
    }
    return Object.freeze({ ...publicInspection(inspected), started: false });
  }
  if (inspected.status === 'running' && !inspected.healthy) {
    throw new ManagedComposeError('CONTAINER_UNHEALTHY', 'managed Compose project is running but unhealthy');
  }

  for (const port of record.publishedPorts) {
    const probed = await (dependencies?.probePort ?? probeTcpPort)({
      host: port.host, port: port.hostPort, signal,
    });
    if (!probed.available) {
      throw new ManagedComposeError('PREREQUISITE_CONTAINER_PORT_IN_USE', 'required container port is occupied');
    }
  }

  const environment = environmentObject(record.composeEnvironment);
  await runDocker(composeArguments(record, 'build', record.buildServices), {
    repoRoot: context.repositoryRealpath,
    env: environment,
    signal,
    timeoutMs: 10 * 60_000,
    maxOutputBytes: 16 * 1024 * 1024,
    reasonCode: 'CONTAINER_BUILD_FAILED',
    dependencies,
  });
  const upArguments = ['--detach'];
  if (record.noDependencies) upArguments.push('--no-deps');
  upArguments.push('--wait', '--wait-timeout', '60', ...record.targetServices);
  await runDocker(composeArguments(record, 'up', upArguments), {
    repoRoot: context.repositoryRealpath,
    env: environment,
    signal,
    timeoutMs: 90_000,
    reasonCode: 'CONTAINER_START_FAILED',
    dependencies,
  });
  inspected = await inspectInternal({
    context,
    record: { ...record, status: 'pending', containers: [], networks: [], volumes: [] },
    signal,
    dependencies,
  });
  if (inspected.status !== 'running' || !inspected.healthy) {
    throw new ManagedComposeError('CONTAINER_HEALTH_UNVERIFIED', 'managed Compose project did not become healthy');
  }
  record = {
    ...record,
    containers: persistedContainers(inspected.containers),
    networks: inspected.networks,
    volumes: inspected.volumes,
    status: 'running',
    updatedAt: now(),
  };
  await writeRecord({ context, record });
  return Object.freeze({ ...publicInspection(inspected), started: true });
}

async function listRecordResourceIds(context) {
  const containers = resolveStatePath(context, CONTAINERS_DIRECTORY);
  const stats = await lstat(containers).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!stats) return [];
  await assertNoSymlinkComponents({
    anchor: context.stateRoot, target: containers, expectedLeaf: 'directory', label: 'container state directory',
  });
  const resourceIds = (await readdir(containers)).sort();
  for (const resourceId of resourceIds) {
    if (!SAFE_RESOURCE_ID.test(resourceId)) {
      throw new ManagedComposeError('CONTAINER_STORAGE_INVALID', 'container state has an invalid resource entry');
    }
    await assertNoSymlinkComponents({
      anchor: context.stateRoot,
      target: resolve(containers, resourceId),
      expectedLeaf: 'directory',
      label: 'managed container resource directory',
    });
  }
  return resourceIds;
}

async function fsyncDirectory(path) {
  const handle = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function clearRecordStorage(context, record) {
  const directory = resolveStatePath(context, CONTAINERS_DIRECTORY, record.resourceId);
  const allowed = new Set([RECORD_FILE, ...record.supplementalFiles]);
  const entries = await readdir(directory);
  for (const name of entries) {
    if (!allowed.has(name) && !TEMPORARY_FILE.test(name)) {
      throw new ManagedComposeError('CONTAINER_STORAGE_INVALID', 'container storage contains an unknown file');
    }
    const path = resolve(directory, name);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new ManagedComposeError('CONTAINER_STORAGE_INVALID', 'container storage contains a non-file');
    }
  }
  for (const name of entries) await unlink(resolve(directory, name));
  await fsyncDirectory(directory);
  await rmdir(directory);
  const parent = resolve(directory, '..');
  await fsyncDirectory(parent);
  if ((await readdir(parent)).length === 0) {
    await rmdir(parent);
    await fsyncDirectory(context.stateRoot);
  }
}

async function assertProjectResourcesAbsent(record, options) {
  const emptyRecord = {
    ...record,
    expectedServices: [],
    expectedNetworks: [],
    expectedVolumes: [],
  };
  const [containers, networks, volumes] = await Promise.all([
    candidateIds(record, options),
    inspectNetworks(emptyRecord, options),
    inspectVolumes(emptyRecord, options),
  ]);
  if (containers.length !== 0 || networks.length !== 0 || volumes.length !== 0) {
    throw new ManagedComposeError('CONTAINER_REMOVE_UNVERIFIED', 'Compose resources remain after removal');
  }
}

async function stopOrRemoveRecord({ context, record, signal, remove, dependencies, now }) {
  const inspected = await inspectInternal({
    context,
    record,
    signal,
    dependencies,
    requireCurrentConfig: false,
    allowOrphanedProjectResources: remove,
    allowMissingRecordedResources: remove,
  });
  if (inspected.status === 'absent') {
    if (remove) {
      for (const network of inspected.networks) {
        await runDocker(['network', 'rm', network.networkId], {
          repoRoot: context.repositoryRealpath,
          signal,
          timeoutMs: 15_000,
          reasonCode: 'CONTAINER_NETWORK_REMOVE_FAILED',
          dependencies,
        });
      }
      for (const volume of inspected.volumes) {
        await runDocker(['volume', 'rm', volume.name], {
          repoRoot: context.repositoryRealpath,
          signal,
          timeoutMs: 15_000,
          reasonCode: 'CONTAINER_VOLUME_REMOVE_FAILED',
          dependencies,
        });
      }
      await assertProjectResourcesAbsent(record, {
        repoRoot: context.repositoryRealpath, signal, dependencies,
      });
      await clearRecordStorage(context, record);
    }
    return {
      resourceId: record.resourceId,
      status: 'safe-noop',
      reasonCode: 'CONTAINER_NOT_FOUND',
    };
  }
  for (const container of inspected.containers) {
    if (container.status === 'running') {
      await runDocker(['stop', '--time', '5', container.containerId], {
        repoRoot: context.repositoryRealpath,
        signal,
        timeoutMs: 15_000,
        reasonCode: 'CONTAINER_STOP_FAILED',
        dependencies,
      });
    }
  }
  if (remove) {
    for (const container of inspected.containers) {
      await runDocker(['rm', '--force', container.containerId], {
        repoRoot: context.repositoryRealpath,
        signal,
        timeoutMs: 15_000,
        reasonCode: 'CONTAINER_REMOVE_FAILED',
        dependencies,
      });
    }
    for (const network of inspected.networks) {
      await runDocker(['network', 'rm', network.networkId], {
        repoRoot: context.repositoryRealpath,
        signal,
        timeoutMs: 15_000,
        reasonCode: 'CONTAINER_NETWORK_REMOVE_FAILED',
        dependencies,
      });
    }
    for (const volume of inspected.volumes) {
      await runDocker(['volume', 'rm', volume.name], {
        repoRoot: context.repositoryRealpath,
        signal,
        timeoutMs: 15_000,
        reasonCode: 'CONTAINER_VOLUME_REMOVE_FAILED',
        dependencies,
      });
    }
    await assertProjectResourcesAbsent(record, {
      repoRoot: context.repositoryRealpath, signal, dependencies,
    });
    await clearRecordStorage(context, record);
    return { resourceId: record.resourceId, status: 'removed', reasonCode: null };
  }
  const stopped = await inspectInternal({
    context,
    record: { ...record, status: 'pending', containers: [], networks: [], volumes: [] },
    signal,
    dependencies,
    requireCurrentConfig: false,
  });
  if (stopped.status !== 'stopped') {
    throw new ManagedComposeError('CONTAINER_STOP_UNVERIFIED', 'owned containers did not stop');
  }
  await writeRecord({
    context,
    record: {
      ...record,
      containers: persistedContainers(stopped.containers),
      networks: stopped.networks,
      volumes: stopped.volumes,
      status: 'stopped',
      updatedAt: now(),
    },
  });
  return { resourceId: record.resourceId, status: 'stopped', reasonCode: null };
}

export async function stopManagedComposeProjects({
  stateRoot,
  repoRoot,
  signal,
  remove = false,
  resourceIds = null,
  now = () => new Date().toISOString(),
  dependencies,
} = {}) {
  if (typeof remove !== 'boolean') throw new TypeError('remove must be boolean');
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const available = await listRecordResourceIds(context);
  const selected = resourceIds === null
    ? available
    : exactUniqueStrings(resourceIds, SAFE_RESOURCE_ID, 'resourceIds');
  const records = [];
  for (const resourceId of selected) {
    if (!available.includes(resourceId)) continue;
    const record = await readRecord({ context, resourceId });
    if (record) records.push(record);
  }
  if (records.length === 0) return [];
  const prerequisites = await inspectDockerPrerequisites({
    repoRoot: context.repositoryRealpath, signal, dependencies,
  });
  if (!prerequisites.supported) {
    throw new ManagedComposeError(prerequisites.reasonCode, 'Docker is required to verify owned containers');
  }
  const outcomes = [];
  for (const record of records) {
    outcomes.push(await stopOrRemoveRecord({
      context, record, signal, remove, dependencies, now,
    }));
  }
  return outcomes;
}

export async function execManagedComposeService({
  stateRoot,
  repoRoot,
  resourceId,
  serviceName,
  argv,
  stdin = null,
  signal,
  timeoutMs = 30_000,
  maxOutputBytes = MAX_DEFAULT_OUTPUT_BYTES,
  acceptedExitCodes = [0],
  dependencies,
} = {}) {
  if (!SAFE_RESOURCE_ID.test(resourceId ?? '')) throw new TypeError('resourceId is invalid');
  if (!SAFE_SERVICE_NAME.test(serviceName ?? '')) throw new TypeError('serviceName is invalid');
  if (!Array.isArray(argv)
      || argv.length === 0
      || argv.length > 128
      || argv.some((value) => typeof value !== 'string' || /\u0000/u.test(value))
      || Buffer.byteLength(argv.join('\u0000'), 'utf8') > 32 * 1024) {
    throw new TypeError('argv is invalid');
  }
  positiveInteger(timeoutMs, 'timeoutMs');
  positiveInteger(maxOutputBytes, 'maxOutputBytes');
  if (!Array.isArray(acceptedExitCodes)
      || acceptedExitCodes.length === 0
      || acceptedExitCodes.some((code) => !Number.isSafeInteger(code) || code < 0 || code > 255)
      || new Set(acceptedExitCodes).size !== acceptedExitCodes.length) {
    throw new TypeError('acceptedExitCodes must be a non-empty unique exit code array');
  }
  const { context, record } = await contextAndRecord({ stateRoot, repoRoot, resourceId });
  if (!record) throw new ManagedComposeError('CONTAINER_NOT_RECORDED', 'managed Compose record is missing');
  if (!record.expectedServices.includes(serviceName)) {
    throw new ManagedComposeError('CONTAINER_SERVICE_NOT_OWNED', 'service is not part of the managed project');
  }
  const inspected = await inspectInternal({
    context,
    record,
    signal,
    dependencies,
    requireCurrentConfig: false,
  });
  if (inspected.status !== 'running' || !inspected.healthy) {
    throw new ManagedComposeError('CONTAINER_NOT_READY', 'managed service is not running and healthy');
  }
  const container = inspected.containers.find((candidate) => candidate.serviceName === serviceName);
  if (!container) throw new ManagedComposeError('CONTAINER_SERVICE_NOT_FOUND', 'managed service container is missing');
  const args = ['exec'];
  if (stdin !== null) args.push('--interactive');
  args.push(container.containerId, ...argv);
  const result = await runDocker(args, {
    repoRoot: context.repositoryRealpath,
    signal,
    timeoutMs,
    maxOutputBytes,
    stdin,
    returnResult: true,
    acceptedExitCodes,
    reasonCode: 'CONTAINER_EXEC_FAILED',
    dependencies,
  });
  return Object.freeze({ code: result.code, signal: null, stdout: result.stdout, stderr: result.stderr });
}
