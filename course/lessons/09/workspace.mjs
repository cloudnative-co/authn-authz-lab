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

export async function initializeLesson09Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '09', template: await template() });
}

export function inspectLesson09Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '09' });
}

export function preflightLesson09WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '09' });
}

export function readLesson09Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '09' });
}

export function readLesson09Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '09' });
}

export function writeLesson09Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '09' });
}
