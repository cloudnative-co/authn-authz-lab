import { relative } from 'node:path';
import { bindImplementedAssessmentChecks } from './assessment-contract.mjs';
import { runCourseLifecycle } from './lifecycle.mjs';
import { LessonWorkspaceError } from './lesson-workspace.mjs';
import {
  ensureProjectApp,
  inspectProjectAppReadiness,
  loadProjectAppLessonState,
  PROJECT_APP_RESOURCE_ID,
  PROJECT_APP_PORT_ID,
  projectAppJournal,
  projectAppNeedsRecovery,
  projectAppOrigin,
  projectAppStateRoot,
  restartProjectApp,
  stopProjectApp,
  updateProjectAppLessonState,
} from './project-app-runtime.mjs';
import { inspectSupport } from './support.mjs';

function resultDraft({
  status,
  checkIds = [],
  diagnostics = [],
  reasonCode = null,
  recovery = [],
  journal = null,
  evidence = null,
}) {
  return { status, checkIds, diagnostics, reasonCode, recovery, journal, evidence };
}

function diagnostic(id, status, actual, expected, message) {
  return { id, status, actual, expected, message };
}

function lessonResources(adapter, foundation) {
  return [
    ...(adapter.requiresProjectApp ? [PROJECT_APP_RESOURCE_ID] : []),
    adapter.workspaceResourceId,
    ...(adapter.externalResourceIds ?? []),
  ]
    .filter((id) => foundation.indexes.resources.has(id));
}

function journal(adapter, foundation, stateRoot, lockMode, resourceIds = lessonResources(adapter, foundation)) {
  return projectAppJournal({ foundation, stateRoot, lockMode, resourceIds });
}

function blockedProcess(adapter, process, action) {
  return resultDraft({
    status: 'blocked',
    diagnostics: [diagnostic(
      `lesson${adapter.id}.process`,
      'fail',
      process.reasonCode ?? process.status ?? 'blocked',
      action === 'stop' ? 'stopped' : 'running',
      'project-appの所有権または実行状態を安全に確認できませんでした',
    )],
    reasonCode: process.reasonCode ?? 'PROCESS_OPERATION_BLOCKED',
    recovery: [`node course.mjs lesson ${adapter.id} diagnoseを実行してください`],
  });
}

async function requireRunning(adapter, options) {
  const readiness = adapter.requiresProjectApp
    ? await inspectProjectAppReadiness(options)
    : null;
  const projectReady = !adapter.requiresProjectApp
    || (readiness.process.status === 'running' && readiness.ready);
  if (projectReady) {
    if (!adapter.inspectExternal) return { readiness };
    const external = await adapter.inspectExternal({ ...options, requireRunning: true });
    if (external.ready) return { readiness, external };
    return {
      blocked: resultDraft({
        status: 'blocked',
        diagnostics: external.diagnostics,
        reasonCode: external.reasonCode ?? 'PREREQUISITE_LESSON_SETUP',
        recovery: external.recovery ?? [`node course.mjs lesson ${adapter.id} setupを実行してください`],
      }),
    };
  }
  return {
    blocked: resultDraft({
      status: 'blocked',
      diagnostics: [diagnostic(
        `lesson${adapter.id}.process`,
        'fail',
        `${readiness.process.status}/${readiness.reasonCode ?? readiness.portStatus}`,
        'running/owned-running',
        '先にこのlessonをsetupしてください',
      )],
      reasonCode: readiness.reasonCode ?? 'PREREQUISITE_LESSON_SETUP',
      recovery: [`node course.mjs lesson ${adapter.id} setupを実行してください`],
    }),
  };
}

export function runtimeLessonExecutionPolicy(action) {
  if (action === 'purge') return { requiresState: false, lockMode: null, transactionCommand: null };
  if (['doctor', 'observe', 'diagnose'].includes(action)) {
    return { requiresState: true, lockMode: 'read', transactionCommand: null };
  }
  if (['setup', 'reset', 'stop'].includes(action)) {
    return { requiresState: true, lockMode: 'write', transactionCommand: action };
  }
  if (action === 'check') {
    return { requiresState: true, lockMode: 'write', transactionCommand: 'check' };
  }
  if (action === 'demo') return { requiresState: true, lockMode: 'write', transactionCommand: null };
  throw new TypeError(`unsupported runtime lesson action: ${action}`);
}

