import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { browserPrerequisiteDiagnostic, inspectPlaywrightChromium } from '../webauthn/browser-lab.mjs';
import { evaluateLesson14Submission, Lesson14SubmissionError } from './assessment.mjs';
import { runLesson14Scenario } from './scenario.mjs';
import {
  initializeLesson14Workspace,
  inspectLesson14Workspace,
  preflightLesson14WorkspaceReset,
  readLesson14Runtime,
  readLesson14Submission,
  writeLesson14Runtime,
} from './workspace.mjs';

export const LESSON_14_ID = '14';
export const LESSON_14_WORKSPACE_RESOURCE_ID = 'data:lesson-14-workspace';
export const LESSON_14_CHECK_IDS = Object.freeze(['AA14-C1', 'AA14-C2']);
export const lesson14ExecutionPolicy = runtimeLessonExecutionPolicy;

const runBaseLesson14 = createRuntimeLessonRunner({
  id: LESSON_14_ID,
  checkIds: LESSON_14_CHECK_IDS,
  workspaceResourceId: LESSON_14_WORKSPACE_RESOURCE_ID,
  initializeWorkspace: initializeLesson14Workspace,
  inspectWorkspace: inspectLesson14Workspace,
  preflightWorkspace: preflightLesson14WorkspaceReset,
  readRuntime: readLesson14Runtime,
  readSubmission: readLesson14Submission,
  writeRuntime: writeLesson14Runtime,
  runScenario: runLesson14Scenario,
  evaluate: evaluateLesson14Submission,
  SubmissionError: Lesson14SubmissionError,
});

function blocked(result, action) {
  return {
    status: 'blocked',
    checkIds: action === 'check' ? LESSON_14_CHECK_IDS : [],
    diagnostics: [browserPrerequisiteDiagnostic(result, LESSON_14_ID)],
    reasonCode: result.reasonCode,
    recovery: result.recovery,
    journal: null,
    evidence: null,
  };
}

export async function runLesson14(options) {
  if (['setup', 'demo', 'check'].includes(options?.action)) {
    const prerequisite = await inspectPlaywrightChromium();
    if (!prerequisite.ready) return blocked(prerequisite, options.action);
  }
  const result = await runBaseLesson14(options);
  if (!['doctor', 'diagnose'].includes(options?.action) || result.status === 'blocked') return result;
  const prerequisite = await inspectPlaywrightChromium();
  return prerequisite.ready
    ? { ...result, diagnostics: [...result.diagnostics, browserPrerequisiteDiagnostic(prerequisite, LESSON_14_ID)] }
    : { ...result, ...blocked(prerequisite, options.action), diagnostics: [
      ...result.diagnostics,
      browserPrerequisiteDiagnostic(prerequisite, LESSON_14_ID),
    ] };
}

