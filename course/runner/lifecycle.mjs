import { constants as fsConstants } from 'node:fs';
import { access, lstat, readFile, realpath, statfs } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from './canonical.mjs';
import { loadAndValidateCourseLock } from './course-lock.mjs';
import { acquireCourseCoordinationLease, acquireLock, acquirePurgeGuard } from './lock.mjs';
import { appendJournal } from './journal.mjs';
import { loadAndValidateManifest } from './manifest.mjs';
import { stopManagedProcesses } from './managed-lifecycle.mjs';
import { stopManagedComposeProjects } from './managed-compose.mjs';
import { assertValidSchema, loadJsonSchema } from './schema.mjs';
import {
  assertStateMatchesManifest,
  clearCourseLessonWorkspaces,
  createStateRoot,
  loadStateContext,
  loadStateMarkerContext,
  purgeEmptyStateRoot,
  purgeOwnedState,
  resumeOwnedStatePurge,
  StateSchemaError,
  writeStateAtomically,
} from './state.mjs';
import { inspectSupport, inspectWslRepositoryPlacement } from './support.mjs';
import {
  beginMutation,
  commitTransaction,
  readTransactions,
  withMutationContext,
} from './transaction.mjs';

export const DEFAULT_STATE_ROOT = '.lab';

function recovery(...commands) {
  return commands;
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readSupportMatrix(repoRoot) {
  const path = resolve(repoRoot, 'curriculum/support-matrix.json');
  let matrix;
  try {
    matrix = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error('curriculum/support-matrix.jsonを読み取れません', { cause: error });
  }
  if (matrix?.courseId !== 'auth-authz' || !Array.isArray(matrix.profiles)) {
    throw new Error('curriculum/support-matrix.jsonの形式が不正です');
  }
  const schema = await loadJsonSchema(resolve(repoRoot, 'curriculum/schemas/support-matrix.schema.json'));
  assertValidSchema(matrix, schema, 'support matrix');
  return matrix;
}

function validateSupportRelationships(matrix, manifest) {
  const profileIds = new Set();
  for (const profile of matrix.profiles) {
    if (profileIds.has(profile.id)) throw new Error(`support matrix profile idが重複しています: ${profile.id}`);
    profileIds.add(profile.id);
  }
  const lessonIds = new Set();
  const manifestLessons = new Map(manifest.lessons.map((lesson) => [lesson.id, lesson]));
  for (const lesson of matrix.lessons) {
    if (lessonIds.has(lesson.id)) throw new Error(`support matrix lesson idが重複しています: ${lesson.id}`);
    lessonIds.add(lesson.id);
    const manifestLesson = manifestLessons.get(lesson.id);
    if (!manifestLesson) throw new Error(`support matrixが未知のlessonを参照しています: ${lesson.id}`);
    if (lesson.status !== manifestLesson.status) {
      throw new Error(`support matrixとmanifestのlesson statusが一致しません: ${lesson.id}`);
    }
    if (lesson.status === 'planned' && lesson.profileIds.length !== 0) {
      throw new Error(`planned lessonへsupport profileを割り当てることはできません: ${lesson.id}`);
    }
    if (lesson.status !== 'planned' && lesson.profileIds.length === 0) {
      throw new Error(`実装済みlessonにはsupport profileが必要です: ${lesson.id}`);
    }
    for (const profileId of lesson.profileIds) {
      if (!profileIds.has(profileId)) throw new Error(`support matrixが未知のprofileを参照しています: ${profileId}`);
    }
  }
  for (const lessonId of manifestLessons.keys()) {
    if (!lessonIds.has(lessonId)) throw new Error(`support matrixにlessonがありません: ${lessonId}`);
  }
}

export async function loadCourseFoundation({ repoRoot } = {}) {
  const [repositoryRealpath, manifestResult, lockResult, supportMatrix] = await Promise.all([
    realpath(repoRoot),
    loadAndValidateManifest({ repoRoot }),
    loadAndValidateCourseLock({ repoRoot }),
    readSupportMatrix(repoRoot),
  ]);
  if (manifestResult.manifest.courseId !== lockResult.lock.courseId
      || supportMatrix.courseId !== lockResult.lock.courseId) {
    throw new Error('manifest、course lock、support matrixのcourseIdが一致しません');
  }
  validateSupportRelationships(supportMatrix, manifestResult.manifest);
  return {
    repositoryRealpath,
    ...manifestResult,
    courseLock: lockResult.lock,
    courseLockDigest: lockResult.lockDigest,
    courseContract: lockResult.contract,
    supportMatrix,
  };
}

function identity(foundation) {
  return {
    courseId: foundation.manifest.courseId,
    sourceRevision: foundation.courseLock.sourceRevision,
    sourceDigest: foundation.sourceDigest,
  };
}

function initialState(context, manifest, now) {
  return {
    $schema: 'curriculum/schemas/state.schema.json',
    schemaVersion: 1,
    courseId: context.marker.courseId,
    installId: context.marker.installId,
    markerDigest: context.markerDigest,
    epoch: 1,
    lifecycle: 'stopped',
    lessons: manifest.lessons.map(({ id }) => ({
      id,
      lifecycle: 'not-started',
      lastRunId: null,
      evidenceIds: [],
    })),
    resources: manifest.resources.map((resource) => ({
      id: resource.id,
      status: resource.type === 'directory' && resource.locator === DEFAULT_STATE_ROOT ? 'present' : 'absent',
      ownershipDigest: resource.type === 'directory' && resource.locator === DEFAULT_STATE_ROOT
        ? context.markerDigest
        : null,
    })),
    updatedAt: now,
  };
}

function resetState(state, manifest, now) {
  const resources = new Map(manifest.resources.map((resource) => [resource.id, resource]));
  return {
    ...state,
    lifecycle: 'stopped',
    lessons: state.lessons.map((lesson) => ({
      ...lesson,
      lifecycle: 'not-started',
      lastRunId: null,
    })),
    resources: state.resources.map((resource) => ({
      ...resource,
      ...(resources.get(resource.id)?.resetPolicy === 'preserve'
        ? {}
        : { status: 'absent', ownershipDigest: null }),
    })),
    updatedAt: now,
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error('operation aborted');
}

async function withCourseLock({
  stateRoot,
  foundation,
  mode,
  runId,
  strictIdentity = true,
  transactionCommand = null,
  operationJournal = null,
  signal,
  timestamp,
}, callback) {
  throwIfAborted(signal);
  const lockOptions = {
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    courseId: foundation.manifest.courseId,
    ...(strictIdentity ? identity(foundation) : {}),
    mode,
    runId,
  };
  let held;
  let transaction = null;
  if (transactionCommand) {
    const mutation = await beginMutation({
      ...lockOptions,
      operationId: `course:${transactionCommand}`,
      command: transactionCommand,
      signal,
      timestamp,
    });
    held = mutation.lock;
    transaction = mutation.transaction;
  } else {
    held = await acquireLock(lockOptions);
  }
  try {
    throwIfAborted(signal);
    const result = transaction
      ? await withMutationContext(transaction, callback)
      : await callback();
    throwIfAborted(signal);
    if (operationJournal) {
      const operation = operationJournal(result);
      await appendJournal({
        stateRoot,
        repoRoot: foundation.repositoryRealpath,
        courseId: foundation.manifest.courseId,
        ...(strictIdentity ? {
          sourceRevision: foundation.courseLock.sourceRevision,
          sourceDigest: foundation.sourceDigest,
        } : {}),
        signal,
        entry: {
          runId,
          courseId: foundation.manifest.courseId,
          lessonId: operation.lessonId ?? null,
          command: operation.command,
          lockMode: mode,
          resourceIds: operation.resourceIds,
          status: operation.status,
          evidenceId: operation.evidenceId ?? null,
          timestamp,
        },
      });
      throwIfAborted(signal);
    }
    if (transaction) {
      let stateEpochAfter = null;
      try {
        stateEpochAfter = (await loadStateContext({
          stateRoot,
          repoRoot: foundation.repositoryRealpath,
        })).state?.epoch ?? null;
      } catch (error) {
        if (transactionCommand !== 'stop') throw error;
      }
      await commitTransaction(transaction, { stateEpochAfter, signal, timestamp });
    }
    return result;
  } finally {
    await held.release();
  }
}

async function requireSupported(foundation, environment) {
  return inspectSupport({ matrix: foundation.supportMatrix, environment });
}

async function inspectLocalPrerequisites(foundation) {
  const diagnostics = [];
  let reasonCode = null;
  const packageJson = JSON.parse(await readFile(resolve(foundation.repositoryRealpath, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await readFile(resolve(foundation.repositoryRealpath, 'package-lock.json'), 'utf8'));
  const rootLock = packageLock.packages?.[''];
  const lockMatches = rootLock
    && canonicalJson(rootLock.dependencies ?? {}) === canonicalJson(packageJson.dependencies ?? {})
    && canonicalJson(rootLock.devDependencies ?? {}) === canonicalJson(packageJson.devDependencies ?? {})
    && rootLock.engines?.node === packageJson.engines?.node;
  diagnostics.push({
    id: 'dependencies.lock',
    status: lockMatches ? 'pass' : 'fail',
    actual: lockMatches ? 'synchronized' : 'drifted',
    expected: 'package.jsonとpackage-lock.jsonが一致',
    message: lockMatches ? '依存関係のlockは一致しています' : 'npm ciの前にlock差分を解消してください',
  });
  if (!lockMatches) reasonCode ??= 'PREREQUISITE_PACKAGE_LOCK';

  const dependencyNames = [...Object.keys(packageJson.dependencies ?? {}), ...Object.keys(packageJson.devDependencies ?? {})];
  let installLock = null;
  try {
    installLock = JSON.parse(await readFile(resolve(foundation.repositoryRealpath, 'node_modules/.package-lock.json'), 'utf8'));
  } catch {
    installLock = null;
  }
  const installProblems = [];
  for (const name of dependencyNames) {
    try {
      const installedPackage = JSON.parse(await readFile(
        resolve(foundation.repositoryRealpath, 'node_modules', name, 'package.json'),
        'utf8',
      ));
      const packagePath = `node_modules/${name}`;
      const expected = packageLock.packages?.[packagePath];
      const installed = installLock?.packages?.[packagePath];
      if (!expected?.version
          || installedPackage.version !== expected.version
          || installed?.version !== expected.version
          || installed?.integrity !== expected.integrity) {
        installProblems.push(`${name}:lock-drift`);
      }
    } catch {
      installProblems.push(`${name}:missing`);
    }
  }
  diagnostics.push({
    id: 'dependencies.install',
    status: installProblems.length === 0 ? 'pass' : 'fail',
    actual: installProblems.length === 0 ? 'lock-verified' : installProblems.join(','),
    expected: 'package-lock.jsonと一致するnpm ci結果',
    message: installProblems.length === 0
      ? 'direct依存のversionとinstall lockはpackage-lock.jsonに一致しています'
      : 'Node.js 24でnpm ciを実行してください',
  });
  if (installProblems.length > 0) reasonCode ??= 'PREREQUISITE_DEPENDENCIES';

  let writable = true;
  try {
    await access(foundation.repositoryRealpath, fsConstants.W_OK);
  } catch {
    writable = false;
  }
  diagnostics.push({
    id: 'filesystem.write',
    status: writable ? 'pass' : 'fail',
    actual: writable ? 'writable' : 'read-only',
    expected: 'repository rootへ書込可能',
    message: writable ? '教材stateを作成できます' : 'repositoryの所有者と権限を確認してください',
  });
  if (!writable) reasonCode ??= 'PREREQUISITE_WRITE_PERMISSION';

  const filesystem = await statfs(foundation.repositoryRealpath);
  const freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  const minimumBytes = 256 * 1024 * 1024;
  diagnostics.push({
    id: 'filesystem.free-space',
    status: freeBytes >= minimumBytes ? 'pass' : 'fail',
    actual: `${Math.floor(freeBytes / (1024 * 1024))} MiB`,
    expected: '256 MiB以上',
    message: freeBytes >= minimumBytes ? '基礎lesson用の空き容量があります' : '空き容量を確保してください',
  });
  if (freeBytes < minimumBytes) reasonCode ??= 'PREREQUISITE_DISK_SPACE';
  return { diagnostics, reasonCode, supported: reasonCode === null };
}

async function inspectDoctor(foundation, environment) {
  const [support, local] = await Promise.all([
    requireSupported(foundation, environment),
    inspectLocalPrerequisites(foundation),
  ]);
  const placement = inspectWslRepositoryPlacement({
    environment: support.detected,
    repositoryRealpath: foundation.repositoryRealpath,
  });
  return {
    ...support,
    diagnostics: [...support.diagnostics, ...local.diagnostics, ...(placement ? [placement.diagnostic] : [])],
    reasonCode: support.reasonCode ?? local.reasonCode ?? placement?.reasonCode ?? null,
    supported: support.supported && local.supported && (placement?.supported ?? true),
  };
}

function blockedSupport(support) {
  const recoveryByReason = {
    PREREQUISITE_NODE_VERSION: 'Node.js 24で node course.mjs doctor を再実行してください',
    PREREQUISITE_PACKAGE_LOCK: 'package.jsonとpackage-lock.jsonを同じ教材revisionへ戻してください',
    PREREQUISITE_DEPENDENCIES: 'Node.js 24で npm ci を実行してください',
    PREREQUISITE_WRITE_PERMISSION: 'repositoryの所有者と書込権限を確認してください',
    PREREQUISITE_DISK_SPACE: '256 MiB以上の空き容量を確保してください',
    UNSUPPORTED_WINDOWS_PROCESS_CONTROL: 'WSL2のLinux filesystemへcloneし、Node.js 24で再実行してください',
    UNSUPPORTED_WSL_WINDOWS_FILESYSTEM: 'repositoryを/mnt/c等からWSL2のhome配下へcloneし直してください',
    UNSUPPORTED_SUPPORT_PROFILE: 'curriculum/support-matrix.jsonでcandidate環境を確認してください',
  };
  return {
    status: 'blocked',
    checkIds: ['AA-SETUP-C1'],
    diagnostics: support.diagnostics,
    reasonCode: support.reasonCode,
    recovery: recovery(recoveryByReason[support.reasonCode] ?? 'curriculum/support-matrix.jsonを確認してください'),
    journal: null,
  };
}

export async function runCourseLifecycle({
  action,
  repoRoot,
  runId,
  now = new Date().toISOString(),
  environment,
  signal,
} = {}) {
  throwIfAborted(signal);
  const repositoryRealpath = await realpath(repoRoot);
  const recoveryStateRoot = resolve(repositoryRealpath, DEFAULT_STATE_ROOT);
  if (action === 'purge') {
    const preliminaryLease = await acquireCourseCoordinationLease({
      repoRoot: repositoryRealpath,
      courseId: 'auth-authz',
    });
    let stateRootPresent;
    let purged;
    try {
      const resumed = await resumeOwnedStatePurge({
        stateRoot: recoveryStateRoot,
        repoRoot: repositoryRealpath,
        courseId: 'auth-authz',
      });
      stateRootPresent = await exists(recoveryStateRoot);
      purged = resumed.purged || (stateRootPresent && (await purgeEmptyStateRoot({
        stateRoot: recoveryStateRoot,
        repoRoot: repositoryRealpath,
      })).purged);
    } finally {
      await preliminaryLease.release();
    }
    if (!stateRootPresent && !purged) {
      return {
        status: 'safe-noop',
        checkIds: ['AA-SETUP-C3'],
        diagnostics: [
          {
            id: 'state.root',
            status: 'pass',
            actual: 'absent',
            expected: 'absent',
            message: '削除対象の教材状態はありません',
          },
          {
            id: 'resources.remaining',
            status: 'pass',
            actual: '0',
            expected: '0',
            message: '教材所有resourceは残っていません',
          },
        ],
        reasonCode: 'STATE_NOT_PRESENT',
        recovery: [],
        journal: null,
      };
    }
    let guard;
    try {
      if (!purged) {
        guard = await acquirePurgeGuard({
          stateRoot: recoveryStateRoot,
          repoRoot: repositoryRealpath,
          courseId: 'auth-authz',
          runId,
        });
        const markerContext = await loadStateMarkerContext({
          stateRoot: recoveryStateRoot,
          repoRoot: repositoryRealpath,
          courseId: 'auth-authz',
        });
        throwIfAborted(signal);
        await stopManagedProcesses({
          stateRoot: recoveryStateRoot,
          repoRoot: repositoryRealpath,
          signal,
        });
        throwIfAborted(signal);
        await stopManagedComposeProjects({
          stateRoot: recoveryStateRoot,
          repoRoot: repositoryRealpath,
          signal,
          remove: true,
        });
        throwIfAborted(signal);
        await purgeOwnedState({
          stateRoot: recoveryStateRoot,
          repoRoot: repositoryRealpath,
          courseId: 'auth-authz',
          installId: markerContext.marker.installId,
        });
        purged = true;
      }
    } finally {
      if (guard) await guard.release();
    }
    return {
      status: 'pass',
      checkIds: ['AA-SETUP-C3'],
      diagnostics: [
        {
          id: 'state.root',
          status: 'pass',
          actual: 'absent',
          expected: 'absent',
          message: '教材が所有していた状態だけを削除しました',
        },
        {
          id: 'resources.remaining',
          status: 'pass',
          actual: '0',
          expected: '0',
          message: '教材所有resourceの残存が0件であることを確認しました',
        },
      ],
      reasonCode: null,
      recovery: [],
      journal: null,
    };
  }
  const foundation = await loadCourseFoundation({ repoRoot });
  const stateRoot = resolve(foundation.repositoryRealpath, DEFAULT_STATE_ROOT);
  const hasStateRoot = await exists(stateRoot);

  if (action === 'doctor') {
    const support = await inspectDoctor(foundation, environment);
    if (!support.supported) return blockedSupport(support);
    return {
      status: 'pass',
      checkIds: ['AA-SETUP-C1'],
      diagnostics: support.diagnostics,
      reasonCode: null,
      recovery: [],
      journal: null,
    };
  }

  if (action === 'setup') {
    const support = await inspectDoctor(foundation, environment);
    if (!support.supported) return blockedSupport(support);
    const bootstrapLease = await acquireCourseCoordinationLease({
      repoRoot: foundation.repositoryRealpath,
      courseId: foundation.manifest.courseId,
      waitForReleaseMs: 1_000,
    });
    let context;
    try {
      context = await createStateRoot({
        repoRoot: foundation.repositoryRealpath,
        stateRoot,
        ...identity(foundation),
      });
    } finally {
      await bootstrapLease.release();
    }
    const initialized = await withCourseLock({
      stateRoot,
      foundation,
      mode: 'write',
      runId,
      transactionCommand: 'setup',
      operationJournal: (wasInitialized) => ({
        command: 'setup',
        status: wasInitialized ? 'pass' : 'safe-noop',
        resourceIds: ['directory:lab-state'],
      }),
      signal,
      timestamp: now,
    }, async () => {
      const current = await loadStateContext({
        stateRoot,
        repoRoot: foundation.repositoryRealpath,
        ...identity(foundation),
      });
      if (current.state) {
        assertStateMatchesManifest(current.state, foundation.manifest);
        return false;
      }
      await writeStateAtomically({
        stateRoot,
        repoRoot: foundation.repositoryRealpath,
        ...identity(foundation),
        state: initialState(context, foundation.manifest, now),
      });
      return true;
    });
    return {
      status: initialized ? 'pass' : 'safe-noop',
      checkIds: ['AA-SETUP-C2'],
      diagnostics: support.diagnostics,
      reasonCode: initialized ? null : 'STATE_ALREADY_INITIALIZED',
      recovery: [],
      journal: null,
    };
  }

  if (!hasStateRoot) {
    const safeNoop = ['stop', 'purge'].includes(action);
    return {
      status: safeNoop ? 'safe-noop' : 'blocked',
      checkIds: action === 'reset' ? ['AA-SETUP-C3'] : [],
      diagnostics: [{
        id: 'state.root',
        status: safeNoop ? 'pass' : 'fail',
        actual: 'absent',
        expected: safeNoop ? 'absent' : 'initialized',
        message: safeNoop ? '削除対象の教材状態はありません' : '先に教材をsetupしてください',
      }],
      reasonCode: safeNoop ? 'STATE_NOT_PRESENT' : 'PREREQUISITE_SETUP',
      recovery: safeNoop ? [] : recovery('node course.mjs setup を実行してください'),
      journal: null,
    };
  }

  if (action === 'diagnose') {
    return withCourseLock({
      stateRoot,
      foundation,
      mode: 'read',
      runId,
      strictIdentity: false,
      operationJournal: (result) => ({
        command: 'diagnose',
        status: result.status,
        resourceIds: [],
      }),
      signal,
      timestamp: now,
    }, async () => {
      const markerContext = await loadStateMarkerContext({
        stateRoot,
        repoRoot: foundation.repositoryRealpath,
        courseId: foundation.manifest.courseId,
      });
      const transactions = await readTransactions({ stateRoot, repoRoot: foundation.repositoryRealpath });
      const pendingTransaction = transactions.find(({ phase }) => ['begun', 'prepared'].includes(phase));
      let stateSchemaDrift = false;
      let stateMissing = false;
      let stateDriftReasonCode = null;
      try {
        const current = await loadStateContext({
          stateRoot,
          repoRoot: foundation.repositoryRealpath,
          courseId: foundation.manifest.courseId,
        });
        if (current.state) assertStateMatchesManifest(current.state, foundation.manifest);
        else stateMissing = true;
      } catch (error) {
        if (!(error instanceof StateSchemaError)) throw error;
        stateSchemaDrift = true;
        stateDriftReasonCode = error.reasonCode;
      }
      const sourceDrift = markerContext.marker.sourceRevision !== foundation.courseLock.sourceRevision
        || markerContext.marker.sourceDigest !== foundation.sourceDigest;
      const drifted = sourceDrift || stateSchemaDrift || stateMissing || Boolean(pendingTransaction);
      return {
        status: drifted ? 'blocked' : 'pass',
        checkIds: [],
        diagnostics: [{
          id: 'state.source',
          status: drifted ? 'fail' : 'pass',
          actual: pendingTransaction
            ? `incomplete:${pendingTransaction.runId}`
            : stateMissing
            ? 'state-missing'
            : stateSchemaDrift
            ? (stateDriftReasonCode === 'STATE_MANIFEST_DRIFT' ? 'state-manifest-drift' : 'state-schema-drift')
            : `${markerContext.marker.sourceRevision ?? 'unreleased'}:${markerContext.marker.sourceDigest}`,
          expected: `${foundation.courseLock.sourceRevision ?? 'unreleased'}:${foundation.sourceDigest}`,
          message: pendingTransaction
            ? `${pendingTransaction.command}がcommit前に中断されています`
            : stateMissing
            ? 'markerはありますがstate.jsonの初期化が完了していません'
            : stateSchemaDrift
            ? (stateDriftReasonCode === 'STATE_MANIFEST_DRIFT'
              ? 'state.jsonのlessonまたはresourceがmanifestと一致しません'
              : 'state.jsonは現在のschemaと一致しません')
            : sourceDrift
              ? 'setup時と現在の教材sourceが異なります'
              : '教材sourceと実行状態は一致しています',
        }],
        reasonCode: pendingTransaction
          ? 'STATE_INCOMPLETE_TRANSACTION'
          : stateMissing
            ? 'STATE_INCOMPLETE_SETUP'
          : stateSchemaDrift
            ? stateDriftReasonCode
            : (sourceDrift ? 'STATE_SOURCE_DRIFT' : null),
        recovery: drifted
          ? recovery(stateMissing && !pendingTransaction
            ? 'node course.mjs setupを再実行してください'
            : '以前のsourceへ戻すか、node course.mjs purge --yes の後にsetupし直してください')
          : [],
        journal: null,
      };
    });
  }

  if (action === 'stop') {
    const stopOutcome = await withCourseLock({
      stateRoot,
      foundation,
      mode: 'write',
      runId,
      strictIdentity: false,
      transactionCommand: 'stop',
      operationJournal: (outcome) => ({
        command: 'stop',
        status: outcome.changed ? 'pass' : 'safe-noop',
        resourceIds: [...outcome.managedProcesses, ...outcome.managedCompose]
          .map(({ resourceId }) => resourceId),
      }),
      signal,
      timestamp: now,
    }, async () => {
      const managedProcesses = await stopManagedProcesses({
        stateRoot,
        repoRoot: foundation.repositoryRealpath,
        signal,
      });
      const managedCompose = await stopManagedComposeProjects({
        stateRoot,
        repoRoot: foundation.repositoryRealpath,
        signal,
        remove: false,
      });
      let stateChanged = false;
      let schemaDrift = false;
      try {
        const context = await loadStateContext({
          stateRoot,
          repoRoot: foundation.repositoryRealpath,
          courseId: foundation.manifest.courseId,
        });
        if (context.state) {
          assertStateMatchesManifest(context.state, foundation.manifest);
          const managedById = new Map(
            [...managedProcesses, ...managedCompose].map((outcome) => [outcome.resourceId, outcome]),
          );
          const resources = context.state.resources.map((resource) => {
            const outcome = managedById.get(resource.id);
            if (!outcome) return resource;
            const absent = ['PROCESS_NOT_RECORDED', 'CONTAINER_NOT_RECORDED', 'CONTAINER_NOT_FOUND']
              .includes(outcome.reasonCode);
            return {
              ...resource,
              status: absent ? 'absent' : 'stopped',
              ownershipDigest: absent ? null : context.markerDigest,
            };
          });
          if (context.state.lifecycle !== 'stopped'
              || canonicalJson(resources) !== canonicalJson(context.state.resources)) {
            await writeStateAtomically({
              stateRoot,
              repoRoot: foundation.repositoryRealpath,
              state: { ...context.state, lifecycle: 'stopped', resources, updatedAt: now },
            });
            stateChanged = true;
          }
        }
      } catch (error) {
        if (error instanceof StateSchemaError) schemaDrift = true;
        else throw error;
      }
      const processChanged = managedProcesses.some(({ status }) => status === 'stopped');
      const containerChanged = managedCompose.some(({ status }) => status === 'stopped');
      return {
        changed: processChanged || containerChanged || stateChanged,
        schemaDrift,
        managedProcesses,
        managedCompose,
      };
    });
    return {
      status: stopOutcome.changed ? 'pass' : 'safe-noop',
      checkIds: [],
      diagnostics: stopOutcome.schemaDrift ? [{
        id: 'state.schema',
        status: 'warn',
        actual: 'drifted',
        expected: 'current',
        message: '実行中processがない基盤段階のため、state.jsonを再利用せず停止扱いにしました',
      }] : [],
      reasonCode: stopOutcome.schemaDrift
        ? 'STATE_SCHEMA_DRIFT'
        : (stopOutcome.changed ? null : 'PROCESS_NOT_RUNNING'),
      recovery: [],
      journal: null,
    };
  }

  if (action === 'reset') {
    const support = await requireSupported(foundation, environment);
    if (!support.supported) return blockedSupport(support);
    await withCourseLock({
      stateRoot,
      foundation,
      mode: 'write',
      runId,
      transactionCommand: 'reset',
      operationJournal: (managedProcesses) => ({
        command: 'reset',
        status: 'pass',
        resourceIds: [...new Set([
          ...foundation.manifest.resources.map(({ id }) => id),
          ...managedProcesses.map(({ resourceId }) => resourceId),
        ])],
      }),
      signal,
      timestamp: now,
    }, async () => {
      const context = await loadStateContext({ stateRoot, repoRoot: foundation.repositoryRealpath, ...identity(foundation) });
      if (!context.state) throw new Error('state.jsonがありません');
      assertStateMatchesManifest(context.state, foundation.manifest);
      const managedProcesses = await stopManagedProcesses({
        stateRoot,
        repoRoot: foundation.repositoryRealpath,
        signal,
      });
      const managedCompose = await stopManagedComposeProjects({
        stateRoot,
        repoRoot: foundation.repositoryRealpath,
        signal,
        remove: true,
      });
      await clearCourseLessonWorkspaces({ stateRoot, repoRoot: foundation.repositoryRealpath });
      await writeStateAtomically({
        stateRoot,
        repoRoot: foundation.repositoryRealpath,
        ...identity(foundation),
        state: resetState(context.state, foundation.manifest, now),
        incrementEpoch: true,
      });
      return [...managedProcesses, ...managedCompose];
    });
    return {
      status: 'pass',
      checkIds: ['AA-SETUP-C3'],
      diagnostics: support.diagnostics,
      reasonCode: null,
      recovery: [],
      journal: null,
    };
  }

  throw new TypeError(`unsupported course lifecycle action: ${action}`);
}
