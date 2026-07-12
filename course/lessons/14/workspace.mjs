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

export async function initializeLesson14Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '14', template: await template() });
}

export function inspectLesson14Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '14' });
}

export function preflightLesson14WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '14' });
}

export function readLesson14Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '14' });
}

export function readLesson14Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '14' });
}

export function writeLesson14Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '14' });
}
