import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ensureManagedComposeProject,
  inspectDockerPrerequisites,
  inspectManagedComposeProject,
  ManagedComposeError,
  stopManagedComposeProjects,
} from '../../runner/managed-compose.mjs';
import { probeTcpPort } from '../../runner/port.mjs';
import {
  assertNoSymlinkComponents,
  ensureStateDirectory,
  loadStateMarkerContext,
} from '../../runner/state.mjs';

export const LESSON_06_CONTAINER_RESOURCE_ID = 'ldap-directory';
export const LESSON_06_LDAP_PORT_ID = 'lesson-06-ldap-tcp';
const EXTERNAL_SERVICE_ID = 'lesson-06-directory';
const SECRET_FILES = Object.freeze([
  'admin-password', 'service-password', 'alice-password', 'bob-password',
]);
const TRAINING_PASSWORDS = Object.freeze({
  'alice-password': 'Café-password-for-lesson-06',
  'bob-password': 'bob-password-for-lesson-06',
});
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

function externalService(foundation) {
  const service = foundation.indexes.externalServices.get(EXTERNAL_SERVICE_ID);
  const port = service ? foundation.indexes.ports.get(service.portId) : null;
  if (!service
      || service.kind !== 'ldap-directory'
      || service.lessonId !== '06'
      || service.resourceId !== LESSON_06_CONTAINER_RESOURCE_ID
      || service.composeService !== 'ldap'
      || !port
      || port.resourceId !== service.resourceId
      || port.host !== '127.0.0.1'
      || port.protocol !== 'tcp') {
    throw new Error('manifestのLesson 06 LDAP設定が不正です');
  }
  return { service, port };
}

async function writeSecret(path, value) {
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(value, 'utf8');
    await handle.sync();
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return false;
  } finally {
    await handle?.close();
  }
}

function validSecret(value) {
  return typeof value === 'string'
    && value.length >= 12
    && value.length <= 256
    && !/[\u0000\r\n]/u.test(value);
}

export async function ensureLesson06Secrets({ stateRoot, repoRoot } = {}) {
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const directory = await ensureStateDirectory(
    context,
    'containers',
    LESSON_06_CONTAINER_RESOURCE_ID,
  );
  const values = {
    'admin-password': randomBytes(32).toString('base64url'),
    'service-password': randomBytes(32).toString('base64url'),
    ...TRAINING_PASSWORDS,
  };
  let created = false;
  for (const name of SECRET_FILES) {
    const path = resolve(directory, name);
    created = await writeSecret(path, values[name]) || created;
    await assertNoSymlinkComponents({
      anchor: context.stateRoot,
      target: path,
      expectedLeaf: 'file',
      label: `Lesson 06 ${name}`,
    });
    const stats = await lstat(path);
    const actual = await readFile(path, 'utf8');
    if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600
        || !validSecret(actual)
        || (Object.hasOwn(TRAINING_PASSWORDS, name) && actual !== TRAINING_PASSWORDS[name])) {
      throw new ManagedComposeError('CONTAINER_SECRET_INVALID', 'Lesson 06 secret state is invalid');
    }
  }
  return Object.freeze({ directory, created });
}

export function lesson06ComposeSpec(foundation, secretDirectory) {
  const { service, port } = externalService(foundation);
  if (typeof secretDirectory !== 'string' || !secretDirectory.startsWith(foundation.repositoryRealpath)) {
    throw new TypeError('secretDirectory is invalid');
  }
  return Object.freeze({
    resourceId: service.resourceId,
    composeFile: service.composeFile,
    buildServices: Object.freeze([service.composeService]),
    targetServices: Object.freeze([service.composeService]),
    expectedServices: Object.freeze([service.composeService]),
    expectedNetworks: Object.freeze(['default']),
    expectedVolumes: Object.freeze([]),
    noDependencies: true,
    publishedPorts: Object.freeze([Object.freeze({
      serviceName: service.composeService,
      host: port.host,
      hostPort: port.port,
      containerPort: 389,
      protocol: 'tcp',
    })]),
    composeEnvironment: Object.freeze({
      LESSON06_LDAP_PORT: String(port.port),
      LESSON06_SECRET_DIR: secretDirectory,
    }),
    supplementalFiles: SECRET_FILES,
  });
}

