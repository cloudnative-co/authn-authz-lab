import {
  assertResourceId,
  inspectManagedProcessResource,
  loadManagedCleanupContext,
  publicRecord,
} from './managed-process-state.mjs';

export async function readManagedProcess({
  stateRoot,
  repoRoot,
  resourceId,
  allowedResourceIds,
} = {}) {
  assertResourceId(resourceId, allowedResourceIds);
  const context = await loadManagedCleanupContext({ stateRoot, repoRoot });
  const snapshot = await inspectManagedProcessResource({ context, resourceId });
  if (!snapshot.current) return { status: 'absent', resourceId };
  if (!snapshot.current.record) {
    if (snapshot.current.intent.status === 'aborted' && snapshot.current.control.status === 'active') {
      return { status: 'blocked', resourceId, reasonCode: 'PROCESS_SECRET_RETIREMENT_REQUIRED' };
    }
    return snapshot.current.intent.status === 'aborted'
      ? { status: 'stopped', resourceId, reasonCode: 'PROCESS_LAUNCH_ABORTED' }
      : { status: 'blocked', resourceId, reasonCode: 'PROCESS_RECOVERY_REQUIRED' };
  }
  if (snapshot.current.record.status === 'stopped' && snapshot.current.control.status === 'active') {
    return { status: 'blocked', resourceId, reasonCode: 'PROCESS_SECRET_RETIREMENT_REQUIRED' };
  }
  return {
    status: snapshot.current.record.status,
    resourceId,
    record: publicRecord(snapshot.current.record),
  };
}
