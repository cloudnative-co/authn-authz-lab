import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getLessonImplementation,
  LESSON_01_SETUP_RECOVERY,
} from '../lessons/registry.mjs';
import { appendJournal, readJournal } from './journal.mjs';
import { bindImplementedAssessmentChecks } from './assessment-contract.mjs';
import { CliUsageError, parseCli } from './cli.mjs';
import { COURSE_USAGE, EXIT_CODES, LESSON_USAGE, RESULT_SCHEMA_PATH } from './constants.mjs';
import { canonicalJson } from './canonical.mjs';
import { DEFAULT_STATE_ROOT, loadCourseFoundation, runCourseLifecycle } from './lifecycle.mjs';
import { writeEvidence } from './evidence.mjs';
import {
  acquireLock,
  inspectInterruptedLessonSetupLock,
} from './lock.mjs';
import { createCleanupScope } from './process.mjs';
import {
  createRunnerResult,
  exitCodeForResult,
  exitCodeForSignal,
  formatRunnerResult,
} from './result.mjs';
import { assertValidSchema, loadJsonSchema } from './schema.mjs';
import { assertStateMatchesManifest, loadStateContext, writeStateAtomically } from './state.mjs';
import { inspectSupport } from './support.mjs';
import {
  attachTransactionToLock,
  beginMutation,
  beginTransaction,
  commitTransaction,
  LESSON_01_SETUP_OPERATION,
  readTransactions,
  withMutationContext,
} from './transaction.mjs';

const moduleRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_TIMEOUT_MS = 30_000;

function usageErrorDocument(message = 'コマンドライン引数が不正です') {
  return {
    $schema: 'curriculum/schemas/usage-error.schema.json',
    schemaVersion: 1,
    status: 'usage-error',
    reasonCode: 'USAGE_ERROR',
    message,
    usage: [COURSE_USAGE, LESSON_USAGE],
  };
}

function helpText() {
  return [
    '認証認可入門 course runner',
    '',
    '最初に実行:',
    `  ${COURSE_USAGE}`,
    '',
    'lesson操作:',
    `  ${LESSON_USAGE}`,
    '',
    '--non-interactiveは入力待ちを禁止する意思を明示します。現行commandは常に入力待ちを行いません。',
    'purgeは教材所有stateを削除するため、常に--yesが必要です。',
    '',
  ].join('\n');
}

