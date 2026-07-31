import { resolve, relative } from 'node:path';
import { bindImplementedAssessmentChecks } from '../../runner/assessment-contract.mjs';
import { DEFAULT_STATE_ROOT, runCourseLifecycle } from '../../runner/lifecycle.mjs';
import {
  ensureProjectApp,
  inspectProjectAppProcess as inspectManaged,
  inspectProjectAppReadiness,
  loadProjectAppLessonState as loadLessonState,
  PROJECT_APP_PORT_ID,
  PROJECT_APP_RESOURCE_ID,
  projectAppJournal as journalContext,
  projectAppNeedsRecovery as needsRecovery,
  projectAppOrigin,
  restartProjectApp,
  stopProjectApp,
  updateProjectAppLessonState,
  verifyProjectAppProcess as verifyManagedProcess,
} from '../../runner/project-app-runtime.mjs';
import { inspectSupport } from '../../runner/support.mjs';
import { Lesson01SubmissionError } from './assessment.mjs';
import {
  checkLesson01ThroughApp,
  fetchLesson01Exercise,
  initializeLesson01Workspace,
  readLesson01Submission,
} from './workspace.mjs';

export const LESSON_01_ID = '01';
export const LESSON_01_SUBMISSION_RESOURCE_ID = 'data:lesson-01-submission';
export { PROJECT_APP_PORT_ID, PROJECT_APP_RESOURCE_ID };

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

async function updateLessonRuntimeState({
  foundation,
  stateRoot,
  runId,
  timestamp,
  lessonLifecycle,
  resourceStatus,
  submissionStatus = null,
  incrementEpoch = false,
  runtimeNodeMajor,
}) {
  return updateProjectAppLessonState({
    foundation,
    stateRoot,
    lessonId: LESSON_01_ID,
    runId,
    timestamp,
    lessonLifecycle,
    processStatus: resourceStatus,
    workspaceResourceId: LESSON_01_SUBMISSION_RESOURCE_ID,
    workspaceStatus: submissionStatus,
    incrementEpoch,
    runtimeNodeMajor,
  });
}

async function prepareWorkspace({ foundation, stateRoot, reset = false, signal }) {
  const origin = projectAppOrigin(foundation);
  const exercise = await fetchLesson01Exercise({ origin, signal });
  const workspace = await initializeLesson01Workspace({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    exercise,
    reset,
  });
  return { origin, exercise, workspace };
}

function processBlockedDraft(process, action) {
  return resultDraft({
    status: 'blocked',
    diagnostics: [diagnostic(
      'lesson01.process',
      'fail',
      process.reasonCode ?? 'blocked',
      action === 'stop' ? 'stopped' : 'running',
      'project-appの所有権または実行状態を安全に確認できませんでした',
    )],
    reasonCode: process.reasonCode ?? 'PROCESS_OPERATION_BLOCKED',
    recovery: ['node course.mjs lesson 01 diagnoseを実行し、表示されたprocess状態を確認してください'],
  });
}

export function lesson01ExecutionPolicy(action) {
  if (action === 'purge') return { requiresState: false, lockMode: null, transactionCommand: null };
  if (['doctor', 'observe', 'diagnose'].includes(action)) {
    return { requiresState: true, lockMode: 'read', transactionCommand: null };
  }
  if (['setup', 'reset', 'stop'].includes(action)) {
    return { requiresState: true, lockMode: 'write', transactionCommand: action };
  }
  if (action === 'check') return { requiresState: true, lockMode: 'write', transactionCommand: 'check' };
  if (action === 'demo') return { requiresState: true, lockMode: 'write', transactionCommand: null };
  throw new TypeError(`unsupported lesson 01 action: ${action}`);
}

