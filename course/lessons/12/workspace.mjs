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

export async function initializeLesson12Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '12', template: await template() });
}

export function inspectLesson12Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '12' });
}

export function preflightLesson12WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '12' });
}

export function readLesson12Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '12' });
}

export function readLesson12Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '12' });
}

export function writeLesson12Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '12' });
}
