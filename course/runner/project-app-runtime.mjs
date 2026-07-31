import { resolve } from 'node:path';
import { DEFAULT_STATE_ROOT } from './lifecycle.mjs';
import { lesson06ProjectAppEnvironment } from '../lessons/06/container.mjs';
import {
  readManagedProcess,
  recoverManagedProcess,
  startManagedNode,
  stopManagedProcess,
} from './managed-process.mjs';
import { probeTcpPort } from './port.mjs';
import {
  captureProcessStartFingerprint,
  detectProcessPlatform,
  verifyHealthIdentity,
} from './process.mjs';
import { assertStateMatchesManifest, loadStateContext, writeStateAtomically } from './state.mjs';

export const PROJECT_APP_RESOURCE_ID = 'project-app';
export const PROJECT_APP_PORT_ID = 'project-app-http';

const RECOVERABLE_PROCESS_REASONS = new Set([
  'PROCESS_ATOMIC_RECOVERY_REQUIRED',
  'PROCESS_RECOVERY_REQUIRED',
  'PROCESS_OPERATION_LOCKED',
  'PROCESS_OPERATION_STALE_RECOVERY_REQUIRED',
  'PROCESS_SECRET_RETIREMENT_REQUIRED',
  'PROCESS_STALE_GENERATION',
]);

function identity(foundation, runtimeNodeMajor) {
  return {
    courseId: foundation.manifest.courseId,
    sourceRevision: foundation.courseLock.sourceRevision,
    sourceDigest: foundation.sourceDigest,
    ...(runtimeNodeMajor !== undefined ? { nodeMajor: runtimeNodeMajor } : {}),
  };
}

function allowedProcessIds(foundation) {
  const ids = foundation.manifest.resources
    .filter(({ type }) => type === 'process')
    .map(({ id }) => id);
  if (!ids.includes(PROJECT_APP_RESOURCE_ID)) {
    throw new Error(`manifestに${PROJECT_APP_RESOURCE_ID} processがありません`);
  }
  return ids;
}

export function projectAppOrigin(foundation) {
  const port = foundation.indexes.ports.get(PROJECT_APP_PORT_ID);
  if (!port
      || port.resourceId !== PROJECT_APP_RESOURCE_ID
      || port.protocol !== 'http'
      || port.host !== '127.0.0.1') {
    throw new Error(`manifestの${PROJECT_APP_PORT_ID}定義が不正です`);
  }
  return `http://${port.host}:${port.port}`;
}

export function projectAppJournal({ foundation, stateRoot, lockMode, resourceIds }) {
  return {
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    courseId: foundation.manifest.courseId,
    sourceRevision: foundation.courseLock.sourceRevision,
    sourceDigest: foundation.sourceDigest,
    lockMode,
    resourceIds,
  };
}

export async function loadProjectAppLessonState({ foundation, stateRoot }) {
  const context = await loadStateContext({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    ...identity(foundation),
  });
  if (!context.state) {
    const error = new Error('course setupが完了していません');
    error.reasonCode = 'PREREQUISITE_SETUP';
    throw error;
  }
  assertStateMatchesManifest(context.state, foundation.manifest);
  return context;
}