async function runDoctor({ foundation, repoRoot, runId, signal, environment, timestamp, stateRoot }) {
  const course = await runCourseLifecycle({
    action: 'doctor', repoRoot, runId, signal, environment, now: timestamp,
  });
  if (course.status === 'blocked') return course;
  const context = await loadLessonState({ foundation, stateRoot });
  const readiness = await inspectProjectAppReadiness({ foundation, stateRoot, signal });
  const coherent = readiness.ready;
  return resultDraft({
    status: coherent ? 'pass' : 'blocked',
    diagnostics: [
      ...course.diagnostics,
      diagnostic('lesson01.state', 'pass', String(context.state.epoch), '1以上', '教材stateを確認しました'),
      diagnostic(
        'lesson01.process',
        coherent ? 'pass' : 'fail',
        `${readiness.process.status}/${readiness.portStatus ?? readiness.reasonCode}`,
        'absent-or-stopped/available または running/owned-running',
        coherent ? 'project-appを安全に起動または再利用できます' : 'project-appのportまたは所有状態を利用できません',
      ),
    ],
    reasonCode: coherent ? null : readiness.reasonCode,
    recovery: coherent ? [] : [readiness.reasonCode === 'PREREQUISITE_PORT_IN_USE'
      ? `port ${foundation.indexes.ports.get(PROJECT_APP_PORT_ID).port}を使用している自分の開発サーバーを終了し、lesson 01 doctorを再実行してください`
      : 'node course.mjs lesson 01 diagnoseを実行して中断状態を確認してください'],
    journal: journalContext({ foundation, stateRoot, lockMode: 'read', resourceIds: [] }),
  });
}

async function runSetup({ foundation, stateRoot, runId, signal, timestamp, environment }) {
  const managed = await ensureProjectApp({ foundation, stateRoot, runId, signal });
  if (managed.blocked) return processBlockedDraft(managed.blocked, 'setup');
  const prepared = await prepareWorkspace({ foundation, stateRoot, signal });
  await updateLessonRuntimeState({
    foundation,
    stateRoot,
    runId,
    timestamp,
    lessonLifecycle: 'ready',
    resourceStatus: 'running',
    submissionStatus: 'present',
    runtimeNodeMajor: environment?.nodeMajor,
  });
  const changed = managed.started || prepared.workspace.submissionCreated;
  return resultDraft({
    status: changed ? 'pass' : 'safe-noop',
    diagnostics: [
      diagnostic('lesson01.process', 'pass', 'running', 'running', 'project-appはloopbackで起動しています'),
      diagnostic(
        'lesson01.workspace',
        'pass',
        relative(foundation.repositoryRealpath, prepared.workspace.submissionPath),
        '.lab/submissions/01/submission.json',
        prepared.workspace.submissionCreated ? '回答テンプレートを作成しました' : '既存の回答を保持しました',
      ),
      diagnostic('lesson01.evidence-basis', 'warn', 'provided-case', 'provided-case', '実プロトコルの実行証跡ではありません'),
    ],
    reasonCode: changed ? null : 'LESSON_ALREADY_INITIALIZED',
    journal: journalContext({
      foundation,
      stateRoot,
      lockMode: 'write',
      resourceIds: [PROJECT_APP_RESOURCE_ID, LESSON_01_SUBMISSION_RESOURCE_ID],
    }),
  });
}

async function runDemo({ foundation, stateRoot, signal }) {
  const process = await inspectManaged({ foundation, stateRoot });
  const liveness = await verifyManagedProcess(process, { signal });
  if (!liveness.healthy) {
    return resultDraft({
      status: 'blocked',
      diagnostics: [diagnostic('lesson01.process', 'fail', process.status, 'running', '先に第01回をsetupしてください')],
      reasonCode: liveness.reasonCode ?? process.reasonCode ?? 'PREREQUISITE_LESSON_SETUP',
      recovery: ['node course.mjs lesson 01 setupを実行してください'],
    });
  }
  const prepared = await prepareWorkspace({ foundation, stateRoot, signal });
  return resultDraft({
    status: 'pass',
    diagnostics: [
      diagnostic('lesson01.case-count', 'pass', String(prepared.exercise.traces.length), '10', '分類する事例を取得しました'),
      diagnostic('lesson01.runtime-evidence', 'warn', 'false', 'false', prepared.exercise.evidenceNotice),
      diagnostic(
        'lesson01.submission',
        'pass',
        relative(foundation.repositoryRealpath, prepared.workspace.submissionPath),
        '.lab/submissions/01/submission.json',
        'このファイルのTODOを選択肢IDへ置き換えます',
      ),
    ],
    journal: journalContext({
      foundation,
      stateRoot,
      lockMode: 'write',
      resourceIds: [PROJECT_APP_RESOURCE_ID, LESSON_01_SUBMISSION_RESOURCE_ID],
    }),
  });
}

