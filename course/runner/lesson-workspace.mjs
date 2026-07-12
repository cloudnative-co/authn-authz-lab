import { lstat } from 'node:fs/promises';
import {
  assertNoSymlinkComponents,
  assertLessonWorkspaceResettable,
  clearLessonWorkspace,
  ensureStateDirectory,
  loadStateContext,
  readSecureJson,
  resolveStatePath,
  StateSchemaError,
  writeJsonAtomically,
} from './state.mjs';

export class LessonWorkspaceError extends Error {
  constructor(reasonCode, message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LessonWorkspaceError';
    this.reasonCode = reasonCode;
  }
}

function countTodos(value) {
  if (value === 'TODO') return 1;
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((total, child) => total + countTodos(child), 0);
}

async function workspaceContext({ stateRoot, repoRoot, lessonId }) {
  const context = await loadStateContext({ stateRoot, repoRoot });
  if (!context.state) throw new LessonWorkspaceError('PREREQUISITE_SETUP', 'course setup is required');
  await ensureStateDirectory(context, 'submissions', lessonId);
  return context;
}

async function existingFile(context, path, label) {
  const stats = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stats) {
    await assertNoSymlinkComponents({
      anchor: context.stateRoot,
      target: path,
      expectedLeaf: 'file',
      label,
    });
  }
  return stats;
}

export async function initializeLessonWorkspace({
  stateRoot,
  repoRoot,
  lessonId,
  template,
  reset = false,
} = {}) {
  if (reset) await clearLessonWorkspace({ stateRoot, repoRoot, lessonId });
  const context = await workspaceContext({ stateRoot, repoRoot, lessonId });
  const submissionPath = resolveStatePath(context, 'submissions', lessonId, 'submission.json');
  const runtimePath = resolveStatePath(context, 'submissions', lessonId, 'runtime.json');
  const existing = await existingFile(context, submissionPath, `lesson ${lessonId} submission`);
  if (!existing) {
    await writeJsonAtomically({
      anchor: context.stateRoot,
      path: submissionPath,
      value: template,
      exclusive: true,
      label: `lesson ${lessonId} submission`,
    });
  }
  return { submissionPath, runtimePath, submissionCreated: !existing };
}

export function preflightLessonWorkspaceReset(options = {}) {
  return assertLessonWorkspaceResettable(options);
}

async function readWorkspaceFile({ stateRoot, repoRoot, lessonId, name, required }) {
  const context = await loadStateContext({ stateRoot, repoRoot });
  const path = resolveStatePath(context, 'submissions', lessonId, name);
  try {
    return await readSecureJson({ anchor: context.stateRoot, path, label: `lesson ${lessonId} ${name}` });
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (!required) return null;
      throw new LessonWorkspaceError(
        name === 'submission.json' ? 'SUBMISSION_MISSING' : 'RUNTIME_OBSERVATION_MISSING',
        `${name}がありません`,
        { cause: error },
      );
    }
    if (!(error instanceof StateSchemaError)) throw error;
    throw new LessonWorkspaceError(
      name === 'submission.json' ? 'SUBMISSION_JSON_INVALID' : 'RUNTIME_OBSERVATION_INVALID',
      `${name}は有効なJSONではありません`,
      { cause: error },
    );
  }
}

export function readLessonSubmission(options = {}) {
  return readWorkspaceFile({ ...options, name: 'submission.json', required: true });
}

export function readLessonRuntime(options = {}) {
  return readWorkspaceFile({ ...options, name: 'runtime.json', required: true });
}

export async function writeLessonRuntime({ stateRoot, repoRoot, lessonId, runtime } = {}) {
  const context = await workspaceContext({ stateRoot, repoRoot, lessonId });
  const path = resolveStatePath(context, 'submissions', lessonId, 'runtime.json');
  await writeJsonAtomically({
    anchor: context.stateRoot,
    path,
    value: runtime,
    label: `lesson ${lessonId} runtime observation`,
  });
  return path;
}

export async function inspectLessonWorkspace(options = {}) {
  const submission = await readWorkspaceFile({
    ...options, name: 'submission.json', required: false,
  });
  const runtime = await readWorkspaceFile({ ...options, name: 'runtime.json', required: false });
  return {
    submissionPresent: submission !== null,
    runtimePresent: runtime !== null,
    todoCount: submission === null ? null : countTodos(submission),
  };
}