export function lesson06ProjectAppEnvironment(foundation, stateRoot) {
  const { service, port } = externalService(foundation);
  const passwordPath = resolve(foundation.repositoryRealpath, service.bindPasswordStatePath);
  const expectedPasswordPath = resolve(
    stateRoot,
    'containers',
    LESSON_06_CONTAINER_RESOURCE_ID,
    'service-password',
  );
  if (passwordPath !== expectedPasswordPath) throw new Error('manifestのbind password pathが不正です');
  return Object.freeze({
    LESSON06_LDAP_URL: `ldap://${port.host}:${port.port}`,
    LESSON06_LDAP_BASE_DN: service.baseDn,
    LESSON06_LDAP_PEOPLE_BASE_DN: service.peopleBaseDn,
    LESSON06_LDAP_GROUPS_BASE_DN: service.groupsBaseDn,
    LESSON06_LDAP_BIND_DN: service.bindDn,
    LESSON06_LDAP_BIND_PASSWORD_FILE: passwordPath,
  });
}

export async function inspectLesson06Docker({ foundation, stateRoot, signal, dependencies } = {}) {
  const prerequisites = await inspectDockerPrerequisites({
    repoRoot: foundation.repositoryRealpath,
    signal,
    dependencies,
  });
  if (!prerequisites.supported) return { ...prerequisites, container: null };
  const secretDirectory = resolve(
    stateRoot,
    'containers',
    LESSON_06_CONTAINER_RESOURCE_ID,
  );
  const spec = lesson06ComposeSpec(foundation, secretDirectory);
  let container;
  try {
    container = await inspectManagedComposeProject({
      stateRoot,
      repoRoot: foundation.repositoryRealpath,
      spec,
      signal,
      dependencies,
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    container = { status: 'absent', healthy: false, serviceCount: 0, adopted: false };
  }
  if (container.status !== 'absent') {
    return { supported: true, reasonCode: null, diagnostics: prerequisites.diagnostics, container };
  }
  const { port } = externalService(foundation);
  const availability = await (dependencies?.probePort ?? probeTcpPort)({
    host: port.host,
    port: port.port,
    signal,
  });
  if (!availability.available) {
    return {
      supported: false,
      reasonCode: 'PREREQUISITE_LDAP_PORT_IN_USE',
      diagnostics: [...prerequisites.diagnostics, {
        id: 'lesson06.ldap-port',
        status: 'fail',
        actual: 'occupied-unowned',
        expected: `${port.host}:${port.port} available`,
        message: `port ${port.port}を使用中のprocessまたはcontainerを停止してください`,
      }],
      container,
    };
  }
  return {
    supported: true,
    reasonCode: null,
    diagnostics: [...prerequisites.diagnostics, {
      id: 'lesson06.ldap-port',
      status: 'pass',
      actual: 'available',
      expected: `${port.host}:${port.port} available`,
      message: 'Lesson 06のLDAP portを利用できます',
    }],
    container,
  };
}

export async function ensureLesson06Container({
  foundation, stateRoot, signal, dependencies,
} = {}) {
  const secrets = await ensureLesson06Secrets({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
  });
  const result = await ensureManagedComposeProject({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    spec: lesson06ComposeSpec(foundation, secrets.directory),
    signal,
    dependencies,
  });
  return Object.freeze({ ...result, secretsCreated: secrets.created });
}

export function stopLesson06Container({ foundation, stateRoot, signal, remove = false, dependencies } = {}) {
  return stopManagedComposeProjects({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    resourceIds: [LESSON_06_CONTAINER_RESOURCE_ID],
    signal,
    remove,
    dependencies,
  }).then((outcomes) => outcomes[0] ?? Object.freeze({
    resourceId: LESSON_06_CONTAINER_RESOURCE_ID,
    status: 'safe-noop',
    reasonCode: 'CONTAINER_NOT_RECORDED',
  }));
}

export { ManagedComposeError };