async function runObserve({ foundation, stateRoot, signal }) {
  const process = await inspectManaged({ foundation, stateRoot });
  const liveness = await verifyManagedProcess(process, { signal });
  let submission;
  let submissionError;
  try {
    submission = await readLesson01Submission({ stateRoot, repoRoot: foundation.repositoryRealpath });
  } catch (error) {
    if (!(error instanceof Lesson01SubmissionError)) throw error;
    submissionError = error;
  }
  const todoCount = submission
    ? JSON.stringify(submission).match(/"TODO"/g)?.length ?? 0
    : null;
  const ready = liveness.healthy && submission !== undefined;
  const submissionReasonCode = submissionError?.reasonCode === 'SUBMISSION_MISSING'
    ? 'PREREQUISITE_LESSON_WORKSPACE_MISSING'
    : submissionError
      ? 'PREREQUISITE_LESSON_WORKSPACE_INVALID'
      : null;
  return resultDraft({
    status: ready ? 'pass' : 'blocked',
    diagnostics: [
      diagnostic('lesson01.process', liveness.healthy ? 'pass' : 'fail', process.status, 'running-and-healthy', 'project-appの状態です'),
      diagnostic(
        'lesson01.submission',
        submission ? (todoCount === 0 ? 'pass' : 'warn') : 'fail',
        submission ? `${todoCount} TODO` : 'missing',
        '0 TODO before check',
        submission ? '回答ファイルの未入力数です' : '回答ファイルがありません',
      ),
      diagnostic('lesson01.runtime-evidence', 'warn', 'false', 'false', 'この回はprovided caseの分類を観察します'),
    ],
    reasonCode: ready
      ? null
      : (submissionReasonCode ?? liveness.reasonCode ?? process.reasonCode ?? 'PREREQUISITE_LESSON_SETUP'),
    recovery: ready
      ? []
      : [submissionError?.reasonCode === 'SUBMISSION_MISSING'
        ? 'node course.mjs lesson 01 setupを実行して回答テンプレートを再作成してください'
        : submissionError
          ? '.lab/submissions/01/submission.jsonを直すか、node course.mjs lesson 01 resetで再作成してください'
          : 'node course.mjs lesson 01 setupを実行してください'],
    journal: journalContext({
      foundation,
      stateRoot,
      lockMode: 'read',
      resourceIds: [PROJECT_APP_RESOURCE_ID, LESSON_01_SUBMISSION_RESOURCE_ID],
    }),
  });
}

