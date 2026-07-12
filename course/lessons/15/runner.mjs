import { createLabConfig } from '../../../apps/oauth-lab/config.mjs';
import { evaluateLesson15Submission, Lesson15SubmissionError } from './assessment.mjs';
import {
  createOAuthLabRuntimeHooks,
  createOAuthLabScenarioControl,
  ensureOAuthLab,
  OAUTH_LAB_PORT_IDS,
  OAUTH_LAB_RESOURCE_ID,
  oauthLabOrigins,
  restartOAuthLab,
  stopOAuthLab,
} from '../10/managed-lab.mjs';
import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { runLesson15Scenario } from './scenario.mjs';
import {
  initializeLesson15Workspace,
  inspectLesson15Workspace,
  preflightLesson15WorkspaceReset,
  readLesson15Runtime,
  readLesson15Submission,
  writeLesson15Runtime,
} from './workspace.mjs';

export const LESSON_15_ID = '15';
export const LESSON_15_WORKSPACE_RESOURCE_ID = 'data:lesson-15-workspace';
export const LESSON_15_CHECK_IDS = Object.freeze(['AA15-C1', 'AA15-C2', 'AA15-C3']);
export const lesson15ExecutionPolicy = runtimeLessonExecutionPolicy;

const runtimeHooks = createOAuthLabRuntimeHooks(LESSON_15_ID);

async function runManagedLesson15Scenario(options = {}) {
  return runLesson15Scenario({
    config: createLabConfig(),
    scenarioControl: createOAuthLabScenarioControl(options),
    signal: options.signal,
  });
}

export const lesson15Adapter = Object.freeze({
  id: LESSON_15_ID,
  checkIds: LESSON_15_CHECK_IDS,
  workspaceResourceId: LESSON_15_WORKSPACE_RESOURCE_ID,
  externalResourceIds: Object.freeze([OAUTH_LAB_RESOURCE_ID]),
  requiresProjectApp: false,
  runtimeKind: 'standalone-three-origin-http-jwt-api-authorization-lab',
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
  initializeWorkspace: initializeLesson15Workspace,
  inspectWorkspace: inspectLesson15Workspace,
  preflightWorkspace: preflightLesson15WorkspaceReset,
  readRuntime: readLesson15Runtime,
  readSubmission: readLesson15Submission,
  writeRuntime: writeLesson15Runtime,
  runScenario: runManagedLesson15Scenario,
  evaluate: evaluateLesson15Submission,
  SubmissionError: Lesson15SubmissionError,
  ...runtimeHooks,
});

export const runLesson15 = createRuntimeLessonRunner(lesson15Adapter);
