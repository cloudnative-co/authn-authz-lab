import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import {
  CAPSTONE_CHECK_IDS,
  CapstoneSubmissionError,
  evaluateCapstoneSubmission,
} from './assessment.mjs';
import { runCapstoneScenario } from './scenario.mjs';
import {
  initializeCapstoneWorkspace,
  inspectCapstoneWorkspace,
  preflightCapstoneWorkspaceReset,
  readCapstoneRuntime,
  readCapstoneSubmission,
  writeCapstoneRuntime,
} from './workspace.mjs';

export const CAPSTONE_ID = 'capstone';
export const CAPSTONE_WORKSPACE_RESOURCE_ID = 'data:capstone-workspace';
export { CAPSTONE_CHECK_IDS };
export const capstoneExecutionPolicy = runtimeLessonExecutionPolicy;

export const capstoneAdapter = Object.freeze({
  id: CAPSTONE_ID,
  checkIds: CAPSTONE_CHECK_IDS,
  workspaceResourceId: CAPSTONE_WORKSPACE_RESOURCE_ID,
  externalResourceIds: Object.freeze([]),
  requiresProjectApp: false,
  runtimeKind: 'isolated-deterministic-capstone-policy-simulator',
  localRuntime: true,
  initializeWorkspace: initializeCapstoneWorkspace,
  inspectWorkspace: inspectCapstoneWorkspace,
  preflightWorkspace: preflightCapstoneWorkspaceReset,
  readRuntime: readCapstoneRuntime,
  readSubmission: readCapstoneSubmission,
  writeRuntime: writeCapstoneRuntime,
  runScenario: runCapstoneScenario,
  evaluate: evaluateCapstoneSubmission,
  SubmissionError: CapstoneSubmissionError,
});

export const runCapstone = createRuntimeLessonRunner(capstoneAdapter);