async function canRetryInterruptedLessonSetup({ parsed, repoRoot }) {
  const implementation = parsed.scope === 'lesson'
    ? getLessonImplementation(parsed.lessonId)
    : null;
  if (implementation?.interruptedSetupRecovery !== LESSON_01_SETUP_RECOVERY
      || parsed.action !== 'diagnose') return false;
  try {
    const foundation = await loadCourseFoundation({ repoRoot });
    const stateRoot = resolve(foundation.repositoryRealpath, DEFAULT_STATE_ROOT);
    const transactions = await readTransactions({ stateRoot, repoRoot: foundation.repositoryRealpath });
    const pending = transactions.filter(({ phase }) => ['begun', 'prepared'].includes(phase));
    if (pending.length !== 1
        || pending[0].operationId !== LESSON_01_SETUP_OPERATION
        || typeof pending[0].stateDigestBefore !== 'string') {
      return false;
    }
    const candidateDigests = pending[0].phase === 'prepared'
      ? [pending[0].stateDigestBefore, pending[0].stateDigestAfter]
      : [pending[0].stateDigestBefore];
    for (const stateDigestBefore of candidateDigests) {
      try {
        await inspectInterruptedLessonSetupLock({
          stateRoot,
          repoRoot: foundation.repositoryRealpath,
          courseId: foundation.manifest.courseId,
          sourceRevision: foundation.courseLock.sourceRevision,
          sourceDigest: foundation.sourceDigest,
          interruptedRunId: pending[0].runId,
          stateDigestBefore,
        });
        return true;
      } catch {
        // A prepared write is recoverable only when current state equals its exact pre- or post-image.
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function errorRecovery(reasonCode, context) {
  if (reasonCode === 'PREREQUISITE_SETUP') {
    return ['node course.mjs setupを実行してからlesson commandを再実行してください'];
  }
  if (reasonCode === 'PREREQUISITE_LESSON_SETUP') {
    return [`node course.mjs lesson ${context.parsed.lessonId} setupを実行してから再実行してください`];
  }
  if (reasonCode === 'COURSE_ARTIFACT_DRIFT') {
    return ['変更された教材ファイルを同じrevisionの配布物から復元し、node course.mjs doctorを再実行してください'];
  }
  if (reasonCode === 'COURSE_ASSESSMENT_CONTRACT') {
    return ['同じ教材revisionのcurriculumとrunnerへ揃え、node course.mjs doctorを再実行してください'];
  }
  if (reasonCode === 'STATE_UNOWNED_ROOT') {
    return ['.labの内容が自分のファイルなら教材外へ退避し、空の.labだけにしてからnode course.mjs setupを実行してください'];
  }
  if (reasonCode === 'LOCK_STALE') {
    if (await canRetryInterruptedLessonSetup(context)) {
      return ['node course.mjs lesson 01 setupを再実行して、中断したsetupを安全に復旧してください'];
    }
    return ['停止中の教材processがないことを確認し、node course.mjs purge --yes を実行してください'];
  }
  if (reasonCode?.startsWith('LOCK_')) return ['少し待ってから node course.mjs diagnose を実行してください'];
  if (reasonCode?.startsWith('PROCESS_')) {
    return [`node course.mjs lesson ${context.parsed.lessonId} diagnoseを実行し、解決しない場合は回答を退避してcourse purgeからやり直してください`];
  }
  if (reasonCode?.startsWith('CONTAINER_') || reasonCode?.startsWith('PREREQUISITE_DOCKER_')) {
    return [`node course.mjs lesson ${context.parsed.lessonId ?? '06'} diagnoseを実行し、Dockerの状態を確認してください`];
  }
  if (reasonCode === 'PREREQUISITE_LDAP_PORT_IN_USE'
      || reasonCode === 'PREREQUISITE_CONTAINER_PORT_IN_USE') {
    return ['port 1389を使用中のprocessまたはcontainerを停止してください'];
  }
  if (reasonCode === 'STATE_SOURCE_DRIFT') {
    return ['以前のsourceへ戻すか、node course.mjs purge --yes の後にsetupし直してください'];
  }
  if (reasonCode?.startsWith('STATE_')) return ['node course.mjs diagnose を実行してください'];
  if (reasonCode?.startsWith('TIMEOUT_')) return ['node course.mjs diagnose を実行して残存resourceを確認してください'];
  return ['node course.mjs diagnose を実行し、解決しない場合は実行結果のreasonCodeを報告してください'];
}

function normalizeErrorReason(error) {
  if (error?.reasonCode === 'OPERATION_TIMEOUT') return 'TIMEOUT_COMMAND';
  if (typeof error?.reasonCode === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.reasonCode)) return error.reasonCode;
  return 'INTERNAL_ERROR';
}

function errorDiagnosticMessage(error, reasonCode) {
  if (['COURSE_ARTIFACT_DRIFT', 'COURSE_ASSESSMENT_CONTRACT'].includes(reasonCode)
      && typeof error?.message === 'string') {
    return `教材ファイルの整合性検証に失敗しました: ${error.message}`;
  }
  return 'コマンドを安全に完了できませんでした';
}

function missingSetupStateDraft(checkIds) {
  if (!Array.isArray(checkIds) || checkIds.length === 0) {
    throw new TypeError('setup assessment checkIds are required');
  }
  return {
    status: 'fail',
    checkIds,
    diagnostics: [{
      id: 'setup.initialized',
      status: 'fail',
      actual: 'absent',
      expected: 'setup-recorded',
      message: '先にnode course.mjs setupを実行してください',
    }],
    reasonCode: 'CHECK_SETUP_LIFECYCLE',
    recovery: ['doctor、setup、diagnose、reset、diagnoseの順に実行してからcheckを再実行してください'],
    journal: null,
    evidence: null,
  };
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function attachEvidenceToLesson({ foundation, stateRoot, result, timestamp }) {
  const context = await loadStateContext({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    courseId: foundation.manifest.courseId,
    sourceRevision: foundation.courseLock.sourceRevision,
    sourceDigest: foundation.sourceDigest,
  });
  const lesson = context.state?.lessons.find(({ id }) => id === result.lessonId);
  assertStateMatchesManifest(context.state, foundation.manifest);
  if (!lesson) throw new Error(`stateにlesson ${result.lessonId}がありません`);
  if (lesson.evidenceIds.includes(result.evidenceId)) {
    throw new Error(`evidence ${result.evidenceId}はすでにstateへ記録されています`);
  }
  const state = {
    ...context.state,
    lessons: context.state.lessons.map((candidate) => candidate.id === result.lessonId
      ? {
        ...candidate,
        lifecycle: result.status === 'pass' ? 'ready' : 'failed',
        lastRunId: result.runId,
        evidenceIds: [...candidate.evidenceIds, result.evidenceId],
      }
      : candidate),
    updatedAt: timestamp,
  };
  const written = await writeStateAtomically({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    courseId: foundation.manifest.courseId,
    sourceRevision: foundation.courseLock.sourceRevision,
    sourceDigest: foundation.sourceDigest,
    state,
  });
  return written.state.epoch;
}

async function runSetupLesson({ parsed, repoRoot, runId, signal, environment, timestamp, foundation: providedFoundation }) {
  if (['doctor', 'setup', 'diagnose', 'stop', 'reset', 'purge'].includes(parsed.action)) {
    return runCourseLifecycle({
      action: parsed.action,
      repoRoot,
      runId,
      signal,
      environment,
      now: timestamp,
    });
  }
  if (parsed.action !== 'check') {
    return {
      status: 'blocked',
      checkIds: [],
      diagnostics: [{
        id: 'lesson.action',
        status: 'fail',
        actual: parsed.action,
        expected: 'doctor|setup|diagnose|check|reset|stop|purge',
        message: 'setup lessonではこのactionを使いません',
      }],
      reasonCode: 'PREREQUISITE_ACTION_NOT_APPLICABLE',
      recovery: ['node course.mjs lesson setup check を実行してください'],
      journal: null,
    };
  }
  const foundation = providedFoundation ?? await loadCourseFoundation({ repoRoot });
  const checkIds = bindImplementedAssessmentChecks({
    courseContract: foundation.courseContract,
    lessonId: 'setup',
    implementedCheckIds: ['AA-SETUP-C1', 'AA-SETUP-C2', 'AA-SETUP-C3'],
  });
  const stateRoot = resolve(foundation.repositoryRealpath, DEFAULT_STATE_ROOT);
  if (!await pathExists(stateRoot)) return missingSetupStateDraft(checkIds);
  const doctor = await runCourseLifecycle({ action: 'doctor', repoRoot, runId, signal, environment, now: timestamp });
  const state = await loadStateContext({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    courseId: foundation.manifest.courseId,
    sourceRevision: foundation.courseLock.sourceRevision,
    sourceDigest: foundation.sourceDigest,
  });
  if (!state.state) return missingSetupStateDraft(checkIds);
  assertStateMatchesManifest(state.state, foundation.manifest);
  const journal = await readJournal({ stateRoot, repoRoot: foundation.repositoryRealpath });
  const setupIndex = journal.findIndex(({ command, status }) => command === 'setup' && status === 'pass');
  let resetIndex = -1;
  for (const [index, entry] of journal.entries()) {
    if (entry.command === 'reset' && entry.status === 'pass') resetIndex = index;
  }
  const diagnosisBeforeReset = journal.some(({ command, status }, index) => (
    command === 'diagnose' && status === 'pass' && index > setupIndex && index < resetIndex
  ));
  const diagnosisAfterReset = journal.some(({ command, status }, index) => (
    command === 'diagnose' && status === 'pass' && index > resetIndex
  ));
  const initialized = Boolean(state.state) && setupIndex >= 0;
  const resetVerified = (state.state?.epoch ?? 0) >= 2 && resetIndex > setupIndex;
  const preservedResourcesValid = state.state?.resources.every((resource) => (
    resource.id === 'directory:lab-state'
      ? resource.status === 'present' && resource.ownershipDigest === state.markerDigest
      : resource.status === 'absent' && resource.ownershipDigest === null
  )) ?? false;
  const diagnostics = [
    ...doctor.diagnostics,
    {
      id: 'setup.initialized',
      status: initialized ? 'pass' : 'fail',
      actual: initialized ? 'setup-recorded' : 'missing',
      expected: 'setup-recorded',
      message: initialized ? '初期化と履歴を確認しました' : 'node course.mjs setup を実行してください',
    },
    {
      id: 'setup.reset-epoch',
      status: resetVerified && diagnosisBeforeReset && diagnosisAfterReset ? 'pass' : 'fail',
      actual: String(state.state?.epoch ?? 0),
      expected: '2以上',
      message: resetVerified && diagnosisBeforeReset && diagnosisAfterReset
        ? 'reset前後の診断と実行世代の更新を確認しました'
        : 'diagnose、reset、diagnoseの順で実行してください',
    },
    {
      id: 'setup.reset-resources',
      status: preservedResourcesValid ? 'pass' : 'fail',
      actual: preservedResourcesValid ? 'owned-state-only' : 'unexpected-resource-state',
      expected: 'state rootだけを所有済みとして保持',
      message: preservedResourcesValid
        ? 'reset後の教材resourceは規定の状態です'
        : 'node course.mjs diagnoseを実行してresource状態を確認してください',
    },
  ];
  const passed = doctor.status === 'pass'
    && initialized
    && resetVerified
    && diagnosisBeforeReset
    && diagnosisAfterReset
    && preservedResourcesValid;
  const support = await inspectSupport({ matrix: foundation.supportMatrix, environment });
  return {
    status: passed ? 'pass' : 'fail',
    checkIds,
    diagnostics,
    reasonCode: passed ? null : 'CHECK_SETUP_LIFECYCLE',
    recovery: passed ? [] : ['doctor、setup、diagnose、reset、diagnoseの順に実行してからcheckを再実行してください'],
    journal: {
      stateRoot,
      repoRoot: foundation.repositoryRealpath,
      courseId: foundation.manifest.courseId,
      sourceRevision: foundation.courseLock.sourceRevision,
      sourceDigest: foundation.sourceDigest,
      lockMode: 'write',
      resourceIds: ['directory:lab-state'],
    },
    evidence: support.profile ? {
      generatedAt: timestamp,
      supportProfileId: support.profile.id,
      supportEnvironment: environment,
      inputs: {
        stateEpoch: state.state.epoch,
        stateMarkerDigest: state.markerDigest,
      },
      observations: [
        { checkId: 'AA-SETUP-C1', outcome: doctor.status === 'pass' ? 'pass' : 'fail', reasonCode: doctor.reasonCode },
        { checkId: 'AA-SETUP-C2', outcome: initialized ? 'pass' : 'fail', reasonCode: initialized ? null : 'CHECK_SETUP_NOT_INITIALIZED' },
        {
          checkId: 'AA-SETUP-C3',
          outcome: resetVerified && diagnosisBeforeReset && diagnosisAfterReset && preservedResourcesValid ? 'pass' : 'fail',
          reasonCode: resetVerified && diagnosisBeforeReset && diagnosisAfterReset && preservedResourcesValid
            ? null
            : 'CHECK_SETUP_RESET_INCOMPLETE',
        },
      ],
    } : null,
  };
}

export function withLessonPurgeScope(purged) {
  return {
    ...purged,
    checkIds: [],
    diagnostics: [
      ...purged.diagnostics,
      {
        id: 'lesson.purge-scope',
        status: 'pass',
        actual: 'course-wide',
        expected: 'course-wide',
        message: 'lesson purgeは教材全体の所有stateを削除します',
      },
    ],
  };
}

async function runLessonPlaceholder({ parsed, repoRoot, runId, signal, environment, timestamp, foundation: providedFoundation }) {
  const foundation = providedFoundation ?? await loadCourseFoundation({ repoRoot });
  if (!foundation.indexes.lessons.has(parsed.lessonId)) {
    throw new CliUsageError(`unknown lesson id: ${parsed.lessonId}`);
  }
  if (parsed.lessonId === 'setup') {
    return runSetupLesson({ parsed, repoRoot, runId, signal, environment, timestamp, foundation });
  }
  if (parsed.action === 'purge') {
    const purged = await runCourseLifecycle({
      action: 'purge', repoRoot, runId, signal, environment, now: timestamp,
    });
    return withLessonPurgeScope(purged);
  }
  const implementation = getLessonImplementation(parsed.lessonId);
  if (implementation) {
    return implementation.run({
      action: parsed.action,
      repoRoot,
      runId,
      signal,
      environment,
      timestamp,
      foundation,
    });
  }
  return {
    status: 'blocked',
    checkIds: [],
    diagnostics: [{
      id: 'lesson.implementation',
      status: 'fail',
      actual: 'not-implemented',
      expected: 'candidate',
      message: `lesson ${parsed.lessonId}の実行教材はまだ実装されていません`,
    }],
    reasonCode: 'PREREQUISITE_LESSON_NOT_IMPLEMENTED',
    recovery: ['実装済みlessonはcurriculum/manifest.jsonで確認してください'],
    journal: null,
  };
}

function missingLessonStateDraft({ lessonId, checkIds = [] }) {
  return {
    status: 'blocked',
    checkIds,
    diagnostics: [{
      id: `lesson${lessonId}.state`,
      status: 'fail',
      actual: 'absent',
      expected: 'course-setup',
      message: '先にcourse setupを実行してください',
    }],
    reasonCode: 'PREREQUISITE_SETUP',
    recovery: ['node course.mjs setupを実行してからlesson commandを再実行してください'],
    journal: null,
    evidence: null,
  };
}

function fallbackLessonJournal({ foundation, stateRoot, policy, lessonId }) {
  const lesson = foundation.indexes.lessons.get(lessonId);
  return {
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    courseId: foundation.manifest.courseId,
    sourceRevision: foundation.courseLock.sourceRevision,
    sourceDigest: foundation.sourceDigest,
    lockMode: policy.lockMode,
    resourceIds: [...lesson.resourceIds],
  };
}

async function validateResult(result, repoRoot) {
  const schema = await loadJsonSchema(resolve(repoRoot, RESULT_SCHEMA_PATH));
  return assertValidSchema(result, schema, 'runner result');
}

async function recordJournal({ parsed, result, journal, signal }) {
  if (!journal) return;
  await appendJournal({
    ...journal,
    signal,
    entry: {
      runId: result.runId,
      courseId: result.courseId,
      lessonId: result.lessonId,
      command: result.command,
      lockMode: journal.lockMode,
      resourceIds: journal.resourceIds,
      status: result.status,
      evidenceId: result.evidenceId,
    },
  });
}

function installSignalForwarding(controller) {
  let receivedSignal = null;
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      receivedSignal ??= signal;
      controller.abort(new Error(`received ${signal}`));
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return {
    get receivedSignal() {
      return receivedSignal;
    },
    cleanup() {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    },
  };
}

export async function runCli(argv = process.argv.slice(2), {
  repoRoot = moduleRepositoryRoot,
  stdout = process.stdout,
  stderr = process.stderr,
  environment,
  now = () => new Date(),
} = {}) {
  if ((argv.length === 1 && ['help', '--help'].includes(argv[0]))) {
    stdout.write(helpText());
    return EXIT_CODES.SUCCESS;
  }
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      if (argv.includes('--json')) stdout.write(`${canonicalJson(usageErrorDocument(error.message))}\n`);
      else stderr.write(`${error.message}\n`);
      return EXIT_CODES.USAGE;
    }
    throw error;
  }

  const runId = randomUUID();
  const startedAt = now();
  const controller = new AbortController();
  const signals = installSignalForwarding(controller);
  const defaultLessonPolicy = parsed.scope === 'lesson'
    ? getLessonImplementation(parsed.lessonId)?.policy(parsed.action)
    : null;
  const timeout = createCleanupScope({
    timeoutMs: parsed.flags.timeoutMs ?? defaultLessonPolicy?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: controller.signal,
  });
  let result;
  let commandLock = null;
  try {
    try {
      let draft;
      let operationFoundation = null;
      let operationStateRoot = null;
      let operationPolicy = null;
      let commandTransaction = null;
      const setupAssessment = parsed.scope === 'lesson'
        && parsed.lessonId === 'setup'
        && parsed.action === 'check';
      const lessonImplementation = parsed.scope === 'lesson'
        ? getLessonImplementation(parsed.lessonId)
        : null;
      const implementedLessonCommand = lessonImplementation !== null
        && parsed.action !== 'purge';
      if (setupAssessment) {
        operationFoundation = await loadCourseFoundation({ repoRoot });
        const setupCheckIds = bindImplementedAssessmentChecks({
          courseContract: operationFoundation.courseContract,
          lessonId: 'setup',
          implementedCheckIds: ['AA-SETUP-C1', 'AA-SETUP-C2', 'AA-SETUP-C3'],
        });
        operationStateRoot = resolve(operationFoundation.repositoryRealpath, DEFAULT_STATE_ROOT);
        if (!await pathExists(operationStateRoot)) {
          draft = missingSetupStateDraft(setupCheckIds);
        } else {
          commandLock = await acquireLock({
            stateRoot: operationStateRoot,
            repoRoot: operationFoundation.repositoryRealpath,
            courseId: operationFoundation.manifest.courseId,
            sourceRevision: operationFoundation.courseLock.sourceRevision,
            sourceDigest: operationFoundation.sourceDigest,
            mode: 'write',
            runId,
          });
          draft = await runLessonPlaceholder({
            parsed,
            repoRoot,
            runId,
            signal: timeout.signal,
            environment,
            timestamp: startedAt.toISOString(),
            foundation: operationFoundation,
          });
        }
      } else if (implementedLessonCommand) {
        operationFoundation = await loadCourseFoundation({ repoRoot });
        operationPolicy = lessonImplementation.policy(parsed.action);
        operationStateRoot = resolve(operationFoundation.repositoryRealpath, DEFAULT_STATE_ROOT);
        const checkIds = parsed.action === 'check'
          ? bindImplementedAssessmentChecks({
            courseContract: operationFoundation.courseContract,
            lessonId: lessonImplementation.id,
            implementedCheckIds: lessonImplementation.implementedCheckIds,
          })
          : [];
        if (!await pathExists(operationStateRoot)) {
          draft = missingLessonStateDraft({ lessonId: lessonImplementation.id, checkIds });
        } else {
          const lockOptions = {
            stateRoot: operationStateRoot,
            repoRoot: operationFoundation.repositoryRealpath,
            courseId: operationFoundation.manifest.courseId,
            sourceRevision: operationFoundation.courseLock.sourceRevision,
            sourceDigest: operationFoundation.sourceDigest,
            mode: operationPolicy.lockMode,
            runId,
          };
          if (operationPolicy.transactionCommand) {
            const mutation = await beginMutation({
              ...lockOptions,
              operationId: `lesson:${lessonImplementation.id}:${operationPolicy.transactionCommand}`,
              command: operationPolicy.transactionCommand,
              signal: timeout.signal,
              timestamp: startedAt.toISOString(),
            });
            commandLock = mutation.lock;
            commandTransaction = mutation.transaction;
          } else {
            commandLock = await acquireLock(lockOptions);
          }
          const runImplementedLesson = () => runLessonPlaceholder({
            parsed,
            repoRoot,
            runId,
            signal: timeout.signal,
            environment,
            timestamp: startedAt.toISOString(),
            foundation: operationFoundation,
          });
          draft = commandTransaction
            ? await withMutationContext(commandTransaction, runImplementedLesson)
            : await runImplementedLesson();
          if (!draft.journal) {
            draft.journal = fallbackLessonJournal({
              foundation: operationFoundation,
              stateRoot: operationStateRoot,
              policy: operationPolicy,
              lessonId: parsed.lessonId,
            });
          }
        }
      } else {
        draft = parsed.scope === 'course'
          ? await runCourseLifecycle({
            action: parsed.action,
            repoRoot,
            runId,
            now: startedAt.toISOString(),
            environment,
            signal: timeout.signal,
          })
          : await runLessonPlaceholder({
            parsed,
            repoRoot,
            runId,
            signal: timeout.signal,
            environment,
            timestamp: startedAt.toISOString(),
          });
      }
      if (timeout.signal.aborted) throw timeout.signal.reason;
      result = createRunnerResult({
        runId,
        courseId: 'auth-authz',
        scope: parsed.scope,
        lessonId: parsed.lessonId,
        command: parsed.action,
        status: draft.status,
        checkIds: draft.checkIds,
        diagnostics: draft.diagnostics,
        reasonCode: draft.reasonCode,
        recovery: draft.recovery,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
      });
      await validateResult(result, repoRoot);

      let stateEpochAfter = null;
      if (draft.evidence) {
        if (!commandLock || !operationFoundation || !operationStateRoot) {
          throw new Error('assessment evidence requires its write lock');
        }
        if (!commandTransaction) {
          commandTransaction = await beginTransaction({
            stateRoot: operationStateRoot,
            repoRoot: operationFoundation.repositoryRealpath,
            runId,
            operationId: `lesson:${parsed.lessonId}:check`,
            command: 'check',
            signal: timeout.signal,
            timestamp: startedAt.toISOString(),
          });
          attachTransactionToLock(commandLock, commandTransaction);
        }
        const written = await writeEvidence({
          stateRoot: operationStateRoot,
          result,
          context: {
            ...draft.evidence,
            repoRoot: operationFoundation.repositoryRealpath,
          },
        });
        result = written.result;
        stateEpochAfter = await withMutationContext(commandTransaction, () => attachEvidenceToLesson({
          foundation: operationFoundation,
          stateRoot: operationStateRoot,
          result,
          timestamp: startedAt.toISOString(),
        }));
        await validateResult(result, repoRoot);
      }
      await recordJournal({ parsed, result, journal: draft.journal, signal: timeout.signal });
      if (commandTransaction) {
        if (stateEpochAfter === null) {
          stateEpochAfter = (await loadStateContext({
            stateRoot: operationStateRoot,
            repoRoot: operationFoundation.repositoryRealpath,
          })).state?.epoch ?? null;
        }
        await commitTransaction(commandTransaction, {
          stateEpochAfter,
          signal: timeout.signal,
          timestamp: startedAt.toISOString(),
        });
      }
    } finally {
      await commandLock?.release();
      commandLock = null;
    }
  } catch (error) {
    if (error instanceof CliUsageError) {
      if (parsed.flags.json) stdout.write(`${canonicalJson(usageErrorDocument(error.message))}\n`);
      else stderr.write(`${error.message}\n`);
      return EXIT_CODES.USAGE;
    }
    const reasonCode = normalizeErrorReason(error);
    result = createRunnerResult({
      runId,
      courseId: 'auth-authz',
      scope: parsed.scope,
      lessonId: parsed.lessonId,
      command: parsed.action,
      status: 'blocked',
      diagnostics: [{
        id: 'runner.command',
        status: 'fail',
        actual: reasonCode,
        expected: 'pass',
        message: errorDiagnosticMessage(error, reasonCode),
      }],
      reasonCode,
      recovery: await errorRecovery(reasonCode, { parsed, repoRoot }),
      durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
    });
    await validateResult(result, repoRoot).catch(() => {});
  } finally {
    timeout.cleanup();
    signals.cleanup();
  }

  stdout.write(formatRunnerResult(result, { json: parsed.flags.json }));
  if (signals.receivedSignal) return exitCodeForSignal(signals.receivedSignal);
  return exitCodeForResult(result);
}
