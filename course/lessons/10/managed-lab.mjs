import { resolve } from 'node:path';
import {
  readManagedProcess,
  recoverManagedProcess,
  requestManagedProcessControl,
  startManagedNode,
  stopManagedProcess,
} from '../../runner/managed-process.mjs';
import { probeTcpPort } from '../../runner/port.mjs';
import {
  captureProcessStartFingerprint,
  detectProcessPlatform,
  verifyHealthIdentity,
} from '../../runner/process.mjs';

export const OAUTH_LAB_RESOURCE_ID = 'oauth-lab';
export const OAUTH_LAB_PORT_IDS = Object.freeze([
  'oauth-authorization-server-http',
  'oauth-client-http',
  'oauth-resource-api-http',
]);

const RECOVERABLE = new Set([
  'PROCESS_ATOMIC_RECOVERY_REQUIRED',
  'PROCESS_RECOVERY_REQUIRED',
  'PROCESS_OPERATION_LOCKED',
  'PROCESS_OPERATION_STALE_RECOVERY_REQUIRED',
  'PROCESS_SECRET_RETIREMENT_REQUIRED',
  'PROCESS_STALE_GENERATION',
]);

async function boundedHealthJson(response) {
  const reader = response.body?.getReader();
  const chunks = [];
  let total = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 4096) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function allowedProcessIds(foundation) {
  const ids = foundation.manifest.resources
    .filter(({ type }) => type === 'process')
    .map(({ id }) => id);
  if (!ids.includes(OAUTH_LAB_RESOURCE_ID)) throw new Error('manifest is missing the oauth-lab process');
  return ids;
}

export function oauthLabOrigins(foundation) {
  const expectedPorts = [4100, 4101, 4102];
  const origins = OAUTH_LAB_PORT_IDS.map((id, index) => {
    const port = foundation.indexes.ports.get(id);
    if (!port
        || port.resourceId !== OAUTH_LAB_RESOURCE_ID
        || port.protocol !== 'http'
        || port.host !== '127.0.0.1'
        || port.port !== expectedPorts[index]) {
      throw new Error(`manifest has an invalid ${id} definition`);
    }
    return `http://${port.host}:${port.port}`;
  });
  return Object.freeze({ authorizationServer: origins[0], client: origins[1], resourceApi: origins[2] });
}

function oauthLabHealthChecks(foundation) {
  const origins = oauthLabOrigins(foundation);
  return [
    { origin: origins.authorizationServer, path: '/__course/health', expectedStatus: 200 },
    {
      origin: origins.client,
      path: '/__course/health',
      expectedStatus: 200,
      expectedRole: 'oauth-client',
      requireManagedIdentity: true,
    },
    {
      origin: origins.resourceApi,
      path: '/__course/health',
      expectedStatus: 200,
      expectedRole: 'resource-api',
      requireManagedIdentity: true,
    },
  ];
}

function scenarioControlRequest(options, request) {
  return requestManagedProcessControl({
    stateRoot: options.stateRoot,
    repoRoot: options.foundation.repositoryRealpath,
    resourceId: OAUTH_LAB_RESOURCE_ID,
    allowedResourceIds: allowedProcessIds(options.foundation),
    checks: oauthLabHealthChecks(options.foundation),
    request,
    signal: options.signal,
  });
}

export function createOAuthLabScenarioControl(options) {
  if (!options?.foundation || typeof options.stateRoot !== 'string') {
    throw new TypeError('foundation and stateRoot are required for OAuth lab scenario control');
  }
  return Object.freeze({
    async create(profile) {
      const result = await scenarioControlRequest(options, {
        method: 'POST',
        path: '/__course/scenarios',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ profile }).toString(),
      });
      if (result.status !== 201 || typeof result.body?.scenario_id !== 'string') {
        throw new Error('OAuth lab scenario creation failed');
      }
      return result.body.scenario_id;
    },
    async evidence(scenarioId) {
      const result = await scenarioControlRequest(options, {
        method: 'GET',
        path: '/__course/scenarios',
        headers: { 'x-course-scenario-id': scenarioId },
      });
      if (result.status !== 200 || !Array.isArray(result.body?.events)) {
        throw new Error('OAuth lab scenario evidence failed');
      }
      return result.body.events;
    },
    async remove(scenarioId) {
      const result = await scenarioControlRequest(options, {
        method: 'DELETE',
        path: '/__course/scenarios',
        headers: { 'x-course-scenario-id': scenarioId },
      });
      if (![204, 404].includes(result.status)) throw new Error('OAuth lab scenario cleanup failed');
    },
  });
}

