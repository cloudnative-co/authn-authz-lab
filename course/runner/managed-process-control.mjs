import {
  captureProcessStartFingerprint,
  detectProcessPlatform,
  verifyHealthIdentity,
} from './process.mjs';
import {
  assertResourceId,
  inspectManagedProcessResource,
  loadManagedContext,
  ManagedProcessError,
} from './managed-process-state.mjs';

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024;
const CONTROL_PATH = '/__course/scenarios';

function loopbackOrigin(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:'
      || !['127.0.0.1', '[::1]'].includes(parsed.hostname)
      || !parsed.port
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash) {
    throw new TypeError('managed control health origin must be an exact loopback HTTP origin');
  }
  return parsed.origin;
}

function healthChecks(value, recordOrigin) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new TypeError('managed control requires one to eight health checks');
  }
  const checks = value.map((check) => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) throw new TypeError('invalid health check');
    const origin = loopbackOrigin(check.origin);
    if (typeof check.path !== 'string' || !/^\/[A-Za-z0-9/_-]+$/u.test(check.path)) {
      throw new TypeError('health path must be an absolute path without query');
    }
    if (!Number.isSafeInteger(check.expectedStatus) || check.expectedStatus < 200 || check.expectedStatus > 499) {
      throw new TypeError('health expectedStatus is invalid');
    }
    if (check.expectedRole !== undefined
        && (typeof check.expectedRole !== 'string' || !/^[a-z][a-z0-9-]{2,63}$/u.test(check.expectedRole))) {
      throw new TypeError('health expectedRole is invalid');
    }
    return Object.freeze({
      origin,
      path: check.path,
      expectedStatus: check.expectedStatus,
      expectedRole: check.expectedRole ?? null,
      requireManagedIdentity: check.requireManagedIdentity === true,
    });
  });
  if (checks[0].origin !== recordOrigin || checks[0].path !== '/__course/health') {
    throw new TypeError('first health check must use the managed record origin and health endpoint');
  }
  if (new Set(checks.map(({ origin }) => origin)).size !== checks.length) {
    throw new TypeError('managed control health origins must be distinct');
  }
  return checks;
}

function requestSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('control request is required');
  if (!['POST', 'GET', 'DELETE'].includes(value.method) || value.path !== CONTROL_PATH) {
    throw new TypeError('managed control request is outside the fixed scenario API');
  }
  const headers = {};
  for (const [name, content] of Object.entries(value.headers ?? {})) {
    const lower = name.toLowerCase();
    if (!['content-type', 'x-course-scenario-id'].includes(lower) || typeof content !== 'string') {
      throw new TypeError('managed control request header is not allowed');
    }
    if (/[\r\n]/u.test(content) || content.length > 256) throw new TypeError('managed control header is invalid');
    headers[lower] = content;
  }
  if (Object.hasOwn(headers, 'x-course-scenario-id')
      && !/^[A-Za-z0-9_-]{43}$/u.test(headers['x-course-scenario-id'])) {
    throw new TypeError('scenario identifier is invalid');
  }
  const body = value.body === undefined ? null : String(value.body);
  if (body !== null && Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
    throw new TypeError('managed control request body is too large');
  }
  if (value.method === 'POST'
      && (headers['content-type'] !== 'application/x-www-form-urlencoded' || body === null)) {
    throw new TypeError('scenario creation requires a bounded form body');
  }
  if (value.method !== 'POST' && body !== null) throw new TypeError('GET/DELETE scenario control has no body');
  return Object.freeze({ method: value.method, path: value.path, headers, body });
}

function timeoutSignal(signal, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5_000) {
    throw new TypeError('managed control timeout must be 100-5000 ms');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('managed control timeout')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

async function boundedBody(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new ManagedProcessError('PROCESS_CONTROL_RESPONSE_TOO_LARGE', 'control response is too large');
  }
  const reader = response.body?.getReader();
  const chunks = [];
  let total = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ManagedProcessError('PROCESS_CONTROL_RESPONSE_TOO_LARGE', 'control response is too large');
    }
    chunks.push(Buffer.from(value));
  }
  if (total === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new ManagedProcessError('PROCESS_CONTROL_RESPONSE_INVALID', 'control response is not JSON', { cause: error });
  }
}