export async function updateProjectAppLessonState({
  foundation,
  stateRoot,
  lessonId,
  runId,
  timestamp,
  lessonLifecycle,
  processStatus,
  workspaceResourceId = null,
  workspaceStatus = null,
  additionalResourceStatuses = {},
  incrementEpoch = false,
  manageProjectApp = true,
  runtimeNodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10),
}) {
  if (typeof manageProjectApp !== 'boolean') throw new TypeError('manageProjectApp must be boolean');
  if (manageProjectApp && !['absent', 'stopped', 'running', 'unknown'].includes(processStatus)) {
    throw new TypeError('processStatus is invalid');
  }
  const context = await loadStateContext({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    ...identity(foundation, runtimeNodeMajor),
  });
  if (!context.state) {
    const error = new Error('course setupが完了していません');
    error.reasonCode = 'PREREQUISITE_SETUP';
    throw error;
  }
  assertStateMatchesManifest(context.state, foundation.manifest);
  const resources = context.state.resources.map((resource) => {
    if (manageProjectApp && resource.id === PROJECT_APP_RESOURCE_ID) {
      return {
        ...resource,
        status: processStatus,
        ownershipDigest: processStatus === 'absent' ? null : context.markerDigest,
      };
    }
    if (resource.id === workspaceResourceId && workspaceStatus !== null) {
      return {
        ...resource,
        status: workspaceStatus,
        ownershipDigest: workspaceStatus === 'absent' ? null : context.markerDigest,
      };
    }
    if (Object.hasOwn(additionalResourceStatuses, resource.id)) {
      const status = additionalResourceStatuses[resource.id];
      if (!['absent', 'present', 'stopped', 'running', 'unknown'].includes(status)) {
        throw new TypeError(`invalid resource status for ${resource.id}`);
      }
      return {
        ...resource,
        status,
        ownershipDigest: status === 'absent' ? null : context.markerDigest,
      };
    }
    return resource;
  });
  const sharedStopped = manageProjectApp && ['absent', 'stopped'].includes(processStatus);
  const dependentLessons = new Set(foundation.manifest.lessons
    .filter(({ resourceIds }) => resourceIds.includes(PROJECT_APP_RESOURCE_ID))
    .map(({ id }) => id));
  const lessons = context.state.lessons.map((lesson) => {
    if (lesson.id === lessonId) {
      return { ...lesson, lifecycle: lessonLifecycle, lastRunId: runId };
    }
    if (sharedStopped && dependentLessons.has(lesson.id) && lesson.lifecycle !== 'not-started') {
      return { ...lesson, lifecycle: 'stopped' };
    }
    return lesson;
  });
  const state = {
    ...context.state,
    lifecycle: resources.some(({ status }) => status === 'running') ? 'running' : 'stopped',
    lessons,
    resources,
    updatedAt: timestamp,
  };
  return writeStateAtomically({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    ...identity(foundation, runtimeNodeMajor),
    state,
    incrementEpoch,
  });
}

export async function inspectProjectAppProcess({ foundation, stateRoot }) {
  return readManagedProcess({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    resourceId: PROJECT_APP_RESOURCE_ID,
    allowedResourceIds: allowedProcessIds(foundation),
  });
}

export async function verifyProjectAppProcess(process, { signal } = {}) {
  if (process.status !== 'running') {
    return {
      healthy: false,
      gone: process.status === 'absent',
      reasonCode: process.reasonCode ?? 'PROCESS_NOT_RUNNING',
    };
  }
  const platformSupport = detectProcessPlatform();
  let fingerprint;
  try {
    fingerprint = await captureProcessStartFingerprint(process.record.pid, {
      instanceId: process.record.instanceId,
      platformSupport,
    });
  } catch (error) {
    return {
      healthy: false,
      gone: false,
      reasonCode: error.reasonCode ?? 'PROCESS_FINGERPRINT_UNVERIFIABLE',
    };
  }
  if (fingerprint === null) return { healthy: false, gone: true, reasonCode: 'PROCESS_NOT_RUNNING' };
  if (fingerprint !== process.record.startFingerprint) {
    return { healthy: false, gone: false, reasonCode: 'PROCESS_FINGERPRINT_MISMATCH' };
  }
  try {
    await verifyHealthIdentity({ record: process.record, signal });
    return { healthy: true, gone: false, reasonCode: null };
  } catch (error) {
    return { healthy: false, gone: false, reasonCode: error.reasonCode ?? 'HEALTH_UNVERIFIED' };
  }
}

export async function inspectProjectAppReadiness({ foundation, stateRoot, signal }) {
  const process = await inspectProjectAppProcess({ foundation, stateRoot });
  if (process.status === 'blocked') return { process, ready: false, reasonCode: process.reasonCode };
  if (process.status === 'running') {
    const liveness = await verifyProjectAppProcess(process, { signal });
    return {
      process,
      ready: liveness.healthy,
      reasonCode: liveness.reasonCode,
      portStatus: liveness.healthy ? 'owned-running' : 'owned-unhealthy',
    };
  }
  const port = foundation.indexes.ports.get(PROJECT_APP_PORT_ID);
  const probed = await probeTcpPort({ host: port.host, port: port.port, signal });
  return {
    process,
    ready: probed.available,
    reasonCode: probed.available ? null : 'PREREQUISITE_PORT_IN_USE',
    portStatus: probed.available ? 'available' : 'occupied-unowned',
  };
}

