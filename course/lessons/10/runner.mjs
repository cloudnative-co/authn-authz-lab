import { evaluateLesson10Submission, Lesson10SubmissionError } from './assessment.mjs';
import { createLabConfig } from '../../../apps/oauth-lab/config.mjs';
import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { runLesson10Scenario } from './scenario.mjs';
import {
  ensureOAuthLab,
  OAUTH_LAB_PORT_IDS,
  OAUTH_LAB_RESOURCE_ID,
  oauthLabOrigins,
  restartOAuthLab,
  stopOAuthLab,
  createOAuthLabScenarioControl,
  createOAuthLabRuntimeHooks,
} from './managed-lab.mjs';
import {
  initializeLesson10Workspace,
  inspectLesson10Workspace,
  preflightLesson10WorkspaceReset,
  readLesson10Runtime,
  readLesson10Submission,
  writeLesson10Runtime,
} from './workspace.mjs';

export const LESSON_10_ID = '10';
export const LESSON_10_WORKSPACE_RESOURCE_ID = 'data:lesson-10-workspace';
export const LESSON_10_CHECK_IDS = Object.freeze(['AA10-C1', 'AA10-C2']);
export const lesson10ExecutionPolicy = runtimeLessonExecutionPolicy;

const runtimeHooks = createOAuthLabRuntimeHooks(LESSON_10_ID);

async function runManagedLesson10Scenario(options = {}) {
  return runLesson10Scenario({
    config: createLabConfig(),
    scenarioControl: createOAuthLabScenarioControl(options),
    signal: options.signal,
  });
}

export const lesson10Adapter = Object.freeze({
  id: LESSON_10_ID,
  checkIds: LESSON_10_CHECK_IDS,
  workspaceResourceId: LESSON_10_WORKSPACE_RESOURCE_ID,
  externalResourceIds: Object.freeze([OAUTH_LAB_RESOURCE_ID]),
  requiresProjectApp: false,
  runtimeKind: 'standalone-three-origin-http-lab',
  managedResource: Object.freeze({
    resourceId: OAUTH_LAB_RESOURCE_ID,
    portIds: OAUTH_LAB_PORT_IDS,
    ensure: ensureOAuthLab,
    stop: stopOAuthLab,
    restart: restartOAuthLab,
    origins: oauthLabOrigins,
    scenarioControlRequired: true,
  }),
  fixedOrigins: Object.freeze([
    'http://127.0.0.1:4100',
    'http://127.0.0.1:4101',
    'http://127.0.0.1:4102',
  ]),
  lifecycleContract: Object.freeze({
    start: 'managed-process-transactional-bind-three-owned-loopback-listeners',
    stop: 'idempotent-close-owned-listeners',
    reset: 'stop-then-reinitialize-lesson-workspace',
    purge: 'stop-then-remove-lesson-owned-workspace-resources',
  }),
  initializeWorkspace: initializeLesson10Workspace,
  inspectWorkspace: inspectLesson10Workspace,
  preflightWorkspace: preflightLesson10WorkspaceReset,
  readRuntime: readLesson10Runtime,
  readSubmission: readLesson10Submission,
  writeRuntime: writeLesson10Runtime,
  runScenario: runManagedLesson10Scenario,
  evaluate: evaluateLesson10Submission,
  SubmissionError: Lesson10SubmissionError,
  ...runtimeHooks,
});

export const runLesson10 = createRuntimeLessonRunner(lesson10Adapter);