async function runCheck({ foundation, stateRoot, environment, signal, timestamp }) {
  const checkIds = bindImplementedAssessmentChecks({
    courseContract: foundation.courseContract,
    lessonId: LESSON_01_ID,
    implementedCheckIds: ['AA01-C1', 'AA01-C2'],
  });
  const process = await inspectManaged({ foundation, stateRoot });
  const liveness = await verifyManagedProcess(process, { signal });
  if (!liveness.healthy) {
    return resultDraft({
      status: 'blocked',
      checkIds,
      diagnostics: [diagnostic('lesson01.process', 'fail', process.status, 'running', '先に第01回をsetupしてください')],
      reasonCode: liveness.reasonCode ?? process.reasonCode ?? 'PREREQUISITE_LESSON_SETUP',
      recovery: ['node course.mjs lesson 01 setupを実行してください'],
    });
  }
  let submission;
  let checked;
  try {
    submission = await readLesson01Submission({ stateRoot, repoRoot: foundation.repositoryRealpath });
    checked = await checkLesson01ThroughApp({
      origin: projectAppOrigin(foundation),
      submission,
      signal,
    });
  } catch (error) {
    if (!(error instanceof Lesson01SubmissionError)) throw error;
    return resultDraft({
      status: 'fail',
      checkIds,
      diagnostics: [diagnostic('lesson01.submission', 'fail', error.reasonCode, 'valid-complete-submission', error.message)],
      reasonCode: 'CHECK_LESSON01_SUBMISSION_INVALID',
      recovery: [error.reasonCode === 'SUBMISSION_MISSING'
        ? 'node course.mjs lesson 01 resetを実行して回答テンプレートを再作成してください'
        : '.lab/submissions/01/submission.jsonを直してcheckを再実行してください'],
      journal: journalContext({
        foundation,
        stateRoot,
        lockMode: 'write',
        resourceIds: [PROJECT_APP_RESOURCE_ID, LESSON_01_SUBMISSION_RESOURCE_ID],
      }),
    });
  }
  const correctVerifierBoundaries = checked.verifierResults.filter(({ correct }) => correct).length;
  const passed = checked.status === 'pass';
  const context = await loadLessonState({ foundation, stateRoot });
  const support = await inspectSupport({ matrix: foundation.supportMatrix, environment });
  return resultDraft({
    status: passed ? 'pass' : 'fail',
    checkIds,
    diagnostics: [
      diagnostic(
        'lesson01.trace-score',
        checked.criteria.traceThresholdMet ? 'pass' : 'fail',
        `${checked.score.correctTraces}/${checked.score.totalTraces}`,
        `${checked.criteria.minimumCorrectTraces}/${checked.score.totalTraces}以上`,
        'provided caseの分類結果です',
      ),
      diagnostic(
        'lesson01.verifier-coverage',
        checked.criteria.allBoundariesVerified ? 'pass' : 'fail',
        `${correctVerifierBoundaries}/${checked.verifierResults.length}`,
        `${checked.verifierResults.length}/${checked.verifierResults.length}`,
        '責任境界と検証者の対応結果です',
      ),
      diagnostic('lesson01.runtime-evidence', 'warn', 'false', 'false', 'この結果は実プロトコルの実行証跡ではありません'),
    ],
    reasonCode: passed ? null : 'CHECK_LESSON01_REQUIREMENTS',
    recovery: passed ? [] : ['誤答した責任境界を見直し、submission.jsonを直してcheckを再実行してください'],
    journal: journalContext({
      foundation,
      stateRoot,
      lockMode: 'write',
      resourceIds: [PROJECT_APP_RESOURCE_ID, LESSON_01_SUBMISSION_RESOURCE_ID],
    }),
    evidence: support.profile ? {
      generatedAt: timestamp,
      supportProfileId: support.profile.id,
      supportEnvironment: environment,
      inputs: { stateEpoch: context.state.epoch, stateMarkerDigest: context.markerDigest },
      observations: [
        {
          checkId: 'AA01-C1',
          outcome: checked.criteria.traceThresholdMet ? 'pass' : 'fail',
          reasonCode: checked.criteria.traceThresholdMet ? null : 'CHECK_LESSON01_TRACE_THRESHOLD',
          data: {
            evidenceBasis: checked.evidenceBasis,
            runtimeEvidence: checked.runtimeEvidence,
            correctTraces: checked.score.correctTraces,
            totalTraces: checked.score.totalTraces,
            minimumCorrectTraces: checked.criteria.minimumCorrectTraces,
            traceThresholdMet: checked.criteria.traceThresholdMet,
          },
          allowlist: [
            'evidenceBasis', 'runtimeEvidence', 'correctTraces', 'totalTraces',
            'minimumCorrectTraces', 'traceThresholdMet',
          ],
        },
        {
          checkId: 'AA01-C2',
          outcome: checked.criteria.allBoundariesVerified ? 'pass' : 'fail',
          reasonCode: checked.criteria.allBoundariesVerified ? null : 'CHECK_LESSON01_VERIFIER_MAPPING',
          data: {
            evidenceBasis: checked.evidenceBasis,
            runtimeEvidence: checked.runtimeEvidence,
            correctVerifierBoundaries,
            totalVerifierBoundaries: checked.verifierResults.length,
            allBoundariesVerified: checked.criteria.allBoundariesVerified,
          },
          allowlist: [
            'evidenceBasis', 'runtimeEvidence', 'correctVerifierBoundaries',
            'totalVerifierBoundaries', 'allBoundariesVerified',
          ],
        },
      ],
    } : null,
  });
}

async function runReset({ foundation, stateRoot, runId, signal, timestamp, environment }) {
  const restarted = await restartProjectApp({ foundation, stateRoot, runId, signal });
  if (restarted.blocked) return processBlockedDraft(restarted.blocked, 'setup');
  const prepared = await prepareWorkspace({ foundation, stateRoot, reset: true, signal });
  const state = await updateLessonRuntimeState({
    foundation,
    stateRoot,
    runId,
    timestamp,
    lessonLifecycle: 'ready',
    resourceStatus: 'running',
    submissionStatus: 'present',
    incrementEpoch: true,
    runtimeNodeMajor: environment?.nodeMajor,
  });
  return resultDraft({
    status: 'pass',
    diagnostics: [
      diagnostic('lesson01.process', 'pass', 'restarted', 'restarted', 'project-appの制御tokenを更新して再起動しました'),
      diagnostic('lesson01.state-epoch', 'pass', String(state.state.epoch), 'previous + 1', '実行世代を進めました'),
      diagnostic(
        'lesson01.submission',
        'pass',
        relative(foundation.repositoryRealpath, prepared.workspace.submissionPath),
        '.lab/submissions/01/submission.json',
        '回答テンプレートを初期状態へ戻しました',
      ),
    ],
    journal: journalContext({
      foundation,
      stateRoot,
      lockMode: 'write',
      resourceIds: [PROJECT_APP_RESOURCE_ID, LESSON_01_SUBMISSION_RESOURCE_ID],
    }),
  });
}

