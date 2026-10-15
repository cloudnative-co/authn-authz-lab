import { randomBytes, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectProcessPlatform,
  startOwnedNode,
  stopOwnedProcess,
  waitForOwnedProcessExit,
} from './process.mjs';
import {
  acquireManagedProcessOperation,
  acquireRecoveredManagedProcessOperation,
  releaseManagedProcessOperation,
} from './managed-process-operation.mjs';
import { assertValidSchema } from './schema.mjs';
import { retryManagedStartupStop } from './managed-startup-recovery.mjs';
import { ensureStateDirectory, writeJsonAtomically } from './state.mjs';
import {
  abortedIntent,
  assertControlSemantics,
  assertGenerationIdentity,
  assertIntentSemantics,
  assertManagedPrivateDirectory as assertPrivateDirectory,
  assertRecordSemantics,
  assertResourceId,
  assertTimestamp,
  cleanupInterruptedPrelaunch,
  cleanupUncommittedGeneration,
  ensureManagedProcessStorage as ensureStorage,
  GENERATION_DIRECTORY,
  generationIsCurrent,
  inspectManagedProcessResource as inspectResource,
  listManagedProcessResourceIds,
  loadManagedCleanupContext as loadCleanupContext,
  loadManagedContext as loadContext,
  loadManagedProcessSchemas as loadSchemas,
  MANAGED_PROCESS_LAUNCH_SCHEMA,
  MANAGED_PROCESS_POINTER_SCHEMA,
  MANAGED_PROCESS_SCHEMA,
  ManagedProcessError,
  managedProcessPaths as storagePaths,
  persistAbortedLaunch,
  PROCESS_CONTROL_SECRET_SCHEMA,
  PROCESS_DIRECTORY,
  publicRecord,
  repairManagedProcessAtomicWrites,
  retiredControl,
  retireStoppedSecrets,
  stoppedRecord,
} from './managed-process-state.mjs';

export {
  MANAGED_PROCESS_LAUNCH_SCHEMA,
  MANAGED_PROCESS_POINTER_SCHEMA,
  MANAGED_PROCESS_SCHEMA,
  ManagedProcessError,
  PROCESS_CONTROL_SECRET_SCHEMA,
};
export { readManagedProcess } from './managed-process-inspect.mjs';
export { requestManagedProcessControl } from './managed-process-control.mjs';

const MANAGED_NODE_BOOTSTRAP = fileURLToPath(new URL('./managed-node-bootstrap.mjs', import.meta.url));
const MANAGED_LAUNCH_PROTOCOL = 'current-record-gated-v1';
function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function pathInside(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}