async function verifyGeneration(snapshot, checks, signal) {
  const { record } = snapshot.current;
  const platformSupport = detectProcessPlatform();
  const fingerprint = await captureProcessStartFingerprint(record.pid, {
    instanceId: record.instanceId,
    platformSupport,
  });
  if (fingerprint === null || fingerprint !== record.startFingerprint) {
    throw new ManagedProcessError('PROCESS_FINGERPRINT_MISMATCH', 'managed process fingerprint changed');
  }
  await verifyHealthIdentity({ record, signal, platformSupport });
  for (const check of checks.slice(1)) {
    let response;
    try {
      response = await fetch(`${check.origin}${check.path}`, { signal });
    } catch (error) {
      throw new ManagedProcessError('PROCESS_ADDITIONAL_HEALTH_UNREACHABLE', 'managed additional origin is unreachable', { cause: error });
    }
    if (response.status !== check.expectedStatus) {
      throw new ManagedProcessError('PROCESS_ADDITIONAL_HEALTH_INVALID', 'managed additional origin returned an unexpected status');
    }
    const body = await boundedBody(response);
    if (check.expectedRole !== null && body?.role !== check.expectedRole) {
      throw new ManagedProcessError('PROCESS_ADDITIONAL_HEALTH_IDENTITY_MISMATCH', 'managed additional origin role differs');
    }
    if (check.requireManagedIdentity
        && (body?.pid !== record.pid || body?.instanceId !== record.instanceId)) {
      throw new ManagedProcessError(
        'PROCESS_ADDITIONAL_HEALTH_IDENTITY_MISMATCH',
        'managed additional origin is not owned by the recorded process generation',
      );
    }
  }
}

export async function requestManagedProcessControl({
  stateRoot,
  repoRoot,
  resourceId,
  allowedResourceIds,
  checks: requestedChecks,
  request: requestedRequest,
  signal,
  timeoutMs = 3_000,
} = {}) {
  assertResourceId(resourceId, allowedResourceIds);
  const context = await loadManagedContext({ stateRoot, repoRoot });
  const snapshot = await inspectManagedProcessResource({ context, resourceId });
  const current = snapshot.current;
  if (!current?.record || current.record.status !== 'running'
      || current.control.status !== 'active' || typeof current.control.shutdownToken !== 'string') {
    throw new ManagedProcessError('PROCESS_CONTROL_UNAVAILABLE', 'managed process has no active owned control capability');
  }
  const checks = healthChecks(requestedChecks, current.record.origin);
  const request = requestSpec(requestedRequest);
  const bounded = timeoutSignal(signal, timeoutMs);
  try {
    await verifyGeneration(snapshot, checks, bounded.signal);
    const response = await fetch(`${current.record.origin}${request.path}`, {
      method: request.method,
      headers: {
        ...request.headers,
        'x-course-instance-id': current.record.instanceId,
        'x-course-control-token': current.control.shutdownToken,
      },
      ...(request.body === null ? {} : { body: request.body }),
      signal: bounded.signal,
    });
    const body = await boundedBody(response);
    const after = await inspectManagedProcessResource({ context, resourceId });
    if (after.current?.generationId !== current.generationId
        || after.current?.record?.startFingerprint !== current.record.startFingerprint
        || after.current?.control?.status !== 'active') {
      throw new ManagedProcessError('PROCESS_CONTROL_GENERATION_CHANGED', 'managed process generation changed during control request');
    }
    return Object.freeze({ status: response.status, body });
  } catch (error) {
    if (error instanceof ManagedProcessError) throw error;
    throw new ManagedProcessError(
      bounded.signal.aborted ? 'PROCESS_CONTROL_TIMEOUT' : 'PROCESS_CONTROL_UNREACHABLE',
      'managed process control request failed',
      { cause: error },
    );
  } finally {
    bounded.cleanup();
  }
}