export function projectAppNeedsRecovery(value) {
  return RECOVERABLE_PROCESS_REASONS.has(value?.reasonCode);
}

async function recoverIfNeeded({ foundation, stateRoot, signal }) {
  let current;
  try {
    current = await inspectProjectAppProcess({ foundation, stateRoot });
  } catch (error) {
    if (!projectAppNeedsRecovery(error)) throw error;
    current = { status: 'blocked', reasonCode: error.reasonCode };
  }
  if (!projectAppNeedsRecovery(current)) return { recovered: false, current };
  const recovered = await recoverManagedProcess({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    resourceId: PROJECT_APP_RESOURCE_ID,
    allowedResourceIds: allowedProcessIds(foundation),
    signal,
  });
  if (recovered.status === 'blocked') return { recovered: true, current: recovered };
  return { recovered: true, current: await inspectProjectAppProcess({ foundation, stateRoot }) };
}

async function startProjectApp({ foundation, stateRoot, runId, signal }) {
  return startManagedNode({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    resourceId: PROJECT_APP_RESOURCE_ID,
    allowedResourceIds: allowedProcessIds(foundation),
    startOptions: {
      scriptPath: resolve(foundation.repositoryRealpath, 'apps/project-app/main.mjs'),
      cwd: foundation.repositoryRealpath,
      env: lesson06ProjectAppEnvironment(foundation, stateRoot),
      origin: projectAppOrigin(foundation),
      runId,
      stdoutPath: resolve(stateRoot, 'logs', `${PROJECT_APP_RESOURCE_ID}-${runId}.stdout.log`),
      stderrPath: resolve(stateRoot, 'logs', `${PROJECT_APP_RESOURCE_ID}-${runId}.stderr.log`),
      signal,
    },
  });
}

export async function stopProjectApp({ foundation, stateRoot, signal }) {
  const recovered = await recoverIfNeeded({ foundation, stateRoot, signal });
  if (recovered.current.status === 'blocked') return recovered.current;
  if (recovered.recovered || recovered.current.status === 'absent') {
    return {
      status: 'safe-noop',
      resourceId: PROJECT_APP_RESOURCE_ID,
      reasonCode: recovered.recovered ? 'PROCESS_RECOVERED_AND_STOPPED' : 'PROCESS_NOT_RECORDED',
    };
  }
  return stopManagedProcess({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    resourceId: PROJECT_APP_RESOURCE_ID,
    allowedResourceIds: allowedProcessIds(foundation),
    signal,
  });
}

export async function ensureProjectApp({ foundation, stateRoot, runId, signal }) {
  const recovery = await recoverIfNeeded({ foundation, stateRoot, signal });
  if (recovery.current.status === 'blocked') return { blocked: recovery.current };
  if (recovery.current.status === 'running') {
    const liveness = await verifyProjectAppProcess(recovery.current, { signal });
    if (liveness.healthy) {
      return { process: recovery.current, started: false, recovered: recovery.recovered };
    }
    if (!liveness.gone) {
      return {
        blocked: { status: 'blocked', resourceId: PROJECT_APP_RESOURCE_ID, reasonCode: liveness.reasonCode },
      };
    }
    const reconciled = await stopManagedProcess({
      stateRoot,
      repoRoot: foundation.repositoryRealpath,
      resourceId: PROJECT_APP_RESOURCE_ID,
      allowedResourceIds: allowedProcessIds(foundation),
      signal,
    });
    if (!['stopped', 'safe-noop'].includes(reconciled.status)) return { blocked: reconciled };
  }
  const process = await startProjectApp({ foundation, stateRoot, runId, signal });
  if (process.status !== 'started') return { blocked: process };
  return { process, started: true, recovered: recovery.recovered };
}

export async function restartProjectApp({ foundation, stateRoot, runId, signal }) {
  const stopped = await stopProjectApp({ foundation, stateRoot, signal });
  if (stopped.status === 'blocked') return { blocked: stopped };
  const started = await startProjectApp({ foundation, stateRoot, runId, signal });
  return started.status === 'started' ? { process: started } : { blocked: started };
}

export function projectAppStateRoot(foundation) {
  return resolve(foundation.repositoryRealpath, DEFAULT_STATE_ROOT);
}
