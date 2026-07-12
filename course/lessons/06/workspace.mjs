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

export async function initializeLesson06Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '06', template: await template() });
}

export function inspectLesson06Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '06' });
}

export function preflightLesson06WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '06' });
}

export function readLesson06Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '06' });
}

export function readLesson06Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '06' });
}

export function writeLesson06Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '06' });
}
