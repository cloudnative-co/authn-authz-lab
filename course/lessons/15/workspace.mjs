import { readFile } from 'node:fs/promises';
import {
  initializeLessonWorkspace,
  inspectLessonWorkspace,
  preflightLessonWorkspaceReset,
  readLessonRuntime,
  readLessonSubmission,
  writeLessonRuntime,
} from '../../runner/lesson-workspace.mjs';

async function template() {
  return JSON.parse(await readFile(new URL('./workspace-template.json', import.meta.url), 'utf8'));
}

export async function initializeLesson15Workspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: '15', template: await template() });
}

export function inspectLesson15Workspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: '15' });
}

export function preflightLesson15WorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: '15' });
}

export function readLesson15Submission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: '15' });
}

export function readLesson15Runtime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: '15' });
}

export function writeLesson15Runtime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: '15' });
}
