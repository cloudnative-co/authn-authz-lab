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
import {
  assertNoSymlinkComponents,
  ensureStateDirectory,
  loadStateMarkerContext,
} from '../../runner/state.mjs';
import { LESSON_07_RESOURCE_ID, lesson07ManagedComposeSpec } from './lab-contract.mjs';

const SECRET_FILES = Object.freeze(['alice-password', 'kdc-master-password']);
const ALICE_PASSWORD = 'alice-password-for-lesson-07';
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

function validSecret(value) {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= 12
    && Buffer.byteLength(value, 'utf8') <= 256
    && !/[\u0000\r\n]/u.test(value);
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

async function validateSecretFile(context, directory, name) {
  const path = resolve(directory, name);
  await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: path,
    expectedLeaf: 'file',
    label: `Lesson 07 ${name}`,
  });
  const stats = await lstat(path);
  const value = await readFile(path, 'utf8');
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600
      || !validSecret(value)
      || (name === 'alice-password' && value !== ALICE_PASSWORD)) {
    throw new ManagedComposeError('CONTAINER_SECRET_INVALID', 'Lesson 07 secret state is invalid');
  }
  return value;
}

export async function ensureLesson07Secrets({ stateRoot, repoRoot } = {}) {
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const directory = await ensureStateDirectory(context, 'containers', LESSON_07_RESOURCE_ID);
  const values = {
    'alice-password': ALICE_PASSWORD,
    'kdc-master-password': randomBytes(32).toString('base64url'),
  };
  let created = false;
  for (const name of SECRET_FILES) {
    created = await writeSecret(resolve(directory, name), values[name]) || created;
    await validateSecretFile(context, directory, name);
  }
  return Object.freeze({ directory, created });
}

export async function readLesson07AlicePassword({ stateRoot, repoRoot } = {}) {
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const directory = resolve(context.stateRoot, 'containers', LESSON_07_RESOURCE_ID);
  return validateSecretFile(context, directory, 'alice-password');
}

export async function inspectLesson07Docker({ stateRoot, repoRoot, signal, dependencies } = {}) {
  const prerequisites = await inspectDockerPrerequisites({ repoRoot, signal, dependencies });
  if (!prerequisites.supported) return { ...prerequisites, container: null };
  const secretDirectory = resolve(stateRoot, 'containers', LESSON_07_RESOURCE_ID);
  let container;
  try {
    container = await inspectManagedComposeProject({
      stateRoot,
      repoRoot,
      spec: lesson07ManagedComposeSpec({ secretDirectory, repoRoot }),
      signal,
      dependencies,
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    container = { status: 'absent', healthy: false, serviceCount: 0, adopted: false };
  }
  return Object.freeze({
    supported: true,
    reasonCode: null,
    diagnostics: prerequisites.diagnostics,
    container,
  });
}

export async function ensureLesson07Container({ stateRoot, repoRoot, signal, dependencies } = {}) {
  const secrets = await ensureLesson07Secrets({ stateRoot, repoRoot });
  const result = await ensureManagedComposeProject({
    stateRoot,
    repoRoot,
    spec: lesson07ManagedComposeSpec({ secretDirectory: secrets.directory, repoRoot }),
    signal,
    dependencies,
  });
  return Object.freeze({ ...result, secretsCreated: secrets.created });
}

export function stopLesson07Container({ stateRoot, repoRoot, signal, remove = false, dependencies } = {}) {
  return stopManagedComposeProjects({
    stateRoot,
    repoRoot,
    resourceIds: [LESSON_07_RESOURCE_ID],
    signal,
    remove,
    dependencies,
  }).then((outcomes) => outcomes[0] ?? Object.freeze({
    resourceId: LESSON_07_RESOURCE_ID,
    status: 'safe-noop',
    reasonCode: 'CONTAINER_NOT_RECORDED',
  }));
}

export { ManagedComposeError };