async function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolvePromise) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
    };
    const onExit = () => {
      cleanup();
      resolvePromise(true);
    };
    timer = setTimeout(() => {
      cleanup();
      resolvePromise(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

async function rollbackChildHandle(child) {
  if (!child || typeof child.kill !== 'function') {
    return { status: 'blocked', reasonCode: 'PROCESS_ROLLBACK_CHILD_UNAVAILABLE' };
  }
  if (await waitForChildExit(child, 1)) return { status: 'stopped', method: 'child-already-exited' };
  child.kill('SIGTERM');
  if (await waitForChildExit(child, 1_000)) return { status: 'stopped', method: 'child-handle-sigterm' };
  child.kill('SIGKILL');
  if (await waitForChildExit(child, 1_000)) return { status: 'stopped', method: 'child-handle-sigkill' };
  return { status: 'blocked', reasonCode: 'PROCESS_ROLLBACK_TIMEOUT' };
}

async function rollbackStartedProcess({ started, stopImplementation, startOptions }) {
  let authenticated;
  try {
    authenticated = await stopImplementation({
      record: started.record,
      shutdownToken: started.shutdownToken,
      healthPath: startOptions.healthPath,
      shutdownPath: startOptions.shutdownPath,
      timeoutMs: startOptions.stopTimeoutMs ?? 3_000,
      signal: startOptions.signal,
      platformSupport: startOptions.platformSupport,
    });
  } catch (error) {
    authenticated = { status: 'blocked', reasonCode: error.reasonCode ?? 'PROCESS_ROLLBACK_SHUTDOWN_FAILED' };
  }
  if (['stopped', 'safe-noop'].includes(authenticated?.status)) {
    return {
      status: 'stopped',
      method: authenticated.status === 'stopped' ? 'authenticated-shutdown' : 'already-gone',
      reasonCode: authenticated.reasonCode ?? null,
    };
  }
  const childCleanup = await rollbackChildHandle(started.child);
  return childCleanup.status === 'stopped'
    ? { status: 'stopped', method: 'rollback-child-handle', reasonCode: authenticated?.reasonCode ?? null }
    : childCleanup;
}


function assertStartPaths(context, startOptions) {
  for (const [name, value] of [['stdoutPath', startOptions.stdoutPath], ['stderrPath', startOptions.stderrPath]]) {
    if (typeof value !== 'string' || !pathInside(context.stateRoot, resolve(value))) {
      throw new ManagedProcessError('PROCESS_LOG_PATH_OUTSIDE_STATE', `${name} must be below stateRoot`);
    }
  }
}

function assertOwnedLogPaths(context, startOptions, resourceId, runId) {
  const expected = {
    stdoutPath: resolve(context.stateRoot, 'logs', `${resourceId}-${runId}.stdout.log`),
    stderrPath: resolve(context.stateRoot, 'logs', `${resourceId}-${runId}.stderr.log`),
  };
  for (const [name, path] of Object.entries(expected)) {
    if (resolve(startOptions[name]) !== path) {
      throw new ManagedProcessError(
        'PROCESS_LOG_PATH_NOT_OWNED',
        `${name} must use the managed resource and run identity`,
      );
    }
  }
}

export async function startManagedNode({
  stateRoot,
  repoRoot,
  resourceId,
  allowedResourceIds,
  startOptions,
  now = () => new Date().toISOString(),
  dependencies = {},
} = {}) {
  assertResourceId(resourceId, allowedResourceIds);
  if (!startOptions || typeof startOptions !== 'object' || Array.isArray(startOptions)) {
    throw new TypeError('startOptions is required');
  }
  const context = await loadContext({ stateRoot, repoRoot });
  assertStartPaths(context, startOptions);
  if (hasOwn(startOptions, 'installId') && startOptions.installId !== context.marker.installId) {
    throw new ManagedProcessError('PROCESS_INSTALL_ID_MISMATCH', 'startOptions.installId does not match owned state');
  }
  const startImplementation = dependencies.startOwnedNode ?? startOwnedNode;
  const stopImplementation = dependencies.stopOwnedProcess ?? stopOwnedProcess;
  const writeImplementation = dependencies.writeJsonAtomically ?? writeJsonAtomically;
  if (hasOwn(startOptions, 'shutdownToken')) {
    throw new TypeError('startOptions.shutdownToken is managed internally');
  }
  const platformSupport = startOptions.platformSupport ?? detectProcessPlatform();
  await ensureStorage(context, resourceId);
  const operation = await acquireManagedProcessOperation({
    context,
    resourceId,
    command: 'start',
    now,
    platformSupport,
  });
  try {
    let snapshot = await inspectResource({ context, resourceId, allowOperation: true });
    if (snapshot.current?.record?.status === 'running') {
      throw new ManagedProcessError('PROCESS_ALREADY_RUNNING', 'managed process is already marked running');
    }
    if (snapshot.current && !snapshot.current.record && snapshot.current.intent.status === 'pending') {
      throw new ManagedProcessError('PROCESS_RECOVERY_REQUIRED', 'an interrupted launch requires explicit recovery');
    }
    const preflightTime = assertTimestamp(now(), 'now');
    await retireStoppedSecrets({ snapshot, context, writeImplementation, timestamp: preflightTime });
    snapshot = await inspectResource({ context, resourceId, allowOperation: true });

    const {
      installId: ignoredInstallId,
      runId: requestedRunId,
      scriptPath: requestedScriptPath,
      args: requestedArguments = [],
      gateTimeoutMs: requestedGateTimeout,
      shutdownPath: ignoredShutdownPath,
      stopTimeoutMs: ignoredStopTimeout,
      ...ownedOptions
    } = startOptions;
    void ignoredInstallId;
    void ignoredShutdownPath;
    void ignoredStopTimeout;
    if (typeof requestedScriptPath !== 'string' || requestedScriptPath.length === 0) {
      throw new TypeError('startOptions.scriptPath is required');
    }
    if (!Array.isArray(requestedArguments) || requestedArguments.some((value) => typeof value !== 'string')) {
      throw new TypeError('startOptions.args must be an array of strings');
    }
    const targetScriptPath = await realpath(resolve(startOptions.cwd, requestedScriptPath));
    if (!pathInside(context.repositoryRealpath, targetScriptPath)) {
      throw new ManagedProcessError('PROCESS_TARGET_OUTSIDE_REPOSITORY', 'managed target must stay inside the repository');
    }
    const gateTimeoutMs = requestedGateTimeout ?? Math.min(5_000, Math.max(1_000, startOptions.timeoutMs ?? 5_000));
    if (!Number.isSafeInteger(gateTimeoutMs) || gateTimeoutMs < 1_000 || gateTimeoutMs > 5_000) {
      throw new TypeError('startOptions.gateTimeoutMs must be an integer from 1000 to 5000');
    }
    const runId = requestedRunId ?? randomUUID();
    if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(runId)) {
      throw new TypeError('runId must contain 3-128 URL-safe characters');
    }
    assertOwnedLogPaths(context, startOptions, resourceId, runId);
    const generationId = `gen-${randomBytes(16).toString('hex')}`;
    const paths = storagePaths(context, resourceId, generationId);
    const timestamp = assertTimestamp(now(), 'now');
    const origin = new URL(startOptions.origin).origin;
    const shutdownToken = randomBytes(32).toString('base64url');
    const intent = {
      $schema: MANAGED_PROCESS_LAUNCH_SCHEMA,
      schemaVersion: 2,
      resourceId,
      generationId,
      status: 'pending',
      launchProtocol: MANAGED_LAUNCH_PROTOCOL,
      gateTimeoutMs,
      installId: context.marker.installId,
      runId,
      instanceId: `${context.marker.installId}.${runId}`,
      origin,
      createdAt: timestamp,
      abortedAt: null,
      abortReasonCode: null,
    };
    const control = {
      $schema: PROCESS_CONTROL_SECRET_SCHEMA,
      schemaVersion: 1,
      resourceId,
      generationId,
      instanceId: intent.instanceId,
      status: 'active',
      shutdownToken,
      createdAt: timestamp,
      retiredAt: null,
    };
    const pointer = {
      $schema: MANAGED_PROCESS_POINTER_SCHEMA,
      schemaVersion: 1,
      resourceId,
      generationId,
      activatedAt: timestamp,
    };
    const schemas = snapshot.schemas ?? await loadSchemas(context);
    assertValidSchema(intent, schemas.intent, 'managed process launch intent');
    assertValidSchema(control, schemas.control, 'process control secret');
    assertValidSchema(pointer, schemas.pointer, 'managed process pointer');
    assertIntentSemantics(intent);
    assertControlSemantics(control);
    assertGenerationIdentity(intent, null, control, resourceId, generationId, context.marker.installId);
    try {
      await ensureStateDirectory(context, PROCESS_DIRECTORY, resourceId, GENERATION_DIRECTORY, generationId);
      await assertPrivateDirectory({ context, path: paths.generation, label: 'managed process generation' });
      await writeImplementation({
        anchor: context.stateRoot,
        path: paths.control,
        value: control,
        exclusive: true,
        label: 'process control secret',
      });
      await writeImplementation({
        anchor: context.stateRoot,
        path: paths.intent,
        value: intent,
        exclusive: true,
        label: 'managed process launch intent',
      });
    } catch (error) {
      const active = await generationIsCurrent(context, resourceId, generationId);
      const reconciliation = active === true
        ? await persistAbortedLaunch({
          context, paths, intent, control, reasonCode: 'PROCESS_LAUNCH_PERSIST_FAILED',
        })
        : active === false
          ? await cleanupUncommittedGeneration({ context, resourceId, generationId })
          : { status: 'blocked', reasonCode: 'PROCESS_ROLLBACK_STATE_UNVERIFIABLE' };
      throw new ManagedProcessError('PROCESS_LAUNCH_PERSIST_FAILED', 'launch intent could not be committed before spawn', {
        cause: error,
        cleanup: { reconciliation },
      });
    }
    let started;
    let record = null;
    let persistenceError = null;
    try {
      started = await startImplementation({
        ...ownedOptions,
        scriptPath: MANAGED_NODE_BOOTSTRAP,
        args: [targetScriptPath, ...requestedArguments],
        env: {
          ...ownedOptions.env,
          COURSE_MANAGED_REPOSITORY_ROOT: context.repositoryRealpath,
          COURSE_MANAGED_STATE_ROOT: context.stateRoot,
          COURSE_MANAGED_RESOURCE_ID: resourceId,
          COURSE_MANAGED_GENERATION_ID: generationId,
          COURSE_MANAGED_GATE_TIMEOUT_MS: String(gateTimeoutMs),
        },
        installId: context.marker.installId,
        runId,
        shutdownToken,
        onOwnedSpawn: async ({ record: spawnedRecord }) => {
          try {
            const startedAt = assertTimestamp(now(), 'now');
            record = {
              $schema: MANAGED_PROCESS_SCHEMA,
              schemaVersion: 1,
              resourceId,
              generationId,
              status: 'running',
              ...spawnedRecord,
              startedAt,
              updatedAt: startedAt,
              stoppedAt: null,
              stopMethod: null,
              stopReasonCode: null,
            };
            assertValidSchema(record, schemas.record, 'managed process record');
            assertRecordSemantics(record);
            assertGenerationIdentity(intent, record, control, resourceId, generationId, context.marker.installId);
            // The bootstrap cannot import the target until both writes are durable.
            // The current pointer is therefore the activation commit and must be last.
            await writeImplementation({
              anchor: context.stateRoot,
              path: paths.record,
              value: record,
              exclusive: true,
              label: 'managed process record',
            });
            await writeImplementation({
              anchor: context.stateRoot,
              path: storagePaths(context, resourceId).current,
              value: pointer,
              label: 'managed process pointer',
            });
            await dependencies.afterPointerCommit?.({ context, paths, intent, record, control, pointer });
          } catch (error) {
            persistenceError = error;
            throw error;
          }
        },
      });
    } catch (error) {
      const knownStopped = !hasOwn(error, 'cleanup') || error.cleanup?.status === 'exited';
      const reconciliation = knownStopped
        ? await persistAbortedLaunch({
          context,
          paths,
          intent,
          control,
          record,
          rollback: error.cleanup,
          reasonCode: persistenceError ? 'PROCESS_START_PERSIST_ROLLBACK' : 'PROCESS_START_FAILED',
        })
        : { status: 'retained', reasonCode: 'PROCESS_RECOVERY_REQUIRED' };
      throw new ManagedProcessError(
        persistenceError ? 'PROCESS_START_PERSIST_FAILED' : 'PROCESS_START_FAILED',
        persistenceError
          ? 'process ownership could not be durably activated'
          : 'owned process start failed after launch intent commit',
        {
          cause: error,
          cleanup: { rollback: error.cleanup ?? null, reconciliation },
        },
      );
    }
    if (started?.status !== 'started') {
      await persistAbortedLaunch({ context, paths, intent, control, reasonCode: 'PROCESS_START_UNSUPPORTED' });
      return started;
    }
    const validResult = started.record
      && started.child
      && record
      && started.shutdownToken === shutdownToken
      && started.record.instanceId === intent.instanceId
      && started.record.origin === intent.origin
      && started.record.pid === record.pid
      && started.record.startFingerprint === record.startFingerprint;
    if (!validResult) {
      const rollback = await rollbackStartedProcess({ started, stopImplementation, startOptions });
      const reconciliation = rollback.status === 'stopped'
        ? await persistAbortedLaunch({
          context, paths, intent, control, record, reasonCode: 'PROCESS_START_INVALID_RESULT', rollback,
        })
        : { status: 'retained', reasonCode: rollback.reasonCode ?? 'PROCESS_RECOVERY_REQUIRED' };
      throw new ManagedProcessError('PROCESS_START_INVALID_RESULT', 'owned process start returned an invalid identity', {
        cleanup: { rollback, reconciliation },
      });
    }
    // The ownership record is durable now. Keeping the ChildProcess handle
    // referenced would make the one-shot course CLI wait for the managed app
    // to exit, even though the app is intentionally meant to outlive setup.
    started.child.unref?.();
    return { status: 'started', resourceId, record: publicRecord(record) };
  } finally {
    await releaseManagedProcessOperation(operation);
  }
}

async function reconcileStaleGenerations({
  snapshot,
  context,
  healthPath,
  shutdownPath,
  timeoutMs,
  signal,
  platformSupport,
  now,
  writeImplementation,
  stopImplementation,
}) {
  for (const generation of snapshot.history) {
    if (generation === snapshot.current) continue;
    const needsRecovery = generation.record?.status === 'running'
      || (!generation.record && generation.intent.status === 'pending');
    if (!needsRecovery) continue;
    if (generation.intent.launchProtocol !== MANAGED_LAUNCH_PROTOCOL) {
      return { status: 'blocked', reasonCode: 'PROCESS_RECOVERY_PROTOCOL_UNSUPPORTED' };
    }
    let intent = generation.intent;
    const activationWasPending = intent.status === 'pending';
    const timestamp = assertTimestamp(now(), 'now');
    if (intent.status === 'pending') {
      intent = abortedIntent(intent, timestamp, 'PROCESS_STALE_GENERATION');
      assertValidSchema(intent, snapshot.schemas.intent, 'aborted managed process launch intent');
      assertIntentSemantics(intent);
      await writeImplementation({
        anchor: context.stateRoot,
        path: generation.paths.intent,
        value: intent,
        label: 'aborted managed process launch intent',
      });
    }

    let record = generation.record;
    if (record?.status === 'running') {
      let stopped = null;
      if (generation.control.status === 'active') {
        try {
          stopped = await stopImplementation({
            record: {
              pid: record.pid,
              instanceId: record.instanceId,
              origin: record.origin,
              startFingerprint: record.startFingerprint,
            },
            shutdownToken: generation.control.shutdownToken,
            healthPath,
            shutdownPath,
            timeoutMs,
            signal,
            platformSupport,
          });
        } catch (error) {
          stopped = { status: 'blocked', reasonCode: error.reasonCode ?? 'PROCESS_RECOVERY_SHUTDOWN_FAILED' };
        }
      }
      let method;
      let reasonCode = stopped?.reasonCode ?? null;
      if (['stopped', 'safe-noop'].includes(stopped?.status)) {
        method = activationWasPending
          ? 'activation-aborted'
          : (stopped.status === 'stopped' ? 'authenticated-shutdown' : 'already-gone');
      } else {
        const exited = await waitForOwnedProcessExit({
          record,
          timeoutMs: Math.max(timeoutMs, generation.intent.gateTimeoutMs + 250),
          signal,
          platformSupport,
        });
        if (exited.status !== 'exited') {
          return {
            status: 'blocked',
            reasonCode: exited.reasonCode ?? stopped?.reasonCode ?? 'PROCESS_RECOVERY_BLOCKED',
          };
        }
        method = 'activation-aborted';
        reasonCode = exited.reasonCode ?? reasonCode;
      }
      record = stoppedRecord(record, assertTimestamp(now(), 'now'), { method, reasonCode });
      assertValidSchema(record, snapshot.schemas.record, 'recovered managed process record');
      assertRecordSemantics(record);
      await writeImplementation({
        anchor: context.stateRoot,
        path: generation.paths.record,
        value: record,
        label: 'recovered managed process record',
      });
    }
    if (generation.control.status === 'active') {
      await writeImplementation({
        anchor: context.stateRoot,
        path: generation.paths.control,
        value: retiredControl(generation.control, assertTimestamp(now(), 'now')),
        label: 'retired process control secret',
      });
    }
  }
  return { status: 'reconciled' };
}

async function stopCurrentManagedGeneration({
  snapshot,
  context,
  resourceId,
  healthPath,
  shutdownPath,
  timeoutMs,
  signal,
  platformSupport,
  now,
  writeImplementation,
  stopImplementation,
}) {
  if (!snapshot.current) {
    return { status: 'safe-noop', resourceId, reasonCode: 'PROCESS_NOT_RECORDED' };
  }
  const { record, control, paths, intent } = snapshot.current;
  if (!record) {
    if (intent.status !== 'aborted') {
      return { status: 'blocked', resourceId, reasonCode: 'PROCESS_RECOVERY_REQUIRED' };
    }
    if (control.status === 'active') {
      await writeImplementation({
        anchor: context.stateRoot,
        path: paths.control,
        value: retiredControl(control, assertTimestamp(now(), 'now')),
        label: 'retired process control secret',
      });
    }
    return { status: 'safe-noop', resourceId, reasonCode: 'PROCESS_LAUNCH_ABORTED' };
  }
  if (record.status === 'stopped') {
    if (control.status === 'active') {
      await writeImplementation({
        anchor: context.stateRoot,
        path: paths.control,
        value: retiredControl(control, assertTimestamp(now(), 'now')),
        label: 'process control secret',
      });
    }
    return {
      status: 'safe-noop',
      resourceId,
      reasonCode: 'PROCESS_ALREADY_STOPPED',
      record: publicRecord(record),
    };
  }
  if (control.status !== 'active' || typeof control.shutdownToken !== 'string') {
    throw new ManagedProcessError('PROCESS_STATE_INCONSISTENT', 'running process has no usable control secret');
  }
  const stopped = await stopImplementation({
    record: {
      pid: record.pid,
      instanceId: record.instanceId,
      origin: record.origin,
      startFingerprint: record.startFingerprint,
    },
    shutdownToken: control.shutdownToken,
    healthPath,
    shutdownPath,
    timeoutMs,
    signal,
    platformSupport,
  });
  if (!['stopped', 'safe-noop'].includes(stopped?.status)) {
    return {
      status: stopped?.status ?? 'blocked',
      resourceId,
      reasonCode: stopped?.reasonCode ?? 'PROCESS_STOP_BLOCKED',
    };
  }
  const timestamp = assertTimestamp(now(), 'now');
  const nextRecord = stoppedRecord(record, timestamp, {
    method: stopped.status === 'stopped' ? 'authenticated-shutdown' : 'already-gone',
    reasonCode: stopped.reasonCode ?? null,
  });
  try {
    await writeImplementation({
      anchor: context.stateRoot,
      path: paths.record,
      value: nextRecord,
      label: 'managed process record',
    });
    await writeImplementation({
      anchor: context.stateRoot,
      path: paths.control,
      value: retiredControl(control, timestamp),
      label: 'process control secret',
    });
  } catch (error) {
    throw new ManagedProcessError('PROCESS_STOP_PERSIST_FAILED', 'stopped process state could not be fully persisted', {
      cause: error,
    });
  }
  return { status: 'stopped', resourceId, method: nextRecord.stopMethod, record: publicRecord(nextRecord) };
}


export async function recoverManagedProcess({
  stateRoot,
  repoRoot,
  resourceId,
  allowedResourceIds,
  healthPath = '/__course/health',
  shutdownPath = '/__course/shutdown',
  timeoutMs = 3_000,
  signal,
  platformSupport,
  now = () => new Date().toISOString(),
  dependencies = {},
} = {}) {
  assertResourceId(resourceId, allowedResourceIds);
  const context = await loadCleanupContext({ stateRoot, repoRoot });
  const support = platformSupport ?? detectProcessPlatform();
  if (!(await listManagedProcessResourceIds(context)).includes(resourceId)) {
    return { status: 'safe-noop', resourceId, reasonCode: 'PROCESS_NOT_RECORDED' };
  }
  const operation = await acquireRecoveredManagedProcessOperation({
    context,
    resourceId,
    createStorage: false,
    now,
    platformSupport: support,
  });
  try {
    const writeImplementation = dependencies.writeJsonAtomically ?? writeJsonAtomically;
    const stopImplementation = dependencies.stopOwnedProcess ?? stopOwnedProcess;
    await repairManagedProcessAtomicWrites({ context, resourceId });
    await cleanupInterruptedPrelaunch(context, resourceId);
    let snapshot = await inspectResource({
      context,
      resourceId,
      allowOperation: true,
      allowStaleGenerations: true,
    });
    const reconciled = await reconcileStaleGenerations({
      snapshot,
      context,
      healthPath,
      shutdownPath,
      timeoutMs,
      signal,
      platformSupport: support,
      now,
      writeImplementation,
      stopImplementation,
    });
    if (reconciled.status === 'blocked') return { ...reconciled, resourceId };
    snapshot = await inspectResource({ context, resourceId, allowOperation: true });
    await retireStoppedSecrets({
      snapshot,
      context,
      writeImplementation,
      timestamp: assertTimestamp(now(), 'now'),
    });
    snapshot = await inspectResource({ context, resourceId, allowOperation: true });
    if (!snapshot.current) return { status: 'safe-noop', resourceId, reasonCode: 'PROCESS_NOT_RECORDED' };
    const current = snapshot.current;
    if (!current.record && current.intent.status === 'aborted') {
      if (current.control.status === 'active') {
        await writeImplementation({
          anchor: context.stateRoot,
          path: current.paths.control,
          value: retiredControl(current.control, assertTimestamp(now(), 'now')),
          label: 'retired process control secret',
        });
      }
      return { status: 'safe-noop', resourceId, reasonCode: 'PROCESS_LAUNCH_ABORTED' };
    }
    if (!current.record) {
      const timestamp = assertTimestamp(now(), 'now');
      const nextIntent = abortedIntent(current.intent, timestamp, 'PROCESS_ACTIVATION_INCOMPLETE');
      assertValidSchema(nextIntent, snapshot.schemas.intent, 'aborted managed process launch intent');
      assertIntentSemantics(nextIntent);
      await writeImplementation({
        anchor: context.stateRoot,
        path: current.paths.intent,
        value: nextIntent,
        label: 'aborted managed process launch intent',
      });
      if (current.control.status === 'active') {
        await writeImplementation({
          anchor: context.stateRoot,
          path: current.paths.control,
          value: retiredControl(current.control, assertTimestamp(now(), 'now')),
          label: 'retired process control secret',
        });
      }
      return { status: 'safe-noop', resourceId, reasonCode: 'PROCESS_ACTIVATION_ABORTED' };
    }
    // Pointer commit releases the bootstrap, but its HTTP listener may not exist yet.
    return await retryManagedStartupStop({ timeoutMs, signal, stop: (remaining) => stopCurrentManagedGeneration({
      snapshot,
      context,
      resourceId,
      healthPath,
      shutdownPath,
      timeoutMs: remaining,
      signal,
      platformSupport: support,
      now,
      writeImplementation,
      stopImplementation,
    }) });
  } finally {
    await releaseManagedProcessOperation(operation);
  }
}

export async function stopManagedProcess({
  stateRoot,
  repoRoot,
  resourceId,
  allowedResourceIds,
  healthPath = '/__course/health',
  shutdownPath = '/__course/shutdown',
  timeoutMs = 3_000,
  signal,
  platformSupport,
  now = () => new Date().toISOString(),
  dependencies = {},
} = {}) {
  assertResourceId(resourceId, allowedResourceIds);
  const context = await loadCleanupContext({ stateRoot, repoRoot });
  const writeImplementation = dependencies.writeJsonAtomically ?? writeJsonAtomically;
  const stopImplementation = dependencies.stopOwnedProcess ?? stopOwnedProcess;
  const support = platformSupport ?? detectProcessPlatform();
  if (!(await listManagedProcessResourceIds(context)).includes(resourceId)) {
    return { status: 'safe-noop', resourceId, reasonCode: 'PROCESS_NOT_RECORDED' };
  }
  const operation = await acquireManagedProcessOperation({
    context,
    resourceId,
    command: 'stop',
    createStorage: false,
    now,
    platformSupport: support,
  });
  try {
    const snapshot = await inspectResource({ context, resourceId, allowOperation: true });
    return stopCurrentManagedGeneration({
      snapshot,
      context,
      resourceId,
      healthPath,
      shutdownPath,
      timeoutMs,
      signal,
      platformSupport: support,
      now,
      writeImplementation,
      stopImplementation,
    });
  } finally {
    await releaseManagedProcessOperation(operation);
  }
}
