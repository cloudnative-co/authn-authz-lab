import {
  readManagedProcess,
  recoverManagedProcess,
  stopManagedProcess,
} from './managed-process.mjs';
import {
  listManagedProcessResourceIds,
  loadManagedCleanupContext,
} from './managed-process-state.mjs';

const RECOVERABLE_REASONS = new Set([
  'PROCESS_ATOMIC_RECOVERY_REQUIRED',
  'PROCESS_RECOVERY_REQUIRED',
  'PROCESS_SECRET_RETIREMENT_REQUIRED',
  'PROCESS_STALE_GENERATION',
  'PROCESS_OPERATION_LOCKED',
  'PROCESS_OPERATION_STALE_RECOVERY_REQUIRED',
]);

export class ManagedLifecycleError extends Error {
  constructor(reasonCode, message, { cause, resourceId } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ManagedLifecycleError';
    this.reasonCode = reasonCode;
    this.resourceId = resourceId;
  }
}

export function managedProcessResourceIds(manifest) {
  if (!manifest || !Array.isArray(manifest.resources)) throw new TypeError('manifest resources are required');
  return manifest.resources.filter(({ type }) => type === 'process').map(({ id }) => id);
}

function recoverable(value) {
  return RECOVERABLE_REASONS.has(value?.reasonCode);
}

async function readOrRecover({
  stateRoot,
  repoRoot,
  resourceId,
  allowedResourceIds,
  signal,
}) {
  let current;
  try {
    current = await readManagedProcess({ stateRoot, repoRoot, resourceId, allowedResourceIds });
  } catch (error) {
    if (!recoverable(error)) throw error;
    current = { status: 'blocked', resourceId, reasonCode: error.reasonCode };
  }
  if (!recoverable(current)) return { current, recovered: null };
  const recovered = await recoverManagedProcess({
    stateRoot,
    repoRoot,
    resourceId,
    allowedResourceIds,
    signal,
  });
  if (recovered.status === 'blocked') return { current: recovered, recovered };
  return {
    current: await readManagedProcess({ stateRoot, repoRoot, resourceId, allowedResourceIds }),
    recovered,
  };
}

export async function stopManagedProcesses({
  stateRoot,
  repoRoot,
  signal,
} = {}) {
  const context = await loadManagedCleanupContext({ stateRoot, repoRoot });
  const allowedResourceIds = await listManagedProcessResourceIds(context);
  if (allowedResourceIds.length === 0) return [];
  const outcomes = [];
  for (const resourceId of allowedResourceIds) {
    const inspected = await readOrRecover({
      stateRoot,
      repoRoot,
      resourceId,
      allowedResourceIds,
      signal,
    });
    if (inspected.current.status === 'blocked') {
      throw new ManagedLifecycleError(
        inspected.current.reasonCode ?? 'PROCESS_STOP_BLOCKED',
        `managed process ${resourceId} could not be recovered safely`,
        { resourceId },
      );
    }
    if (inspected.recovered) {
      outcomes.push({ resourceId, ...inspected.recovered });
      continue;
    }
    if (inspected.current.status !== 'running') {
      outcomes.push({
        status: 'safe-noop',
        resourceId,
        reasonCode: inspected.current.status === 'absent'
          ? 'PROCESS_NOT_RECORDED'
          : 'PROCESS_ALREADY_STOPPED',
      });
      continue;
    }
    const stopped = await stopManagedProcess({
      stateRoot,
      repoRoot,
      resourceId,
      allowedResourceIds,
      signal,
    });
    if (!['stopped', 'safe-noop'].includes(stopped.status)) {
      throw new ManagedLifecycleError(
        stopped.reasonCode ?? 'PROCESS_STOP_BLOCKED',
        `managed process ${resourceId} could not be stopped safely`,
        { resourceId },
      );
    }
    outcomes.push(stopped);
  }
  const verifiedResourceIds = await listManagedProcessResourceIds(context);
  if (verifiedResourceIds.join('\0') !== allowedResourceIds.join('\0')) {
    throw new ManagedLifecycleError(
      'PROCESS_STORAGE_CHANGED',
      'managed process resources changed during cleanup',
    );
  }
  for (const resourceId of verifiedResourceIds) {
    const current = await readManagedProcess({
      stateRoot,
      repoRoot,
      resourceId,
      allowedResourceIds: verifiedResourceIds,
    });
    if (!['absent', 'stopped'].includes(current.status)) {
      throw new ManagedLifecycleError(
        current.reasonCode ?? 'PROCESS_STOP_UNVERIFIED',
        `managed process ${resourceId} was not verified stopped`,
        { resourceId },
      );
    }
  }
  return outcomes;
}
