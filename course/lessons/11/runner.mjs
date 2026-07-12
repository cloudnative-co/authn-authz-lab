import { evaluateLesson11Submission, Lesson11SubmissionError } from './assessment.mjs';
import { createLabConfig } from '../../../apps/oauth-lab/config.mjs';
import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { runLesson11Scenario } from './scenario.mjs';
import {
  ensureOAuthLab,
  OAUTH_LAB_PORT_IDS,
  OAUTH_LAB_RESOURCE_ID,
  oauthLabOrigins,
  restartOAuthLab,
  stopOAuthLab,
  createOAuthLabScenarioControl,
  createOAuthLabRuntimeHooks,
} from '../10/managed-lab.mjs';
import {
  initializeLesson11Workspace,
  inspectLesson11Workspace,
  preflightLesson11WorkspaceReset,
  readLesson11Runtime,
  readLesson11Submission,
  writeLesson11Runtime,
} from './workspace.mjs';

export const LESSON_11_ID = '11';
export const LESSON_11_WORKSPACE_RESOURCE_ID = 'data:lesson-11-workspace';
export const LESSON_11_CHECK_IDS = Object.freeze(['AA11-C1', 'AA11-C2']);
export const lesson11ExecutionPolicy = runtimeLessonExecutionPolicy;

const runtimeHooks = createOAuthLabRuntimeHooks(LESSON_11_ID);

async function runManagedLesson11Scenario(options = {}) {
  return runLesson11Scenario({
    config: createLabConfig(),
    scenarioControl: createOAuthLabScenarioControl(options),
    signal: options.signal,
  });
}

export const lesson11Adapter = Object.freeze({
  id: LESSON_11_ID,
  checkIds: LESSON_11_CHECK_IDS,
  workspaceResourceId: LESSON_11_WORKSPACE_RESOURCE_ID,
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
  initializeWorkspace: initializeLesson11Workspace,
  inspectWorkspace: inspectLesson11Workspace,
  preflightWorkspace: preflightLesson11WorkspaceReset,
  readRuntime: readLesson11Runtime,
  readSubmission: readLesson11Submission,
  writeRuntime: writeLesson11Runtime,
  runScenario: runManagedLesson11Scenario,
  evaluate: evaluateLesson11Submission,
  SubmissionError: Lesson11SubmissionError,
  ...runtimeHooks,
});

export const runLesson11 = createRuntimeLessonRunner(lesson11Adapter);
