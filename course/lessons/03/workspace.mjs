import { readFile } from 'node:fs/promises';
import {
  initializeLessonWorkspace,
  inspectLessonWorkspace,
  preflightLessonWorkspaceReset,
  readLessonRuntime,
  readLessonSubmission,
  writeLessonRuntime,
} from '../../runner/lesson-workspace.mjs';

let templatePromise;

async function template() {
  templatePromise ??= readFile(new URL('./workspace-template.json', import.meta.url), 'utf8')
    .then((value) => JSON.parse(value));
  return structuredClone(await templatePromise);
}

export async function initializeLesson03Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '03', template: await template() });
}

export function inspectLesson03Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '03' });
}

export function preflightLesson03WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '03' });
}

export function readLesson03Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '03' });
}

export function readLesson03Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '03' });
}

export function writeLesson03Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '03' });
}
