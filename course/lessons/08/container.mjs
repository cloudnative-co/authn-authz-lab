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
import {
  LESSON_08_RESOURCE_ID,
  LESSON_08_SECRET_FILES,
  lesson08ManagedComposeSpec,
} from './lab-contract.mjs';

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

function validSecret(value) {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= 20
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
    label: `Lesson 08 ${name}`,
  });
  const [stats, value] = await Promise.all([lstat(path), readFile(path, 'utf8')]);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600
      || !validSecret(value)) {
    throw new ManagedComposeError('CONTAINER_SECRET_INVALID', 'Lesson 08 secret state is invalid');
  }
  return value;
}

export async function ensureLesson08Secrets({ stateRoot, repoRoot } = {}) {
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const directory = await ensureStateDirectory(context, 'containers', LESSON_08_RESOURCE_ID);
  let created = false;
  for (const name of LESSON_08_SECRET_FILES) {
    created = await writeSecret(resolve(directory, name), randomBytes(32).toString('base64url')) || created;
    await validateSecretFile(context, directory, name);
  }
  return Object.freeze({ directory, created });
}

export async function readLesson08AlicePassword({ stateRoot, repoRoot } = {}) {
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const directory = resolve(context.stateRoot, 'containers', LESSON_08_RESOURCE_ID);
  return validateSecretFile(context, directory, 'alice-password');
}

export async function inspectLesson08Docker({ stateRoot, repoRoot, signal, dependencies } = {}) {
  const prerequisites = await inspectDockerPrerequisites({ repoRoot, signal, dependencies });
  if (!prerequisites.supported) return { ...prerequisites, container: null };
  const secretDirectory = resolve(stateRoot, 'containers', LESSON_08_RESOURCE_ID);
  let container;
  try {
    container = await inspectManagedComposeProject({
      stateRoot,
      repoRoot,
      spec: lesson08ManagedComposeSpec({ secretDirectory, repoRoot }),
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

export async function ensureLesson08Container({ stateRoot, repoRoot, signal, dependencies } = {}) {
  const secrets = await ensureLesson08Secrets({ stateRoot, repoRoot });
  const options = {
    stateRoot,
    repoRoot,
    spec: lesson08ManagedComposeSpec({ secretDirectory: secrets.directory, repoRoot }),
    signal,
    dependencies,
  };
  let result;
  try {
    result = await ensureManagedComposeProject(options);
  } catch (error) {
    if (!(error instanceof ManagedComposeError) || error.reasonCode !== 'CONTAINER_START_FAILED') {
      throw error;
    }
    await new Promise((resolvePromise, rejectPromise) => {
      if (signal?.aborted) {
        rejectPromise(signal.reason ?? new ManagedComposeError('OPERATION_ABORTED', 'operation aborted'));
        return;
      }
      let timer;
      const onAbort = () => {
        clearTimeout(timer);
        rejectPromise(signal.reason ?? new ManagedComposeError('OPERATION_ABORTED', 'operation aborted'));
      };
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolvePromise();
      }, 1000);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    result = await ensureManagedComposeProject(options);
  }
  return Object.freeze({ ...result, secretsCreated: secrets.created });
}

export function stopLesson08Container({ stateRoot, repoRoot, signal, remove = false, dependencies } = {}) {
  return stopManagedComposeProjects({
    stateRoot,
    repoRoot,
    resourceIds: [LESSON_08_RESOURCE_ID],
    signal,
    remove,
    dependencies,
  }).then((outcomes) => outcomes[0] ?? Object.freeze({
    resourceId: LESSON_08_RESOURCE_ID,
    status: 'safe-noop',
    reasonCode: 'CONTAINER_NOT_RECORDED',
  }));
}

export { ManagedComposeError };
