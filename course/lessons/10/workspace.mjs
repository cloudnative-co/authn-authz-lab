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

export async function initializeLesson10Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '10', template: await template() });
}

export function inspectLesson10Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '10' });
}

export function preflightLesson10WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '10' });
}

export function readLesson10Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '10' });
}

export function readLesson10Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '10' });
}

export function writeLesson10Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '10' });
}
