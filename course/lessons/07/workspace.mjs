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

export async function initializeLesson07Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '07', template: await template() });
}

export function inspectLesson07Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '07' });
}

export function preflightLesson07WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '07' });
}

export function readLesson07Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '07' });
}

export function readLesson07Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '07' });
}

export function writeLesson07Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '07' });
}

