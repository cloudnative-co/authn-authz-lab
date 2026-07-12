import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { evaluateLesson04Submission, Lesson04SubmissionError } from './assessment.mjs';
import { runLesson04Scenario } from './scenario.mjs';
import {
  initializeLesson04Workspace,
  inspectLesson04Workspace,
  preflightLesson04WorkspaceReset,
  readLesson04Runtime,
  readLesson04Submission,
  writeLesson04Runtime,
} from './workspace.mjs';

export const LESSON_04_ID = '04';
export const LESSON_04_WORKSPACE_RESOURCE_ID = 'data:lesson-04-workspace';
export const LESSON_04_CHECK_IDS = Object.freeze(['AA04-C1', 'AA04-C2', 'AA04-C3', 'AA04-C4']);

export const lesson04ExecutionPolicy = runtimeLessonExecutionPolicy;

export const runLesson04 = createRuntimeLessonRunner({
  id: LESSON_04_ID,
  checkIds: LESSON_04_CHECK_IDS,
  workspaceResourceId: LESSON_04_WORKSPACE_RESOURCE_ID,
  initializeWorkspace: initializeLesson04Workspace,
  inspectWorkspace: inspectLesson04Workspace,
  preflightWorkspace: preflightLesson04WorkspaceReset,
  readRuntime: readLesson04Runtime,
  readSubmission: readLesson04Submission,
  writeRuntime: writeLesson04Runtime,
  runScenario: runLesson04Scenario,
  evaluate: evaluateLesson04Submission,
  SubmissionError: Lesson04SubmissionError,
});
