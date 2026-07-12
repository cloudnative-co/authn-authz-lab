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

export async function initializeLesson02Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '02', template: await template() });
}

export function inspectLesson02Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '02' });
}

export function preflightLesson02WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '02' });
}

export function readLesson02Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '02' });
}

export function readLesson02Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '02' });
}

export function writeLesson02Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '02' });
}
