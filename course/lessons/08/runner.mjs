import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { execManagedComposeService } from '../../runner/managed-compose.mjs';
import { detectSupportEnvironment } from '../../runner/support.mjs';
import {
  ensureLesson08Container,
  inspectLesson08Docker,
  ManagedComposeError,
  readLesson08AlicePassword,
  stopLesson08Container,
} from './container.mjs';
import { evaluateLesson08Submission, Lesson08SubmissionError } from './assessment.mjs';
import { LESSON_08_RESOURCE_ID } from './lab-contract.mjs';
import { createLesson08ProtocolAdapter } from './protocol-adapter.mjs';
import { runLesson08Scenario } from './scenario.mjs';
import {
  initializeLesson08Workspace,
  inspectLesson08Workspace,
  preflightLesson08WorkspaceReset,
  readLesson08Runtime,
  readLesson08Submission,
  writeLesson08Runtime,
} from './workspace.mjs';

export const LESSON_08_ID = '08';
export const LESSON_08_WORKSPACE_RESOURCE_ID = 'data:lesson-08-workspace';
export const LESSON_08_CHECK_IDS = Object.freeze(['AA08-C1', 'AA08-C2']);

export function lesson08ExecutionPolicy(action) {
  return Object.freeze({
    ...runtimeLessonExecutionPolicy(action),
    defaultTimeoutMs: ['setup', 'reset'].includes(action) ? 15 * 60_000 : 90_000,
  });
}

function recovery(reasonCode) {
  const commands = {
    CONTAINER_HOST_IDENTITY_UNSUPPORTED: 'rootではない通常のOSユーザーで実行してください。秘密ファイルの権限は変更しません',
    PREREQUISITE_DOCKER_CLI: 'Docker Desktopを導入し、docker --versionを確認してください',
    PREREQUISITE_DOCKER_DAEMON: 'Docker DesktopまたはDocker daemonを起動してください',
    PREREQUISITE_DOCKER_COMPOSE: 'docker composeが利用できるDocker環境へ更新してください',
    CONTAINER_CONFIG_DRIFT: '同じ教材revisionへ戻してからLesson 08 diagnoseを再実行してください',
  };
  return [commands[reasonCode] ?? 'node course.mjs lesson 08 diagnoseを実行してください'];
}

function blocked(error, diagnosticId = 'lesson08.identity-platform-lab') {
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
        message: 'Lesson 08のDocker resourceを安全に制御できませんでした',
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
    const result = await inspectLesson08Docker({
      repoRoot: foundation.repositoryRealpath,
      stateRoot,
      signal,
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
          id: 'lesson08.identity-platform-lab',
          status: ready ? 'pass' : 'fail',
          actual: status === 'running' ? `${status}/${healthy ? 'healthy' : 'unhealthy'}` : status,
          expected: requireRunning ? 'running/healthy' : 'absent-or-stopped-or-running/healthy',
          message: ready
            ? 'Lesson 08の隔離identity platform labを安全に利用できます'
            : 'identity platform labを利用できません',
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
    const result = await ensureLesson08Container({
      repoRoot: foundation.repositoryRealpath,
      stateRoot,
      signal,
    });
    return {
      changed: result.started || result.secretsCreated,
      diagnostics: [{
        id: 'lesson08.identity-platform-lab',
        status: 'pass',
        actual: result.adopted ? 'adopted-running/healthy' : 'running/healthy',
        expected: 'running/healthy',
        message: result.adopted
          ? '中断後の所有identity platform labを検証して採用しました'
          : '実Samba AD互換DC、LDAPS app、Kerberos clientを起動しました',
      }],
    };
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

async function resetExternal(options = {}) {
  try {
    await stopLesson08Container({
      ...options,
      repoRoot: options.foundation.repositoryRealpath,
      remove: true,
    });
    return ensureExternal(options);
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

async function stopExternal(options = {}) {
  try {
    const outcome = await stopLesson08Container({
      ...options,
      repoRoot: options.foundation.repositoryRealpath,
      remove: false,
    });
    const absent = outcome.reasonCode === 'CONTAINER_NOT_RECORDED'
      || outcome.reasonCode === 'CONTAINER_NOT_FOUND';
    return {
      status: absent ? 'absent' : 'stopped',
      reasonCode: absent ? outcome.reasonCode : null,
      diagnostics: [{
        id: 'lesson08.identity-platform-lab',
        status: 'pass',
        actual: absent ? 'absent' : 'stopped',
        expected: 'absent|stopped',
        message: '所有labelと記録を照合してidentity platform labを停止しました',
      }],
    };
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

async function runScenario({ foundation, stateRoot, signal } = {}) {
  const repoRoot = foundation.repositoryRealpath;
  const password = await readLesson08AlicePassword({ stateRoot, repoRoot });
  const adapter = createLesson08ProtocolAdapter({
    executeOwnedService: (command) => execManagedComposeService({
      ...command,
      stateRoot,
      repoRoot,
      signal: command.signal ?? signal,
    }),
  });
  return runLesson08Scenario({ adapter, password, signal });
}

export async function lesson08SupportEnvironment(environment) {
  const detected = environment ?? await detectSupportEnvironment();
  return {
    ...detected,
    containerEngine: detected.os === 'wsl2-linux-filesystem'
      ? 'docker-desktop-wsl-integration'
      : (detected.os === 'linux' ? 'docker-engine' : 'docker-desktop'),
  };
}

export const runLesson08 = createRuntimeLessonRunner({
  id: LESSON_08_ID,
  checkIds: LESSON_08_CHECK_IDS,
  workspaceResourceId: LESSON_08_WORKSPACE_RESOURCE_ID,
  externalResourceIds: Object.freeze([LESSON_08_RESOURCE_ID]),
  requiresProjectApp: false,
  initializeWorkspace: initializeLesson08Workspace,
  inspectWorkspace: inspectLesson08Workspace,
  preflightWorkspace: preflightLesson08WorkspaceReset,
  readRuntime: readLesson08Runtime,
  readSubmission: readLesson08Submission,
  writeRuntime: writeLesson08Runtime,
  runScenario,
  evaluate: evaluateLesson08Submission,
  SubmissionError: Lesson08SubmissionError,
  inspectExternal,
  ensureExternal,
  resetExternal,
  stopExternal,
  supportEnvironment: lesson08SupportEnvironment,
});
