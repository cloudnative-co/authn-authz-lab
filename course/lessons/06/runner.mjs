import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { detectSupportEnvironment } from '../../runner/support.mjs';
import {
  ensureLesson06Container,
  inspectLesson06Docker,
  LESSON_06_CONTAINER_RESOURCE_ID,
  ManagedComposeError,
  stopLesson06Container,
} from './container.mjs';
import { evaluateLesson06Submission, Lesson06SubmissionError } from './assessment.mjs';
import { runLesson06Scenario } from './scenario.mjs';
import {
  initializeLesson06Workspace,
  inspectLesson06Workspace,
  preflightLesson06WorkspaceReset,
  readLesson06Runtime,
  readLesson06Submission,
  writeLesson06Runtime,
} from './workspace.mjs';

export const LESSON_06_ID = '06';
export const LESSON_06_WORKSPACE_RESOURCE_ID = 'data:lesson-06-workspace';
export const LESSON_06_CHECK_IDS = Object.freeze(['AA06-C1', 'AA06-C2']);

export function lesson06ExecutionPolicy(action) {
  return Object.freeze({
    ...runtimeLessonExecutionPolicy(action),
    defaultTimeoutMs: ['setup', 'reset'].includes(action) ? 15 * 60_000 : 30_000,
  });
}

function recovery(reasonCode) {
  const commands = {
    PREREQUISITE_DOCKER_CLI: 'Docker Desktopを導入し、docker --versionを確認してください',
    PREREQUISITE_DOCKER_DAEMON: 'Docker DesktopまたはDocker daemonを起動してください',
    PREREQUISITE_DOCKER_COMPOSE: 'docker composeが利用できるDocker環境へ更新してください',
    PREREQUISITE_LDAP_PORT_IN_USE: 'port 1389を使用中のprocessまたはcontainerを停止してください',
    PREREQUISITE_CONTAINER_PORT_IN_USE: 'port 1389を使用中のprocessまたはcontainerを停止してください',
    CONTAINER_CONFIG_DRIFT: '同じ教材revisionへ戻してからLesson 06 diagnoseを再実行してください',
  };
  return [commands[reasonCode] ?? 'node course.mjs lesson 06 diagnoseを実行してください'];
}

function blocked(error, diagnosticId = 'lesson06.container') {
  const reasonCode = error?.reasonCode ?? 'CONTAINER_OPERATION_BLOCKED';
  return {
    blocked: {
      status: 'blocked',
      checkIds: [],
      diagnostics: [{
        id: diagnosticId,
        status: 'fail',
        actual: reasonCode,
        expected: 'owned-and-healthy',
        message: 'Lesson 06のDocker resourceを安全に制御できませんでした',
      }],
      reasonCode,
      recovery: recovery(reasonCode),
      journal: null,
      evidence: null,
    },
  };
}

async function inspectExternal({ foundation, stateRoot, signal, requireRunning = false } = {}) {
  try {
    const result = await inspectLesson06Docker({ foundation, stateRoot, signal });
    const status = result.container?.status ?? 'absent';
    const healthy = result.container?.healthy ?? false;
    const ready = result.supported
      && (requireRunning ? status === 'running' && healthy : (
        status === 'absent' || status === 'stopped' || (status === 'running' && healthy)
      ));
    const reasonCode = ready
      ? null
      : (result.reasonCode ?? (status === 'running' ? 'CONTAINER_UNHEALTHY' : 'PREREQUISITE_LESSON_SETUP'));
    return {
      ready,
      reasonCode,
      resourceStatus: status,
      recovery: ready ? [] : recovery(reasonCode),
      diagnostics: [
        ...result.diagnostics,
        {
          id: 'lesson06.container',
          status: ready ? 'pass' : 'fail',
          actual: status === 'running' ? `${status}/${healthy ? 'healthy' : 'unhealthy'}` : status,
          expected: requireRunning ? 'running/healthy' : 'absent-or-stopped-or-running/healthy',
          message: ready ? 'Lesson 06のLDAP containerを安全に利用できます' : 'LDAP containerを利用できません',
        },
      ],
    };
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    const result = blocked(error).blocked;
    return {
      ready: false,
      reasonCode: result.reasonCode,
      resourceStatus: 'unknown',
      recovery: result.recovery,
      diagnostics: result.diagnostics,
    };
  }
}

async function ensureExternal({ foundation, stateRoot, signal } = {}) {
  try {
    const result = await ensureLesson06Container({ foundation, stateRoot, signal });
    return {
      changed: result.started || result.secretsCreated,
      diagnostics: [{
        id: 'lesson06.container',
        status: 'pass',
        actual: result.adopted ? 'adopted-running/healthy' : 'running/healthy',
        expected: 'running/healthy',
        message: result.adopted
          ? '中断後の所有containerを検証して採用しました'
          : '実OpenLDAP containerを起動または再利用しました',
      }],
    };
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

async function resetExternal(options = {}) {
  try {
    await stopLesson06Container({ ...options, remove: true });
    return ensureExternal(options);
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

async function stopExternal(options = {}) {
  try {
    const outcome = await stopLesson06Container({ ...options, remove: false });
    const absent = outcome.reasonCode === 'CONTAINER_NOT_RECORDED'
      || outcome.reasonCode === 'CONTAINER_NOT_FOUND';
    return {
      status: absent ? 'absent' : 'stopped',
      diagnostics: [{
        id: 'lesson06.container',
        status: 'pass',
        actual: absent ? 'absent' : 'stopped',
        expected: 'absent|stopped',
        message: '所有labelと記録を照合してLDAP containerを停止しました',
      }],
    };
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

export async function lesson06SupportEnvironment(environment) {
  const detected = environment ?? await detectSupportEnvironment();
  return {
    ...detected,
    containerEngine: detected.os === 'wsl2-linux-filesystem'
      ? 'docker-desktop-wsl-integration'
      : (detected.os === 'linux' ? 'docker-engine' : 'docker-desktop'),
  };
}

export const runLesson06 = createRuntimeLessonRunner({
  id: LESSON_06_ID,
  checkIds: LESSON_06_CHECK_IDS,
  workspaceResourceId: LESSON_06_WORKSPACE_RESOURCE_ID,
  externalResourceIds: Object.freeze([LESSON_06_CONTAINER_RESOURCE_ID]),
  initializeWorkspace: initializeLesson06Workspace,
  inspectWorkspace: inspectLesson06Workspace,
  preflightWorkspace: preflightLesson06WorkspaceReset,
  readRuntime: readLesson06Runtime,
  readSubmission: readLesson06Submission,
  writeRuntime: writeLesson06Runtime,
  runScenario: runLesson06Scenario,
  evaluate: evaluateLesson06Submission,
  SubmissionError: Lesson06SubmissionError,
  inspectExternal,
  ensureExternal,
  resetExternal,
  stopExternal,
  supportEnvironment: lesson06SupportEnvironment,
});