export function inspectOAuthLabProcess({ foundation, stateRoot }) {
  return readManagedProcess({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    resourceId: OAUTH_LAB_RESOURCE_ID,
    allowedResourceIds: allowedProcessIds(foundation),
  });
}

export async function verifyOAuthLabProcess(process, { foundation, signal } = {}) {
  if (process.status !== 'running') return { healthy: false, gone: process.status === 'absent' };
  const platformSupport = detectProcessPlatform();
  let fingerprint;
  try {
    fingerprint = await captureProcessStartFingerprint(process.record.pid, {
      instanceId: process.record.instanceId,
      platformSupport,
    });
  } catch (error) {
    return { healthy: false, gone: false, reasonCode: error.reasonCode ?? 'PROCESS_FINGERPRINT_UNVERIFIABLE' };
  }
  if (fingerprint === null) return { healthy: false, gone: true, reasonCode: 'PROCESS_NOT_RUNNING' };
  if (fingerprint !== process.record.startFingerprint) {
    return { healthy: false, gone: false, reasonCode: 'PROCESS_FINGERPRINT_MISMATCH' };
  }
  try {
    await verifyHealthIdentity({ record: process.record, signal });
    const origins = oauthLabOrigins(foundation);
    const [client, resource] = await Promise.all([
      fetch(`${origins.client}/__course/health`, { signal }),
      fetch(`${origins.resourceApi}/__course/health`, { signal }),
    ]);
    const [clientHealth, resourceHealth] = await Promise.all([
      boundedHealthJson(client), boundedHealthJson(resource),
    ]);
    const healthy = client.status === 200
      && resource.status === 200
      && clientHealth?.role === 'oauth-client'
      && clientHealth.pid === process.record.pid
      && clientHealth.instanceId === process.record.instanceId
      && resourceHealth?.role === 'resource-api'
      && resourceHealth.pid === process.record.pid
      && resourceHealth.instanceId === process.record.instanceId;
    return { healthy, gone: false, reasonCode: healthy ? null : 'OAUTH_LAB_ORIGIN_UNHEALTHY' };
  } catch {
    return { healthy: false, gone: false, reasonCode: 'OAUTH_LAB_ORIGIN_UNREACHABLE' };
  }
}

async function recoverIfNeeded({ foundation, stateRoot, signal }) {
  let current;
  try {
    current = await inspectOAuthLabProcess({ foundation, stateRoot });
  } catch (error) {
    if (!RECOVERABLE.has(error.reasonCode)) throw error;
    current = { status: 'blocked', reasonCode: error.reasonCode };
  }
  if (!RECOVERABLE.has(current.reasonCode)) return current;
  const recovered = await recoverManagedProcess({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    resourceId: OAUTH_LAB_RESOURCE_ID,
    allowedResourceIds: allowedProcessIds(foundation),
    signal,
  });
  return recovered.status === 'blocked'
    ? recovered
    : inspectOAuthLabProcess({ foundation, stateRoot });
}

async function portsAvailable(foundation, signal) {
  const results = await Promise.all(OAUTH_LAB_PORT_IDS.map(async (id) => {
    const port = foundation.indexes.ports.get(id);
    return { id, ...await probeTcpPort({ host: port.host, port: port.port, signal }) };
  }));
  const occupied = results.find(({ available }) => !available);
  return occupied ? { available: false, reasonCode: 'OAUTH_LAB_PORT_IN_USE', portId: occupied.id }
    : { available: true };
}

