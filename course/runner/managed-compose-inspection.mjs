import { digestCanonical } from './canonical.mjs';
import { LABELS } from './managed-compose-constants.mjs';
import {
  ManagedComposeError,
  resolvedConfigDigest,
  runDocker,
} from './managed-compose-command.mjs';

function exactLabelSet(labels, record, serviceName) {
  return labels?.[LABELS.courseId] === record.labels.courseId
    && labels?.[LABELS.installId] === record.labels.installId
    && labels?.[LABELS.resourceId] === record.labels.resourceId
    && labels?.[LABELS.composeProject] === record.labels.composeProject
    && labels?.[LABELS.composeService] === serviceName;
}

function normalizeConfigHash(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/^sha256:/u, '');
  return /^[a-f0-9]{64}$/u.test(normalized) ? normalized : null;
}

function validatePublishedPorts(inspected, record) {
  for (const expected of record.publishedPorts.filter(({ serviceName }) => serviceName === inspected.serviceName)) {
    const key = `${expected.containerPort}/${expected.protocol}`;
    const bindings = inspected.document.HostConfig?.PortBindings?.[key];
    if (!Array.isArray(bindings) || !bindings.some((binding) => (
      binding.HostIp === expected.host && Number(binding.HostPort) === expected.hostPort
    ))) return false;
  }
  return true;
}

async function inspectContainer(containerId, record, options) {
  let output;
  try {
    output = await runDocker(['inspect', '--type', 'container', containerId], {
      ...options,
      timeoutMs: 5_000,
      reasonCode: 'CONTAINER_INSPECT_FAILED',
    });
  } catch (error) {
    if (error.reasonCode === 'CONTAINER_INSPECT_FAILED') return null;
    throw error;
  }
  let document;
  try {
    const parsed = JSON.parse(output);
    document = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : null;
  } catch {
    document = null;
  }
  if (!document || document.Id !== containerId) {
    throw new ManagedComposeError('CONTAINER_INSPECT_INVALID', 'Docker inspect returned an invalid identity');
  }
  const serviceName = document.Config?.Labels?.[LABELS.composeService];
  if (!record.expectedServices.includes(serviceName) || !exactLabelSet(document.Config?.Labels, record, serviceName)) {
    throw new ManagedComposeError('CONTAINER_OWNERSHIP_MISMATCH', 'container labels do not match the record');
  }
  const running = document.State?.Running === true;
  const health = document.State?.Health?.Status ?? null;
  const inspected = {
    document,
    serviceName,
    containerId,
    composeConfigHash: normalizeConfigHash(document.Config?.Labels?.[LABELS.composeConfigHash]),
    status: running ? 'running' : 'stopped',
    healthy: running && (health === null || health === 'healthy'),
  };
  if (!validatePublishedPorts(inspected, record)) {
    throw new ManagedComposeError('CONTAINER_PORT_MISMATCH', 'container port binding does not match the record');
  }
  return inspected;
}

export async function candidateIds(record, options) {
  const args = [
    'ps', '--all', '--no-trunc',
    '--filter', `label=${LABELS.composeProject}=${record.labels.composeProject}`,
    '--format', '{{.ID}}',
  ];
  const output = await runDocker(args, {
    ...options,
    timeoutMs: 5_000,
    reasonCode: 'CONTAINER_DISCOVERY_FAILED',
  });
  const ids = output.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
  if (ids.some((value) => !/^[a-f0-9]{64}$/u.test(value)) || new Set(ids).size !== ids.length) {
    throw new ManagedComposeError('CONTAINER_DISCOVERY_INVALID', 'Docker returned invalid container identities');
  }
  return ids.sort();
}

function exactProjectResourceLabels(labels, record, key, kind) {
  const composeKey = kind === 'network' ? LABELS.composeNetwork : LABELS.composeVolume;
  return labels?.[LABELS.courseId] === record.labels.courseId
    && labels?.[LABELS.installId] === record.labels.installId
    && labels?.[LABELS.resourceId] === record.labels.resourceId
    && labels?.[LABELS.composeProject] === record.labels.composeProject
    && labels?.[composeKey] === key;
}

