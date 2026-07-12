import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { evaluateLesson12Submission, Lesson12SubmissionError } from './assessment.mjs';
import { runLesson12Scenario } from './scenario.mjs';
import {
  initializeLesson12Workspace,
  inspectLesson12Workspace,
  preflightLesson12WorkspaceReset,
  readLesson12Runtime,
  readLesson12Submission,
  writeLesson12Runtime,
} from './workspace.mjs';

export const LESSON_12_ID = '12';
export const LESSON_12_WORKSPACE_RESOURCE_ID = 'data:lesson-12-workspace';
export const LESSON_12_CHECK_IDS = Object.freeze(['AA12-C1', 'AA12-C2', 'AA12-C3']);

export const lesson12ExecutionPolicy = runtimeLessonExecutionPolicy;

export const runLesson12 = createRuntimeLessonRunner({
  id: LESSON_12_ID,
  checkIds: LESSON_12_CHECK_IDS,
  workspaceResourceId: LESSON_12_WORKSPACE_RESOURCE_ID,
  initializeWorkspace: initializeLesson12Workspace,
  inspectWorkspace: inspectLesson12Workspace,
  preflightWorkspace: preflightLesson12WorkspaceReset,
  readRuntime: readLesson12Runtime,
  readSubmission: readLesson12Submission,
  writeRuntime: writeLesson12Runtime,
  runScenario: runLesson12Scenario,
  evaluate: evaluateLesson12Submission,
  SubmissionError: Lesson12SubmissionError,
});
