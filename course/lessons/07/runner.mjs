import { createRuntimeLessonRunner, runtimeLessonExecutionPolicy } from '../../runner/runtime-lesson.mjs';
import { execManagedComposeService } from '../../runner/managed-compose.mjs';
import { detectSupportEnvironment } from '../../runner/support.mjs';
import {
  ensureLesson07Container,
  inspectLesson07Docker,
  ManagedComposeError,
  readLesson07AlicePassword,
  stopLesson07Container,
} from './container.mjs';
import { evaluateLesson07Submission, Lesson07SubmissionError } from './assessment.mjs';
import { createLesson07ProtocolAdapter } from './protocol-adapter.mjs';
import { LESSON_07_RESOURCE_ID } from './lab-contract.mjs';
import { runLesson07Scenario } from './scenario.mjs';
import {
  initializeLesson07Workspace,
  inspectLesson07Workspace,
  preflightLesson07WorkspaceReset,
  readLesson07Runtime,
  readLesson07Submission,
  writeLesson07Runtime,
} from './workspace.mjs';

export const LESSON_07_ID = '07';
export const LESSON_07_WORKSPACE_RESOURCE_ID = 'data:lesson-07-workspace';
export const LESSON_07_CHECK_IDS = Object.freeze(['AA07-C1', 'AA07-C2']);

export function lesson07ExecutionPolicy(action) {
  return Object.freeze({
    ...runtimeLessonExecutionPolicy(action),
    defaultTimeoutMs: ['setup', 'reset'].includes(action) ? 15 * 60_000 : 60_000,
  });
}

function recovery(reasonCode) {
  const commands = {
    PREREQUISITE_DOCKER_CLI: 'Docker Desktopを導入し、docker --versionを確認してください',
    PREREQUISITE_DOCKER_DAEMON: 'Docker DesktopまたはDocker daemonを起動してください',
    PREREQUISITE_DOCKER_COMPOSE: 'docker composeが利用できるDocker環境へ更新してください',
    CONTAINER_CONFIG_DRIFT: '同じ教材revisionへ戻してからLesson 07 diagnoseを再実行してください',
  };
  return [commands[reasonCode] ?? 'node course.mjs lesson 07 diagnoseを実行してください'];
}

function blocked(error, diagnosticId = 'lesson07.kerberos-lab') {
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
        message: 'Lesson 07のDocker resourceを安全に制御できませんでした',
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
    const result = await inspectLesson07Docker({
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
          id: 'lesson07.kerberos-lab',
          status: ready ? 'pass' : 'fail',
          actual: status === 'running' ? `${status}/${healthy ? 'healthy' : 'unhealthy'}` : status,
          expected: requireRunning ? 'running/healthy' : 'absent-or-stopped-or-running/healthy',
          message: ready
            ? 'Lesson 07の隔離Kerberos labを安全に利用できます'
            : 'Kerberos labを利用できません',
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
    const result = await ensureLesson07Container({
      repoRoot: foundation.repositoryRealpath, stateRoot, signal,
    });
    return {
      changed: result.started || result.secretsCreated,
      diagnostics: [{
        id: 'lesson07.kerberos-lab',
        status: 'pass',
        actual: result.adopted ? 'adopted-running/healthy' : 'running/healthy',
        expected: 'running/healthy',
        message: result.adopted
          ? '中断後の所有Kerberos labを検証して採用しました'
          : '実MIT Kerberos labを起動または再利用しました',
      }],
    };
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

async function resetExternal(options = {}) {
  try {
    await stopLesson07Container({ ...options, repoRoot: options.foundation.repositoryRealpath, remove: true });
    return ensureExternal(options);
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

async function stopExternal(options = {}) {
  try {
    const outcome = await stopLesson07Container({
      ...options, repoRoot: options.foundation.repositoryRealpath, remove: false,
    });
    const absent = outcome.reasonCode === 'CONTAINER_NOT_RECORDED'
      || outcome.reasonCode === 'CONTAINER_NOT_FOUND';
    return {
      status: absent ? 'absent' : 'stopped',
      reasonCode: absent ? outcome.reasonCode : null,
      diagnostics: [{
        id: 'lesson07.kerberos-lab',
        status: 'pass',
        actual: absent ? 'absent' : 'stopped',
        expected: 'absent|stopped',
        message: '所有labelと記録を照合してKerberos labを停止しました',
      }],
    };
  } catch (error) {
    if (!(error instanceof ManagedComposeError)) throw error;
    return blocked(error);
  }
}

async function runScenario({ foundation, stateRoot, signal } = {}) {
  const repoRoot = foundation.repositoryRealpath;
  const password = await readLesson07AlicePassword({ stateRoot, repoRoot });
  const adapter = createLesson07ProtocolAdapter({
    executeOwnedService: (command) => execManagedComposeService({
      ...command,
      stateRoot,
      repoRoot,
      signal: command.signal ?? signal,
    }),
  });
  return runLesson07Scenario({ adapter, password, signal });
}

export async function lesson07SupportEnvironment(environment) {
  const detected = environment ?? await detectSupportEnvironment();
  return {
    ...detected,
    containerEngine: detected.os === 'wsl2-linux-filesystem'
      ? 'docker-desktop-wsl-integration'
      : (detected.os === 'linux' ? 'docker-engine' : 'docker-desktop'),
  };
}

export const runLesson07 = createRuntimeLessonRunner({
  id: LESSON_07_ID,
  checkIds: LESSON_07_CHECK_IDS,
  workspaceResourceId: LESSON_07_WORKSPACE_RESOURCE_ID,
  externalResourceIds: Object.freeze([LESSON_07_RESOURCE_ID]),
  requiresProjectApp: false,
  initializeWorkspace: initializeLesson07Workspace,
  inspectWorkspace: inspectLesson07Workspace,
  preflightWorkspace: preflightLesson07WorkspaceReset,
  readRuntime: readLesson07Runtime,
  readSubmission: readLesson07Submission,
  writeRuntime: writeLesson07Runtime,
  runScenario,
  evaluate: evaluateLesson07Submission,
  SubmissionError: Lesson07SubmissionError,
  inspectExternal,
  ensureExternal,
  resetExternal,
  stopExternal,
  supportEnvironment: lesson07SupportEnvironment,
});