export async function inspectNetworks(record, options, {
  allowAbsent = false,
  allowPartial = false,
} = {}) {
  const output = await runDocker([
    'network', 'ls', '--no-trunc',
    '--filter', `label=${LABELS.composeProject}=${record.composeProject}`,
    '--format', '{{.ID}}',
  ], {
    ...options,
    timeoutMs: 5_000,
    reasonCode: 'CONTAINER_NETWORK_DISCOVERY_FAILED',
  });
  const ids = output.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean).sort();
  if (ids.some((id) => !/^[a-f0-9]{64}$/u.test(id)) || new Set(ids).size !== ids.length) {
    throw new ManagedComposeError('CONTAINER_NETWORK_DISCOVERY_INVALID', 'Docker returned invalid network IDs');
  }
  const networks = [];
  for (const networkId of ids) {
    const source = await runDocker(['network', 'inspect', networkId], {
      ...options,
      timeoutMs: 5_000,
      reasonCode: 'CONTAINER_NETWORK_INSPECT_FAILED',
    });
    let document;
    try {
      const parsed = JSON.parse(source);
      document = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : null;
    } catch {
      document = null;
    }
    const networkKey = document?.Labels?.[LABELS.composeNetwork];
    if (!document
        || document.Id !== networkId
        || !record.expectedNetworks.includes(networkKey)
        || !exactProjectResourceLabels(document.Labels, record, networkKey, 'network')) {
      throw new ManagedComposeError('CONTAINER_NETWORK_OWNERSHIP_MISMATCH', 'Compose network labels do not match');
    }
    networks.push({ networkKey, networkId, name: document.Name });
  }
  networks.sort((left, right) => left.networkKey.localeCompare(right.networkKey));
  if (!allowPartial
      && !(allowAbsent && networks.length === 0)
      && digestCanonical(networks.map(({ networkKey }) => networkKey)) !== digestCanonical(record.expectedNetworks)) {
    throw new ManagedComposeError('CONTAINER_NETWORK_SET_MISMATCH', 'Compose network set is incomplete or unexpected');
  }
  return networks;
}

export async function inspectVolumes(record, options, {
  allowAbsent = false,
  allowPartial = false,
} = {}) {
  const output = await runDocker([
    'volume', 'ls',
    '--filter', `label=${LABELS.composeProject}=${record.composeProject}`,
    '--format', '{{.Name}}',
  ], {
    ...options,
    timeoutMs: 5_000,
    reasonCode: 'CONTAINER_VOLUME_DISCOVERY_FAILED',
  });
  const names = output.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean).sort();
  if (names.some((name) => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(name))
      || new Set(names).size !== names.length) {
    throw new ManagedComposeError('CONTAINER_VOLUME_DISCOVERY_INVALID', 'Docker returned invalid volume names');
  }
  const volumes = [];
  for (const name of names) {
    const source = await runDocker(['volume', 'inspect', name], {
      ...options,
      timeoutMs: 5_000,
      reasonCode: 'CONTAINER_VOLUME_INSPECT_FAILED',
    });
    let document;
    try {
      const parsed = JSON.parse(source);
      document = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : null;
    } catch {
      document = null;
    }
    const volumeKey = document?.Labels?.[LABELS.composeVolume];
    if (!document
        || document.Name !== name
        || !record.expectedVolumes.includes(volumeKey)
        || !exactProjectResourceLabels(document.Labels, record, volumeKey, 'volume')) {
      throw new ManagedComposeError('CONTAINER_VOLUME_OWNERSHIP_MISMATCH', 'Compose volume labels do not match');
    }
    volumes.push({ volumeKey, name });
  }
  volumes.sort((left, right) => left.volumeKey.localeCompare(right.volumeKey));
  if (!allowPartial
      && !(allowAbsent && volumes.length === 0)
      && digestCanonical(volumes.map(({ volumeKey }) => volumeKey)) !== digestCanonical(record.expectedVolumes)) {
    throw new ManagedComposeError('CONTAINER_VOLUME_SET_MISMATCH', 'Compose volume set is incomplete or unexpected');
  }
  return volumes;
}

function assertNoUnownedVolumeMounts(containers, volumes) {
  const owned = new Set(volumes.map(({ name }) => name));
  for (const container of containers) {
    for (const mount of container.document.Mounts ?? []) {
      if (mount.Type === 'volume' && !owned.has(mount.Name)) {
        throw new ManagedComposeError(
          'CONTAINER_ANONYMOUS_VOLUME_UNOWNED',
          'managed container uses an unlabeled volume',
        );
      }
    }
  }
}

