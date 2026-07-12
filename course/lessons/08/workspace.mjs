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

export async function initializeLesson08Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '08', template: await template() });
}

export function inspectLesson08Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '08' });
}

export function preflightLesson08WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '08' });
}

export function readLesson08Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '08' });
}

export function readLesson08Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '08' });
}

export function writeLesson08Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '08' });
}