function validateAdapter(adapter) {
  if (!adapter || !['02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', 'capstone'].includes(adapter.id)) {
    throw new TypeError('runtime lesson adapter id is invalid');
  }
  if (!Array.isArray(adapter.checkIds) || adapter.checkIds.length === 0) {
    throw new TypeError('runtime lesson adapter checkIds are required');
  }
  for (const method of [
    'initializeWorkspace', 'inspectWorkspace', 'preflightWorkspace', 'readRuntime', 'readSubmission',
    'writeRuntime', 'runScenario', 'evaluate',
  ]) {
    if (typeof adapter[method] !== 'function') throw new TypeError(`adapter.${method} is required`);
  }
  if (typeof adapter.workspaceResourceId !== 'string') throw new TypeError('workspaceResourceId is required');
  if (typeof adapter.SubmissionError !== 'function') throw new TypeError('SubmissionError is required');
  const externalMethods = ['inspectExternal', 'ensureExternal', 'resetExternal', 'stopExternal'];
  const configuredExternalMethods = externalMethods.filter((method) => adapter[method] !== undefined);
  if (configuredExternalMethods.length > 0) {
    if (configuredExternalMethods.length !== externalMethods.length
        || externalMethods.some((method) => typeof adapter[method] !== 'function')
        || !Array.isArray(adapter.externalResourceIds)
        || adapter.externalResourceIds.length === 0) {
      throw new TypeError('external runtime adapter hooks are incomplete');
    }
  }
  const requiresProjectApp = adapter.requiresProjectApp ?? true;
  if (typeof requiresProjectApp !== 'boolean') throw new TypeError('requiresProjectApp must be boolean');
  const localRuntime = adapter.localRuntime ?? false;
  if (typeof localRuntime !== 'boolean') throw new TypeError('localRuntime must be boolean');
  if (!requiresProjectApp && configuredExternalMethods.length === 0 && !localRuntime) {
    throw new TypeError('an external runtime is required when project-app is disabled');
  }
  if (localRuntime && (requiresProjectApp || configuredExternalMethods.length > 0)) {
    throw new TypeError('localRuntime cannot use project-app or external runtime hooks');
  }
  return Object.freeze({
    ...adapter,
    requiresProjectApp,
    localRuntime,
    checkIds: Object.freeze([...adapter.checkIds]),
  });
}