export async function inspectInternal({
  context,
  record,
  signal,
  dependencies,
  requireCurrentConfig = true,
  allowOrphanedProjectResources = false,
  allowMissingRecordedResources = false,
}) {
  const options = { repoRoot: context.repositoryRealpath, signal, dependencies };
  let currentDigest = record.configDigest;
  if (requireCurrentConfig) {
    currentDigest = await resolvedConfigDigest(record, options);
    if (record.configDigest !== '0'.repeat(64) && currentDigest !== record.configDigest) {
      throw new ManagedComposeError('CONTAINER_CONFIG_DRIFT', 'Compose config changed after ownership was recorded');
    }
  }
  const ids = await candidateIds(record, options);
  const containers = [];
  for (const id of ids) {
    const inspected = await inspectContainer(id, record, options);
    if (inspected) containers.push(inspected);
  }
  const services = containers.map(({ serviceName }) => serviceName).sort();
  if (new Set(services).size !== services.length) {
    throw new ManagedComposeError('CONTAINER_OWNERSHIP_AMBIGUOUS', 'multiple containers claim one managed service');
  }
  if (!allowMissingRecordedResources
      && containers.length > 0
      && digestCanonical(services) !== digestCanonical(record.expectedServices)) {
    throw new ManagedComposeError('CONTAINER_SERVICE_SET_MISMATCH', 'managed Compose service set is incomplete or unexpected');
  }
  if (record.status !== 'pending' && containers.length > 0) {
    const recorded = [...record.containers]
      .map(({ serviceName, containerId }) => ({ serviceName, containerId }))
      .sort((left, right) => left.serviceName.localeCompare(right.serviceName));
    const actual = containers
      .map(({ serviceName, containerId }) => ({ serviceName, containerId }))
      .sort((left, right) => left.serviceName.localeCompare(right.serviceName));
    if (!allowMissingRecordedResources && digestCanonical(recorded) !== digestCanonical(actual)) {
      throw new ManagedComposeError('CONTAINER_IDENTITY_MISMATCH', 'container IDs changed after ownership was recorded');
    }
    if (allowMissingRecordedResources && actual.some((candidate) => !recorded.some((expected) => (
      expected.serviceName === candidate.serviceName && expected.containerId === candidate.containerId
    )))) {
      throw new ManagedComposeError('CONTAINER_IDENTITY_MISMATCH', 'container IDs changed after ownership was recorded');
    }
    for (const inspected of containers) {
      const expected = record.containers.find(({ serviceName }) => serviceName === inspected.serviceName);
      if (expected.composeConfigHash !== inspected.composeConfigHash) {
        throw new ManagedComposeError('CONTAINER_CONFIG_HASH_MISMATCH', 'Compose config hash changed');
      }
    }
  }
  const allowAbsentResources = record.status === 'pending' && containers.length === 0;
  const [networks, volumes] = await Promise.all([
    inspectNetworks(record, options, {
      allowAbsent: allowAbsentResources,
      allowPartial: allowMissingRecordedResources,
    }),
    inspectVolumes(record, options, {
      allowAbsent: allowAbsentResources,
      allowPartial: allowMissingRecordedResources,
    }),
  ]);
  assertNoUnownedVolumeMounts(containers, volumes);
  if (record.status !== 'pending') {
    const networkMismatch = allowMissingRecordedResources
      ? networks.some((actual) => !record.networks.some((expected) => (
        expected.networkKey === actual.networkKey
          && expected.networkId === actual.networkId
          && expected.name === actual.name
      )))
      : digestCanonical(record.networks) !== digestCanonical(networks);
    const volumeMismatch = allowMissingRecordedResources
      ? volumes.some((actual) => !record.volumes.some((expected) => (
        expected.volumeKey === actual.volumeKey && expected.name === actual.name
      )))
      : digestCanonical(record.volumes) !== digestCanonical(volumes);
    if (networkMismatch || volumeMismatch) {
      throw new ManagedComposeError('CONTAINER_PROJECT_RESOURCE_MISMATCH', 'Compose project resources changed');
    }
  }
  if (containers.length === 0) {
    if (!allowOrphanedProjectResources && (networks.length !== 0 || volumes.length !== 0)) {
      throw new ManagedComposeError('CONTAINER_PROJECT_ORPHANED_RESOURCE', 'Compose project resources remain without containers');
    }
    return { status: 'absent', currentDigest, containers, networks, volumes };
  }
  const running = containers.every(({ status }) => status === 'running');
  const stopped = containers.every(({ status }) => status === 'stopped');
  if (!running && !stopped) {
    throw new ManagedComposeError('CONTAINER_PARTIAL_STATE', 'managed containers have inconsistent states');
  }
  return {
    status: running ? 'running' : 'stopped',
    healthy: running && containers.every(({ healthy }) => healthy),
    currentDigest,
    containers,
    networks,
    volumes,
  };
}

export function persistedContainers(containers) {
  return containers
    .map(({ serviceName, containerId, composeConfigHash, status }) => ({
      serviceName, containerId, composeConfigHash, status,
    }))
    .sort((left, right) => left.serviceName.localeCompare(right.serviceName));
}

export function publicInspection(value, { adopted = false } = {}) {
  return Object.freeze({
    status: value.status,
    healthy: value.healthy ?? false,
    serviceCount: value.containers?.length ?? 0,
    adopted,
  });
}
