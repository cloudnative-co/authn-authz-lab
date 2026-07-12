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

export async function initializeLesson13Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '13', template: await template() });
}

export function inspectLesson13Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '13' });
}

export function preflightLesson13WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '13' });
}

export function readLesson13Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '13' });
}

export function readLesson13Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '13' });
}

export function writeLesson13Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '13' });
}