async function runStop({ foundation, stateRoot, runId, signal, timestamp, environment }) {
  const stopped = await stopProjectApp({ foundation, stateRoot, signal });
  if (stopped.status === 'blocked') return processBlockedDraft(stopped, 'stop');
  const noRecord = stopped.reasonCode === 'PROCESS_NOT_RECORDED';
  await updateLessonRuntimeState({
    foundation,
    stateRoot,
    runId,
    timestamp,
    lessonLifecycle: 'stopped',
    resourceStatus: noRecord ? 'absent' : 'stopped',
    runtimeNodeMajor: environment?.nodeMajor,
  });
  return resultDraft({
    status: stopped.status === 'stopped' ? 'pass' : 'safe-noop',
    diagnostics: [diagnostic(
      'lesson01.process',
      'pass',
      noRecord ? 'absent' : 'stopped',
      'absent|stopped',
      '教材が所有するproject-appだけを停止しました',
    )],
    reasonCode: stopped.status === 'stopped' ? null : stopped.reasonCode,
    journal: journalContext({ foundation, stateRoot, lockMode: 'write', resourceIds: [PROJECT_APP_RESOURCE_ID] }),
  });
}

async function runDiagnose({ foundation, stateRoot, signal }) {
  const context = await loadLessonState({ foundation, stateRoot });
  const process = await inspectManaged({ foundation, stateRoot });
  const liveness = await verifyManagedProcess(process, { signal });
  const resource = context.state.resources.find(({ id }) => id === PROJECT_APP_RESOURCE_ID);
  const expected = process.status === 'running' ? 'running' : (process.status === 'stopped' ? 'stopped' : 'absent');
  const coherent = process.status !== 'blocked'
    && (process.status !== 'running' || liveness.healthy)
    && resource?.status === expected;
  return resultDraft({
    status: coherent ? 'pass' : 'blocked',
    diagnostics: [
      diagnostic(
        'lesson01.process-state',
        coherent ? 'pass' : 'fail',
        `${process.status}/${resource?.status ?? 'missing'}`,
        `${expected}/${expected}`,
        coherent ? 'process recordとcourse stateは一致しています' : 'process recordとcourse stateが一致しません',
      ),
      diagnostic('lesson01.runtime-evidence', 'warn', 'false', 'false', 'provided caseとruntime protocol evidenceを区別しています'),
    ],
    reasonCode: coherent ? null : (liveness.reasonCode ?? process.reasonCode ?? 'STATE_MANAGED_PROCESS_DRIFT'),
    recovery: coherent ? [] : [needsRecovery(process)
      ? 'node course.mjs lesson 01 setupを実行して中断したprocessを復旧してください'
      : '回答を退避し、node course.mjs purge --yesの後にsetupし直してください'],
    journal: journalContext({
      foundation,
      stateRoot,
      lockMode: 'read',
      resourceIds: [PROJECT_APP_RESOURCE_ID, LESSON_01_SUBMISSION_RESOURCE_ID],
    }),
  });
}

export async function runLesson01({
  action,
  repoRoot,
  runId,
  signal,
  environment,
  timestamp,
  foundation,
} = {}) {
  const stateRoot = resolve(foundation.repositoryRealpath, DEFAULT_STATE_ROOT);
  const options = { foundation, repoRoot, stateRoot, runId, signal, environment, timestamp };
  if (action === 'doctor') return runDoctor(options);
  if (action === 'setup') return runSetup(options);
  if (action === 'demo') return runDemo(options);
  if (action === 'observe') return runObserve(options);
  if (action === 'check') return runCheck(options);
  if (action === 'diagnose') return runDiagnose(options);
  if (action === 'reset') return runReset(options);
  if (action === 'stop') return runStop(options);
  throw new TypeError(`unsupported lesson 01 action: ${action}`);
}
