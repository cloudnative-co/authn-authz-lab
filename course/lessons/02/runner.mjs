import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { evaluateLesson02Submission, Lesson02SubmissionError } from './assessment.mjs';
import { runLesson02Scenario } from './scenario.mjs';
import {
  initializeLesson02Workspace,
  inspectLesson02Workspace,
  preflightLesson02WorkspaceReset,
  readLesson02Runtime,
  readLesson02Submission,
  writeLesson02Runtime,
} from './workspace.mjs';

export const LESSON_02_ID = '02';
export const LESSON_02_WORKSPACE_RESOURCE_ID = 'data:lesson-02-workspace';
export const LESSON_02_CHECK_IDS = Object.freeze(['AA02-C1', 'AA02-C2', 'AA02-C3']);

export const lesson02ExecutionPolicy = runtimeLessonExecutionPolicy;

export const runLesson02 = createRuntimeLessonRunner({
  id: LESSON_02_ID,
  checkIds: LESSON_02_CHECK_IDS,
  workspaceResourceId: LESSON_02_WORKSPACE_RESOURCE_ID,
  initializeWorkspace: initializeLesson02Workspace,
  inspectWorkspace: inspectLesson02Workspace,
  preflightWorkspace: preflightLesson02WorkspaceReset,
  readRuntime: readLesson02Runtime,
  readSubmission: readLesson02Submission,
  writeRuntime: writeLesson02Runtime,
  runScenario: runLesson02Scenario,
  evaluate: evaluateLesson02Submission,
  SubmissionError: Lesson02SubmissionError,
});
