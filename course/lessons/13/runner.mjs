import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { browserPrerequisiteDiagnostic, inspectPlaywrightChromium } from '../webauthn/browser-lab.mjs';
import { evaluateLesson13Submission, Lesson13SubmissionError } from './assessment.mjs';
import { runLesson13Scenario } from './scenario.mjs';
import {
  initializeLesson13Workspace,
  inspectLesson13Workspace,
  preflightLesson13WorkspaceReset,
  readLesson13Runtime,
  readLesson13Submission,
  writeLesson13Runtime,
} from './workspace.mjs';

export const LESSON_13_ID = '13';
export const LESSON_13_WORKSPACE_RESOURCE_ID = 'data:lesson-13-workspace';
export const LESSON_13_CHECK_IDS = Object.freeze(['AA13-C1', 'AA13-C2', 'AA13-C3']);
export const lesson13ExecutionPolicy = runtimeLessonExecutionPolicy;

const runBaseLesson13 = createRuntimeLessonRunner({
  id: LESSON_13_ID,
  checkIds: LESSON_13_CHECK_IDS,
  workspaceResourceId: LESSON_13_WORKSPACE_RESOURCE_ID,
  initializeWorkspace: initializeLesson13Workspace,
  inspectWorkspace: inspectLesson13Workspace,
  preflightWorkspace: preflightLesson13WorkspaceReset,
  readRuntime: readLesson13Runtime,
  readSubmission: readLesson13Submission,
  writeRuntime: writeLesson13Runtime,
  runScenario: runLesson13Scenario,
  evaluate: evaluateLesson13Submission,
  SubmissionError: Lesson13SubmissionError,
});

function blocked(result, action) {
  return {
    status: 'blocked',
    checkIds: action === 'check' ? LESSON_13_CHECK_IDS : [],
    diagnostics: [browserPrerequisiteDiagnostic(result, LESSON_13_ID)],
    reasonCode: result.reasonCode,
    recovery: result.recovery,
    journal: null,
    evidence: null,
  };
}

export async function runLesson13(options) {
  if (['setup', 'demo', 'check'].includes(options?.action)) {
    const prerequisite = await inspectPlaywrightChromium();
    if (!prerequisite.ready) return blocked(prerequisite, options.action);
  }
  const result = await runBaseLesson13(options);
  if (!['doctor', 'diagnose'].includes(options?.action) || result.status === 'blocked') return result;
  const prerequisite = await inspectPlaywrightChromium();
  return prerequisite.ready
    ? { ...result, diagnostics: [...result.diagnostics, browserPrerequisiteDiagnostic(prerequisite, LESSON_13_ID)] }
    : { ...result, ...blocked(prerequisite, options.action), diagnostics: [
      ...result.diagnostics,
      browserPrerequisiteDiagnostic(prerequisite, LESSON_13_ID),
    ] };
}

