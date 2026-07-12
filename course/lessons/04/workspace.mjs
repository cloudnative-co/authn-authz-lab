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

export async function initializeLesson04Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '04', template: await template() });
}

export function inspectLesson04Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '04' });
}

export function preflightLesson04WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '04' });
}

export function readLesson04Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '04' });
}

export function readLesson04Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '04' });
}

export function writeLesson04Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '04' });
}
