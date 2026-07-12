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

export async function initializeLesson05Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '05', template: await template() });
}

export function inspectLesson05Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '05' });
}

export function preflightLesson05WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '05' });
}

export function readLesson05Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '05' });
}

export function readLesson05Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '05' });
}

export function writeLesson05Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '05' });
}