async function startOAuthLab({ foundation, stateRoot, runId, signal }) {
  const origins = oauthLabOrigins(foundation);
  return startManagedNode({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    resourceId: OAUTH_LAB_RESOURCE_ID,
    allowedResourceIds: allowedProcessIds(foundation),
    startOptions: {
      scriptPath: resolve(foundation.repositoryRealpath, 'apps/oauth-lab/main.mjs'),
      cwd: foundation.repositoryRealpath,
      origin: origins.authorizationServer,
      runId,
      stdoutPath: resolve(stateRoot, 'logs', `${OAUTH_LAB_RESOURCE_ID}-${runId}.stdout.log`),
      stderrPath: resolve(stateRoot, 'logs', `${OAUTH_LAB_RESOURCE_ID}-${runId}.stderr.log`),
      signal,
    },
  });
}

export async function ensureOAuthLab({ foundation, stateRoot, runId, signal }) {
  const current = await recoverIfNeeded({ foundation, stateRoot, signal });
  if (current.status === 'blocked') return { blocked: current };
  if (current.status === 'running') {
    const verified = await verifyOAuthLabProcess(current, { foundation, signal });
    if (verified.healthy) return { process: current, started: false };
    if (!verified.gone) return { blocked: { status: 'blocked', reasonCode: verified.reasonCode } };
    const reconciled = await stopManagedProcess({
      stateRoot,
      repoRoot: foundation.repositoryRealpath,
      resourceId: OAUTH_LAB_RESOURCE_ID,
      allowedResourceIds: allowedProcessIds(foundation),
      signal,
    });
    if (!['stopped', 'safe-noop'].includes(reconciled.status)) return { blocked: reconciled };
  }
  const preflight = await portsAvailable(foundation, signal);
  if (!preflight.available) return { blocked: { status: 'blocked', ...preflight } };
  const started = await startOAuthLab({ foundation, stateRoot, runId, signal });
  if (started.status !== 'started') return { blocked: started };
  const verified = await verifyOAuthLabProcess(
    { status: 'running', record: started.record }, { foundation, signal },
  );
  if (verified.healthy) return { process: started, started: true };
  const rollback = await stopManagedProcess({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    resourceId: OAUTH_LAB_RESOURCE_ID,
    allowedResourceIds: allowedProcessIds(foundation),
    signal,
  });
  return {
    blocked: {
      status: 'blocked',
      resourceId: OAUTH_LAB_RESOURCE_ID,
      reasonCode: verified.reasonCode ?? 'OAUTH_LAB_ORIGIN_UNHEALTHY',
      rollbackStatus: rollback.status,
    },
  };
}

export async function stopOAuthLab({ foundation, stateRoot, signal }) {
  const current = await recoverIfNeeded({ foundation, stateRoot, signal });
  if (current.status === 'blocked') return current;
  if (current.status === 'absent') {
    return { status: 'safe-noop', resourceId: OAUTH_LAB_RESOURCE_ID, reasonCode: 'PROCESS_NOT_RECORDED' };
  }
  return stopManagedProcess({
    stateRoot,
    repoRoot: foundation.repositoryRealpath,
    resourceId: OAUTH_LAB_RESOURCE_ID,
    allowedResourceIds: allowedProcessIds(foundation),
    signal,
  });
}

export async function restartOAuthLab(options) {
  const stopped = await stopOAuthLab(options);
  if (stopped.status === 'blocked') return { blocked: stopped };
  return ensureOAuthLab(options);
}

function runtimeRecovery(lessonId, reasonCode) {
  if (reasonCode === 'OAUTH_LAB_PORT_IN_USE') {
    return ['ports 4100、4101、4102を使用中のprocessを確認し、所有している場合だけ停止してください'];
  }
  return [`node course.mjs lesson ${lessonId} diagnoseを実行してください`];
}