export function createRuntimeLessonRunner(adapterInput) {
  const adapter = validateAdapter(adapterInput);

  async function runDoctor(options) {
    const { foundation, repoRoot, runId, signal, environment, timestamp, stateRoot } = options;
    const course = await runCourseLifecycle({
      action: 'doctor', repoRoot, runId, signal, environment, now: timestamp,
    });
    if (course.status === 'blocked') return course;
    const context = await loadProjectAppLessonState({ foundation, stateRoot });
    const readiness = adapter.requiresProjectApp
      ? await inspectProjectAppReadiness({ foundation, stateRoot, signal })
      : null;
    const external = adapter.inspectExternal
      ? await adapter.inspectExternal({ foundation, stateRoot, signal, environment })
      : null;
    const ready = (readiness?.ready ?? true) && (external?.ready ?? true);
    return resultDraft({
      status: ready ? 'pass' : 'blocked',
      diagnostics: [
        ...course.diagnostics,
        diagnostic(`lesson${adapter.id}.state`, 'pass', String(context.state.epoch), '1以上', '教材stateを確認しました'),
        ...(readiness ? [diagnostic(
          `lesson${adapter.id}.process`,
          readiness.ready ? 'pass' : 'fail',
          `${readiness.process.status}/${readiness.portStatus ?? readiness.reasonCode}`,
          'absent-or-stopped/available または running/owned-running',
          readiness.ready ? 'project-appを安全に起動または再利用できます' : 'project-appを利用できません',
        )] : []),
        ...(external?.diagnostics ?? []),
      ],
      reasonCode: ready ? null : (readiness?.reasonCode ?? external?.reasonCode),
      recovery: ready ? [] : (external?.ready === false
        ? external.recovery
        : [readiness?.reasonCode === 'PREREQUISITE_PORT_IN_USE'
        ? `port ${foundation.indexes.ports.get(PROJECT_APP_PORT_ID).port}を使用中のprocessを終了してください`
        : `node course.mjs lesson ${adapter.id} diagnoseを実行してください`]),
      journal: journal(adapter, foundation, stateRoot, 'read', []),
    });
  }

  async function runSetup(options) {
    const { foundation, stateRoot, runId, signal, timestamp } = options;
    const external = adapter.ensureExternal ? await adapter.ensureExternal(options) : null;
    if (external?.blocked) return external.blocked;
    const managed = adapter.requiresProjectApp
      ? await ensureProjectApp({ foundation, stateRoot, runId, signal })
      : { started: false };
    if (managed.blocked) return blockedProcess(adapter, managed.blocked, 'setup');
    const workspace = await adapter.initializeWorkspace({
      stateRoot, repoRoot: foundation.repositoryRealpath,
    });
    await updateProjectAppLessonState({
      foundation,
      stateRoot,
      lessonId: adapter.id,
      runId,
      timestamp,
      lessonLifecycle: 'ready',
      processStatus: adapter.requiresProjectApp ? 'running' : null,
      manageProjectApp: adapter.requiresProjectApp,
      workspaceResourceId: adapter.workspaceResourceId,
      workspaceStatus: 'present',
      additionalResourceStatuses: Object.fromEntries(
        (adapter.externalResourceIds ?? []).map((resourceId) => [resourceId, 'running']),
      ),
    });
    const changed = managed.started || workspace.submissionCreated || external?.changed === true;
    return resultDraft({
      status: changed ? 'pass' : 'safe-noop',
      diagnostics: [
        ...(adapter.requiresProjectApp ? [diagnostic(
          `lesson${adapter.id}.process`, 'pass', 'running', 'running', 'project-appを起動または再利用しました',
        )] : []),
        ...(external?.diagnostics ?? []),
        diagnostic(
          `lesson${adapter.id}.workspace`,
          'pass',
          relative(foundation.repositoryRealpath, workspace.submissionPath),
          `.lab/submissions/${adapter.id}/submission.json`,
          workspace.submissionCreated ? '回答templateを作成しました' : '既存回答を保持しました',
        ),
      ],
      reasonCode: changed ? null : 'LESSON_ALREADY_INITIALIZED',
      journal: journal(adapter, foundation, stateRoot, 'write'),
    });
  }

  async function runDemo(options) {
    const { foundation, stateRoot, signal } = options;
    const running = await requireRunning(adapter, { foundation, stateRoot, signal });
    if (running.blocked) return running.blocked;
    const runtime = await adapter.runScenario({
      ...options,
      origin: adapter.requiresProjectApp ? projectAppOrigin(foundation) : undefined,
    });
    const runtimePath = await adapter.writeRuntime({
      stateRoot, repoRoot: foundation.repositoryRealpath, runtime,
    });
    return resultDraft({
      status: 'pass',
      diagnostics: [
        diagnostic(`lesson${adapter.id}.runtime`, 'pass', 'fresh-scenario', 'fresh-scenario', '隔離したruntime scenarioを実行しました'),
        diagnostic(
          `lesson${adapter.id}.runtime-file`,
          'pass',
          relative(foundation.repositoryRealpath, runtimePath),
          `.lab/submissions/${adapter.id}/runtime.json`,
          '機密値を除いた観察結果を保存しました',
        ),
      ],
      journal: journal(adapter, foundation, stateRoot, 'write'),
    });
  }

  async function runObserve(options) {
    const { foundation, stateRoot, signal } = options;
    const running = await requireRunning(adapter, { foundation, stateRoot, signal });
    if (running.blocked) return running.blocked;
    const workspace = await adapter.inspectWorkspace({
      stateRoot, repoRoot: foundation.repositoryRealpath,
    });
    const ready = workspace.submissionPresent && workspace.runtimePresent;
    return resultDraft({
      status: ready ? 'pass' : 'blocked',
      diagnostics: [
        diagnostic(
          `lesson${adapter.id}.runtime`,
          workspace.runtimePresent ? 'pass' : 'fail',
          workspace.runtimePresent ? 'present' : 'missing',
          'present after demo',
          workspace.runtimePresent ? 'runtime observationを確認しました' : '先にdemoを実行してください',
        ),
        diagnostic(
          `lesson${adapter.id}.submission`,
          workspace.submissionPresent ? (workspace.todoCount === 0 ? 'pass' : 'warn') : 'fail',
          workspace.submissionPresent ? `${workspace.todoCount} TODO` : 'missing',
          '0 TODO before check',
          '回答templateの未入力数です',
        ),
      ],
      reasonCode: ready ? null : 'PREREQUISITE_LESSON_DEMO',
      recovery: ready ? [] : [`node course.mjs lesson ${adapter.id} demoを実行してください`],
      journal: journal(adapter, foundation, stateRoot, 'read'),
    });
  }

  async function runCheck(options) {
    const { foundation, stateRoot, environment, signal, timestamp } = options;
    const checkIds = bindImplementedAssessmentChecks({
      courseContract: foundation.courseContract,
      lessonId: adapter.id,
      implementedCheckIds: adapter.checkIds,
    });
    const running = await requireRunning(adapter, { foundation, stateRoot, signal });
    if (running.blocked) return { ...running.blocked, checkIds };
    let submission;
    try {
      await adapter.readRuntime({ stateRoot, repoRoot: foundation.repositoryRealpath });
      submission = await adapter.readSubmission({ stateRoot, repoRoot: foundation.repositoryRealpath });
    } catch (error) {
      if (!(error instanceof LessonWorkspaceError)) throw error;
      const missingRuntime = error.reasonCode.startsWith('RUNTIME_');
      return resultDraft({
        status: missingRuntime ? 'blocked' : 'fail',
        checkIds,
        diagnostics: [diagnostic(
          `lesson${adapter.id}.workspace`, 'fail', error.reasonCode, 'valid-runtime-and-submission', error.message,
        )],
        reasonCode: missingRuntime
          ? 'PREREQUISITE_LESSON_DEMO'
          : `CHECK_LESSON${adapter.id.toUpperCase()}_SUBMISSION_INVALID`,
        recovery: [missingRuntime
          ? `node course.mjs lesson ${adapter.id} demoを実行してください`
          : `.lab/submissions/${adapter.id}/submission.jsonを修正してください`],
        journal: journal(adapter, foundation, stateRoot, 'write'),
      });
    }
    let evaluated;
    try {
      const freshRuntime = await adapter.runScenario({
        ...options,
        submission,
        origin: adapter.requiresProjectApp ? projectAppOrigin(foundation) : undefined,
      });
      evaluated = adapter.evaluate(submission, freshRuntime);
    } catch (error) {
      if (!(error instanceof adapter.SubmissionError)) throw error;
      return resultDraft({
        status: 'fail',
        checkIds,
        diagnostics: [diagnostic(
          `lesson${adapter.id}.submission`, 'fail', error.reasonCode, 'exact-allowed-submission', error.message,
        )],
        reasonCode: `CHECK_LESSON${adapter.id.toUpperCase()}_SUBMISSION_INVALID`,
        recovery: [`.lab/submissions/${adapter.id}/submission.jsonのfieldと許可値を修正してください`],
        journal: journal(adapter, foundation, stateRoot, 'write'),
      });
    }
    const context = await loadProjectAppLessonState({ foundation, stateRoot });
    const supportEnvironment = adapter.supportEnvironment
      ? await adapter.supportEnvironment(environment)
      : environment;
    const support = await inspectSupport({ matrix: foundation.supportMatrix, environment: supportEnvironment });
    return resultDraft({
      status: evaluated.status,
      checkIds,
      diagnostics: evaluated.checks.map((check) => diagnostic(
        `lesson${adapter.id}.${check.checkId.toLowerCase()}`,
        check.passed ? 'pass' : 'fail',
        `runtime=${check.runtimePassed ? 'pass' : 'fail'},submission=${check.submissionPassed ? 'pass' : 'fail'}`,
        'runtime=pass,submission=pass',
        `${check.checkId}のruntime条件と回答を照合しました`,
      )),
      reasonCode: evaluated.status === 'pass'
        ? null
        : `CHECK_LESSON${adapter.id.toUpperCase()}_REQUIREMENTS`,
      recovery: evaluated.status === 'pass' ? [] : [
        `.lab/submissions/${adapter.id}/runtime.jsonとsubmission.jsonを照合して回答を修正してください`,
      ],
      journal: journal(adapter, foundation, stateRoot, 'write'),
      evidence: support.profile ? {
        generatedAt: timestamp,
        supportProfileId: support.profile.id,
        supportEnvironment,
        inputs: { stateEpoch: context.state.epoch, stateMarkerDigest: context.markerDigest },
        observations: evaluated.checks.map((check) => ({
          checkId: check.checkId,
          outcome: check.passed ? 'pass' : 'fail',
          reasonCode: check.passed
            ? null
            : `CHECK_${check.checkId.replaceAll('-', '_')}_REQUIREMENTS`,
          data: check.data,
          allowlist: check.allowlist,
        })),
      } : null,
    });
  }

  async function runReset(options) {
    const { foundation, stateRoot, runId, signal, timestamp } = options;
    await adapter.preflightWorkspace({ stateRoot, repoRoot: foundation.repositoryRealpath });
    let restarted;
    let external = null;
    if (!adapter.requiresProjectApp && adapter.resetExternal) {
      external = await adapter.resetExternal(options);
      if (external?.blocked) return external.blocked;
      restarted = { process: null };
    } else if (!adapter.requiresProjectApp) {
      restarted = { process: null };
    } else if (adapter.resetExternal) {
      const stopped = await stopProjectApp({ foundation, stateRoot, signal });
      if (stopped.status === 'blocked') return blockedProcess(adapter, stopped, 'stop');
      external = await adapter.resetExternal(options);
      if (external?.blocked) return external.blocked;
      const ensured = await ensureProjectApp({ foundation, stateRoot, runId, signal });
      restarted = ensured.blocked ? { blocked: ensured.blocked } : { process: ensured.process };
    } else {
      restarted = await restartProjectApp({ foundation, stateRoot, runId, signal });
    }
    if (restarted.blocked) return blockedProcess(adapter, restarted.blocked, 'setup');
    const workspace = await adapter.initializeWorkspace({
      stateRoot, repoRoot: foundation.repositoryRealpath, reset: true,
    });
    const state = await updateProjectAppLessonState({
      foundation,
      stateRoot,
      lessonId: adapter.id,
      runId,
      timestamp,
      lessonLifecycle: 'ready',
      processStatus: adapter.requiresProjectApp ? 'running' : null,
      manageProjectApp: adapter.requiresProjectApp,
      workspaceResourceId: adapter.workspaceResourceId,
      workspaceStatus: 'present',
      additionalResourceStatuses: Object.fromEntries(
        (adapter.externalResourceIds ?? []).map((resourceId) => [resourceId, 'running']),
      ),
      incrementEpoch: true,
    });
    return resultDraft({
      status: 'pass',
      diagnostics: [
        ...(adapter.requiresProjectApp ? [diagnostic(
          `lesson${adapter.id}.process`, 'pass', 'restarted', 'restarted', 'project-appの制御情報を更新しました',
        )] : []),
        ...(external?.diagnostics ?? []),
        diagnostic(`lesson${adapter.id}.state-epoch`, 'pass', String(state.state.epoch), 'previous + 1', '実行世代を進めました'),
        diagnostic(
          `lesson${adapter.id}.workspace`, 'pass',
          relative(foundation.repositoryRealpath, workspace.submissionPath),
          `.lab/submissions/${adapter.id}/submission.json`, '回答templateを初期状態へ戻しました',
        ),
      ],
      journal: journal(adapter, foundation, stateRoot, 'write'),
    });
  }

  async function runStop(options) {
    const { foundation, stateRoot, runId, signal, timestamp } = options;
    const stopped = adapter.requiresProjectApp
      ? await stopProjectApp({ foundation, stateRoot, signal })
      : { status: 'safe-noop', reasonCode: 'PROJECT_APP_NOT_REQUIRED' };
    if (stopped.status === 'blocked') return blockedProcess(adapter, stopped, 'stop');
    const external = adapter.stopExternal ? await adapter.stopExternal(options) : null;
    if (external?.blocked) return external.blocked;
    const absent = adapter.requiresProjectApp && stopped.reasonCode === 'PROCESS_NOT_RECORDED';
    await updateProjectAppLessonState({
      foundation,
      stateRoot,
      lessonId: adapter.id,
      runId,
      timestamp,
      lessonLifecycle: 'stopped',
      processStatus: adapter.requiresProjectApp ? (absent ? 'absent' : 'stopped') : null,
      manageProjectApp: adapter.requiresProjectApp,
      additionalResourceStatuses: Object.fromEntries(
        (adapter.externalResourceIds ?? []).map((resourceId) => [
          resourceId,
          external?.status === 'absent' ? 'absent' : 'stopped',
        ]),
      ),
    });
    const changed = adapter.requiresProjectApp
      ? stopped.status === 'stopped'
      : external?.status === 'stopped';
    return resultDraft({
      status: changed ? 'pass' : 'safe-noop',
      diagnostics: [...(adapter.requiresProjectApp ? [diagnostic(
        `lesson${adapter.id}.process`, 'pass', absent ? 'absent' : 'stopped', 'absent|stopped',
        '共有project-appを所有確認して停止し、回答は保持しました',
      )] : []), ...(external?.diagnostics ?? [])],
      reasonCode: changed ? null : (external?.reasonCode ?? stopped.reasonCode),
      journal: journal(adapter, foundation, stateRoot, 'write', [
        ...(adapter.requiresProjectApp ? [PROJECT_APP_RESOURCE_ID] : []),
        ...(adapter.externalResourceIds ?? []),
      ]),
    });
  }

  async function runDiagnose(options) {
    const { foundation, stateRoot, signal } = options;
    const context = await loadProjectAppLessonState({ foundation, stateRoot });
    const readiness = adapter.requiresProjectApp
      ? await inspectProjectAppReadiness({ foundation, stateRoot, signal })
      : null;
    let workspace;
    try {
      workspace = await adapter.inspectWorkspace({ stateRoot, repoRoot: foundation.repositoryRealpath });
    } catch (error) {
      if (!(error instanceof LessonWorkspaceError)) throw error;
      workspace = { submissionPresent: false, runtimePresent: false, todoCount: null };
    }
    const processResource = adapter.requiresProjectApp
      ? context.state.resources.find(({ id }) => id === PROJECT_APP_RESOURCE_ID)
      : null;
    const processCoherent = !adapter.requiresProjectApp || (
      readiness.process.status !== 'blocked'
      && (readiness.process.status !== 'running' || readiness.ready)
      && processResource?.status === readiness.process.status
    );
    const external = adapter.inspectExternal
      ? await adapter.inspectExternal({ foundation, stateRoot, signal, diagnose: true })
      : null;
    const externalCoherent = external === null || (
      external.reasonCode === null
      && adapter.externalResourceIds.every((resourceId) => (
        context.state.resources.find(({ id }) => id === resourceId)?.status === external.resourceStatus
      ))
    );
    const coherent = processCoherent && workspace.submissionPresent && externalCoherent;
    return resultDraft({
      status: coherent ? 'pass' : 'blocked',
      diagnostics: [
        ...(adapter.requiresProjectApp ? [diagnostic(
          `lesson${adapter.id}.process-state`, processCoherent ? 'pass' : 'fail',
          `${readiness.process.status}/${processResource?.status ?? 'missing'}`,
          'process recordとstateが一致', '共有processの記録を照合しました',
        )] : []),
        diagnostic(
          `lesson${adapter.id}.workspace`, workspace.submissionPresent ? 'pass' : 'fail',
          workspace.submissionPresent ? 'present' : 'missing', 'present', '回答workspaceを照合しました',
        ),
        ...(external?.diagnostics ?? []),
      ],
      reasonCode: coherent ? null : (
        readiness?.reasonCode ?? external?.reasonCode ?? 'STATE_LESSON_WORKSPACE_DRIFT'
      ),
      recovery: coherent ? [] : [adapter.requiresProjectApp && projectAppNeedsRecovery(readiness.process)
        ? `node course.mjs lesson ${adapter.id} setupを実行してください`
        : '回答を退避し、course purgeからやり直してください'],
      journal: journal(adapter, foundation, stateRoot, 'read'),
    });
  }

  return async function runRuntimeLesson({
    action, repoRoot, runId, signal, environment, timestamp, foundation,
  } = {}) {
    const stateRoot = projectAppStateRoot(foundation);
    const options = { foundation, repoRoot, stateRoot, runId, signal, environment, timestamp };
    if (action === 'doctor') return runDoctor(options);
    if (action === 'setup') return runSetup(options);
    if (action === 'demo') return runDemo(options);
    if (action === 'observe') return runObserve(options);
    if (action === 'check') return runCheck(options);
    if (action === 'diagnose') return runDiagnose(options);
    if (action === 'reset') return runReset(options);
    if (action === 'stop') return runStop(options);
    throw new TypeError(`unsupported lesson ${adapter.id} action: ${action}`);
  };
}
