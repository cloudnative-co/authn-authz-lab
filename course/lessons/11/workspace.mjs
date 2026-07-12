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

export async function initializeLesson11Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '11', template: await template() });
}

export function inspectLesson11Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '11' });
}

export function preflightLesson11WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '11' });
}

export function readLesson11Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '11' });
}

export function readLesson11Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '11' });
}

export function writeLesson11Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '11' });
}
