import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { evaluateLesson03Submission, Lesson03SubmissionError } from './assessment.mjs';
import { runLesson03Scenario } from './scenario.mjs';
import {
  initializeLesson03Workspace,
  inspectLesson03Workspace,
  preflightLesson03WorkspaceReset,
  readLesson03Runtime,
  readLesson03Submission,
  writeLesson03Runtime,
} from './workspace.mjs';

export const LESSON_03_ID = '03';
export const LESSON_03_WORKSPACE_RESOURCE_ID = 'data:lesson-03-workspace';
export const LESSON_03_CHECK_IDS = Object.freeze(['AA03-C1', 'AA03-C2', 'AA03-C3', 'AA03-C4']);

export const lesson03ExecutionPolicy = runtimeLessonExecutionPolicy;

export const runLesson03 = createRuntimeLessonRunner({
  id: LESSON_03_ID,
  checkIds: LESSON_03_CHECK_IDS,
  workspaceResourceId: LESSON_03_WORKSPACE_RESOURCE_ID,
  initializeWorkspace: initializeLesson03Workspace,
  inspectWorkspace: inspectLesson03Workspace,
  preflightWorkspace: preflightLesson03WorkspaceReset,
  readRuntime: readLesson03Runtime,
  readSubmission: readLesson03Submission,
  writeRuntime: writeLesson03Runtime,
  runScenario: runLesson03Scenario,
  evaluate: evaluateLesson03Submission,
  SubmissionError: Lesson03SubmissionError,
});
