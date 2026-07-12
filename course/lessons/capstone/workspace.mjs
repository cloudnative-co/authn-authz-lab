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

export async function initializeCapstoneWorkspace(options = {}) {
  return initializeLessonWorkspace({ ...options, lessonId: 'capstone', template: await template() });
}

export function inspectCapstoneWorkspace(options = {}) {
  return inspectLessonWorkspace({ ...options, lessonId: 'capstone' });
}

export function preflightCapstoneWorkspaceReset(options = {}) {
  return preflightLessonWorkspaceReset({ ...options, lessonId: 'capstone' });
}

export function readCapstoneSubmission(options = {}) {
  return readLessonSubmission({ ...options, lessonId: 'capstone' });
}

export function readCapstoneRuntime(options = {}) {
  return readLessonRuntime({ ...options, lessonId: 'capstone' });
}

export function writeCapstoneRuntime(options = {}) {
  return writeLessonRuntime({ ...options, lessonId: 'capstone' });
}
