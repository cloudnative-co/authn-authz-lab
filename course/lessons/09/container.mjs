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
import { LESSON_09_RESOURCE_ID, lesson09ManagedComposeSpec } from './lab-contract.mjs';

const SECRET_FILES = Object.freeze(['control-token', 'user-password']);
const USER_PASSWORD = 'course-password-for-saml-lab';
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

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

async function validateSecret(context, directory, name) {
  const path = resolve(directory, name);
  await assertNoSymlinkComponents({
    anchor: context.stateRoot,
    target: path,
    expectedLeaf: 'file',
    label: `Lesson 09 ${name}`,
  });
  const stats = await lstat(path);
  const value = await readFile(path, 'utf8');
  const valid = name === 'user-password'
    ? value === USER_PASSWORD
    : /^[A-Za-z0-9_-]{43}$/u.test(value);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600 || !valid) {
    throw new ManagedComposeError('CONTAINER_SECRET_INVALID', 'Lesson 09 secret state is invalid');
  }
}

export async function ensureLesson09Secrets({ stateRoot, repoRoot } = {}) {
  const context = await loadStateMarkerContext({ stateRoot, repoRoot });
  const directory = await ensureStateDirectory(context, 'containers', LESSON_09_RESOURCE_ID);
  const values = {
    'control-token': randomBytes(32).toString('base64url'),
    'user-password': USER_PASSWORD,
  };
  let created = false;
  for (const name of SECRET_FILES) {
    created = await writeSecret(resolve(directory, name), values[name]) || created;
    await validateSecret(context, directory, name);
  }
  return Object.freeze({ directory, created });
}

async function waitForSecretMountSync(signal, delayMs = 1_000) {
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
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function ensureLesson09ManagedComposeWithRetry(options, {
  ensureProject = ensureManagedComposeProject,
  waitForRetry = waitForSecretMountSync,
} = {}) {
  try {
    return await ensureProject(options);
  } catch (error) {
    if (!(error instanceof ManagedComposeError) || error.reasonCode !== 'CONTAINER_START_FAILED') {
      throw error;
    }
    await waitForRetry(options.signal);
    return ensureProject(options);
  }
}

export async function inspectLesson09Docker({ stateRoot, repoRoot, signal, dependencies } = {}) {
  const prerequisites = await inspectDockerPrerequisites({ repoRoot, signal, dependencies });
  if (!prerequisites.supported) return { ...prerequisites, container: null };
  const secretDirectory = resolve(stateRoot, 'containers', LESSON_09_RESOURCE_ID);
  let container;
  try {
    container = await inspectManagedComposeProject({
      stateRoot,
      repoRoot,
      spec: lesson09ManagedComposeSpec({ secretDirectory, repoRoot }),
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

export async function ensureLesson09Container({ stateRoot, repoRoot, signal, dependencies } = {}) {
  const secrets = await ensureLesson09Secrets({ stateRoot, repoRoot });
  const result = await ensureLesson09ManagedComposeWithRetry({
    stateRoot,
    repoRoot,
    spec: lesson09ManagedComposeSpec({ secretDirectory: secrets.directory, repoRoot }),
    signal,
    dependencies,
  });
  return Object.freeze({ ...result, secretsCreated: secrets.created });
}

export function stopLesson09Container({ stateRoot, repoRoot, signal, remove = false, dependencies } = {}) {
  return stopManagedComposeProjects({
    stateRoot,
    repoRoot,
    resourceIds: [LESSON_09_RESOURCE_ID],
    signal,
    remove,
    dependencies,
  }).then((outcomes) => outcomes[0] ?? Object.freeze({
    resourceId: LESSON_09_RESOURCE_ID,
    status: 'safe-noop',
    reasonCode: 'CONTAINER_NOT_RECORDED',
  }));
}

export { ManagedComposeError };