function runtimeBlocked(lessonId, source = {}) {
  const reasonCode = source.reasonCode ?? 'PROCESS_OPERATION_BLOCKED';
  return {
    blocked: {
      status: 'blocked',
      checkIds: [],
      diagnostics: [{
        id: `lesson${lessonId}.oauth-lab`,
        status: 'fail',
        actual: reasonCode,
        expected: 'owned-and-healthy',
        message: 'OAuth labの三originを安全に制御できませんでした',
      }],
      reasonCode,
      recovery: runtimeRecovery(lessonId, reasonCode),
      journal: null,
      evidence: null,
    },
  };
}

export function createOAuthLabRuntimeHooks(lessonId) {
  if (!['10', '11', '15'].includes(lessonId)) throw new TypeError('OAuth lab lesson id must be 10, 11, or 15');

  async function inspectExternal({ foundation, stateRoot, signal, requireRunning = false } = {}) {
    let process;
    try {
      process = await inspectOAuthLabProcess({ foundation, stateRoot });
    } catch (error) {
      if (typeof error?.reasonCode !== 'string') throw error;
      const result = runtimeBlocked(lessonId, error).blocked;
      return {
        ready: false,
        reasonCode: result.reasonCode,
        resourceStatus: 'unknown',
        recovery: result.recovery,
        diagnostics: result.diagnostics,
      };
    }
    let verified = null;
    if (process.status === 'running') {
      verified = await verifyOAuthLabProcess(process, { foundation, signal });
    }
    const healthy = verified?.healthy ?? false;
    const ready = requireRunning
      ? process.status === 'running' && healthy
      : ['absent', 'stopped'].includes(process.status) || (process.status === 'running' && healthy);
    const reasonCode = ready
      ? null
      : (verified?.reasonCode ?? process.reasonCode ?? 'PREREQUISITE_LESSON_SETUP');
    return {
      ready,
      reasonCode,
      resourceStatus: process.status,
      recovery: ready ? [] : runtimeRecovery(lessonId, reasonCode),
      diagnostics: [{
        id: `lesson${lessonId}.oauth-lab`,
        status: ready ? 'pass' : 'fail',
        actual: process.status === 'running' ? `${process.status}/${healthy ? 'healthy' : 'unhealthy'}` : process.status,
        expected: requireRunning ? 'running/healthy' : 'absent-or-stopped-or-running/healthy',
        message: ready ? '所有するOAuth labの三originを安全に利用できます' : 'OAuth labを利用できません',
      }],
    };
  }

  async function ensureExternal(options = {}) {
    const outcome = await ensureOAuthLab(options);
    if (outcome.blocked) return runtimeBlocked(lessonId, outcome.blocked);
    return {
      changed: outcome.started,
      diagnostics: [{
        id: `lesson${lessonId}.oauth-lab`,
        status: 'pass',
        actual: outcome.started ? 'started/running/healthy' : 'reused/running/healthy',
        expected: 'running/healthy',
        message: '一つの所有processでAuthorization Server、Client、Resource APIを起動または再利用しました',
      }],
    };
  }

  async function resetExternal(options = {}) {
    const stopped = await stopOAuthLab(options);
    if (stopped.status === 'blocked') return runtimeBlocked(lessonId, stopped);
    return ensureExternal(options);
  }

  async function stopExternal(options = {}) {
    const outcome = await stopOAuthLab(options);
    if (outcome.status === 'blocked') return runtimeBlocked(lessonId, outcome);
    const absent = outcome.reasonCode === 'PROCESS_NOT_RECORDED';
    const changed = outcome.status === 'stopped';
    return {
      status: absent ? 'absent' : (changed ? 'stopped' : 'safe-noop'),
      reasonCode: changed ? null : outcome.reasonCode,
      diagnostics: [{
        id: `lesson${lessonId}.oauth-lab`,
        status: 'pass',
        actual: absent ? 'absent' : 'stopped',
        expected: 'absent|stopped',
        message: 'process fingerprintとcontrol identityを照合して、所有する三originだけを停止しました',
      }],
    };
  }

  return Object.freeze({ inspectExternal, ensureExternal, resetExternal, stopExternal });
}
