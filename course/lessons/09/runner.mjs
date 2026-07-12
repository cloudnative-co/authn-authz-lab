import { execManagedComposeService } from '../../runner/managed-compose.mjs';
import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { detectSupportEnvironment } from '../../runner/support.mjs';
import {
  ensureLesson09Container,
  inspectLesson09Docker,
  ManagedComposeError,
  stopLesson09Container,
} from './container.mjs';
import { evaluateLesson09Submission, Lesson09SubmissionError } from './assessment.mjs';
import { LESSON_09_RESOURCE_ID } from './lab-contract.mjs';
import { createLesson09ProtocolAdapter } from './protocol-adapter.mjs';
import { runLesson09Scenario } from './scenario.mjs';
import {
  initializeLesson09Workspace,
  inspectLesson09Workspace,
  preflightLesson09WorkspaceReset,
  readLesson09Runtime,
  readLesson09Submission,
  writeLesson09Runtime,
} from './workspace.mjs';

export const LESSON_09_ID = '09';
export const LESSON_09_WORKSPACE_RESOURCE_ID = 'data:lesson-09-workspace';
export const LESSON_09_CHECK_IDS = Object.freeze(['AA09-C1', 'AA09-C2']);

export function lesson09ExecutionPolicy(action) {
  return Object.freeze({
    ...runtimeLessonExecutionPolicy(action),
    defaultTimeoutMs: ['setup', 'reset'].includes(action) ? 15 * 60_000 : 120_000,
  });
}

function recovery(reasonCode) {
  const commands = {
    PREREQUISITE_DOCKER_CLI: 'Docker Desktopを導入し、docker --versionを確認してください',
    PREREQUISITE_DOCKER_DAEMON: 'Docker DesktopまたはDocker daemonを起動してください',
    PREREQUISITE_DOCKER_COMPOSE: 'docker composeが利用できるDocker環境へ更新してください',
    CONTAINER_CONFIG_DRIFT: '同じ教材revisionへ戻してからLesson 09 diagnoseを再実行してください',
    CONTAINER_SPEC_DRIFT: '同じ教材revisionへ戻すか、回答を退避してLesson 09をpurgeしてください',
  };
  return [commands[reasonCode] ?? 'node course.mjs lesson 09 diagnoseを実行してください'];
}

function blocked(error, diagnosticId = 'lesson09.saml-lab') {
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
        message: 'Lesson 09のDocker resourceを安全に制御できませんでした',
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
    const result = await inspectLesson09Docker({
      repoRoot: foundation.repositoryRealpath, stateRoot, signal,
    });
    const status = result.container?.status ?? 'absent';
    const healthy = result.container?.healthy ?? false;
    const ready = result.supported
      && (requireRunning ? status === 'running' && healthy : (
        status === 'absent' || status === 'stopped' || (status === 'running' && healthy)
      ));
    const reasonCode = ready
      ? null
      : (result.reasonCode ?? (status === 'running'
        ? 'CONTAINER_UNHEALTHY'
        : 'PREREQUISITE_LESSON_SETUP'));
    return {
      ready,
      reasonCode,
      resourceStatus: status,
      recovery: ready ? [] : recovery(reasonCode),
      diagnostics: [
        ...result.diagnostics,
        {
          id: 'lesson09.saml-lab',
          status: ready ? 'pass' : 'fail',
          actual: status === 'running' ? `${status}/${healthy ? 'healthy' : 'unhealthy'}` : status,
          expected: requireRunning ? 'running/healthy' : 'absent-or-stopped-or-running/healthy',
          message: ready
            ? 'Lesson 09の隔離SAML labを安全に利用できます'
            : 'SAML labを利用できません',
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
    const result = await ensureLesson09Container({
      repoRoot: foundation.repositoryRealpath, stateRoot, signal,
    });
    return {
      changed: result.started || result.secretsCreated,
      diagnostics: [{
        id: 'lesson09.saml-lab',
        status: 'pass',
        actual: result.adopted ? 'adopted-running/healthy' : 'running/healthy',
        expected: 'running/healthy',
        message: result.adopted
          ? '中断後の所有SAML labを検証して採用しました'
          : '実Keycloak SAML labを起動または再利用しました',
      }],
    };
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

async function resetExternal(options = {}) {
  try {
    await stopLesson09Container({ ...options, repoRoot: options.foundation.repositoryRealpath, remove: true });
    return ensureExternal(options);
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

async function stopExternal(options = {}) {
  try {
    const outcome = await stopLesson09Container({
      ...options, repoRoot: options.foundation.repositoryRealpath, remove: false,
    });
    const absent = outcome.reasonCode === 'CONTAINER_NOT_RECORDED'
      || outcome.reasonCode === 'CONTAINER_NOT_FOUND';
    return {
      status: absent ? 'absent' : 'stopped',
      reasonCode: absent ? outcome.reasonCode : null,
      diagnostics: [{
        id: 'lesson09.saml-lab',
        status: 'pass',
        actual: absent ? 'absent' : 'stopped',
        expected: 'absent|stopped',
        message: '所有labelと記録を照合してSAML labを停止しました',
      }],
    };
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

async function runScenario({ foundation, stateRoot, signal } = {}) {
  const repoRoot = foundation.repositoryRealpath;
  const adapter = createLesson09ProtocolAdapter({
    executeOwnedService: (command) => execManagedComposeService({
      ...command,
      stateRoot,
      repoRoot,
      signal: command.signal ?? signal,
    }),
  });
  return runLesson09Scenario({ adapter, signal });
}

async function supportEnvironment(environment) {
  const detected = environment ?? await detectSupportEnvironment();
  return {
    ...detected,
    containerEngine: detected.os === 'wsl2-linux-filesystem'
      ? 'docker-desktop-wsl-integration'
      : 'docker-desktop',
  };
}

export const runLesson09 = createRuntimeLessonRunner({
  id: LESSON_09_ID,
  checkIds: LESSON_09_CHECK_IDS,
  workspaceResourceId: LESSON_09_WORKSPACE_RESOURCE_ID,
  externalResourceIds: Object.freeze([LESSON_09_RESOURCE_ID]),
  requiresProjectApp: false,
  initializeWorkspace: initializeLesson09Workspace,
  inspectWorkspace: inspectLesson09Workspace,
  preflightWorkspace: preflightLesson09WorkspaceReset,
  readRuntime: readLesson09Runtime,
  readSubmission: readLesson09Submission,
  writeRuntime: writeLesson09Runtime,
  runScenario,
  evaluate: evaluateLesson09Submission,
  SubmissionError: Lesson09SubmissionError,
  inspectExternal,
  ensureExternal,
  resetExternal,
  stopExternal,
  supportEnvironment,
});
