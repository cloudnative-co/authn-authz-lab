import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { evaluateLesson05Submission, Lesson05SubmissionError } from './assessment.mjs';
import { runLesson05Scenario } from './scenario.mjs';
import {
  initializeLesson05Workspace,
  inspectLesson05Workspace,
  preflightLesson05WorkspaceReset,
  readLesson05Runtime,
  readLesson05Submission,
  writeLesson05Runtime,
} from './workspace.mjs';

export const LESSON_05_ID = '05';
export const LESSON_05_WORKSPACE_RESOURCE_ID = 'data:lesson-05-workspace';
export const LESSON_05_CHECK_IDS = Object.freeze(['AA05-C1', 'AA05-C2']);

export const lesson05ExecutionPolicy = runtimeLessonExecutionPolicy;

export const runLesson05 = createRuntimeLessonRunner({
  id: LESSON_05_ID,
  checkIds: LESSON_05_CHECK_IDS,
  workspaceResourceId: LESSON_05_WORKSPACE_RESOURCE_ID,
  initializeWorkspace: initializeLesson05Workspace,
  inspectWorkspace: inspectLesson05Workspace,
  preflightWorkspace: preflightLesson05WorkspaceReset,
  readRuntime: readLesson05Runtime,
  readSubmission: readLesson05Submission,
  writeRuntime: writeLesson05Runtime,
  runScenario: runLesson05Scenario,
  evaluate: evaluateLesson05Submission,
  SubmissionError: Lesson05SubmissionError,
});
