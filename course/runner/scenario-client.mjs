const MAX_RESPONSE_BYTES = 256 * 1024;
const SCENARIO_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export class ScenarioClientError extends Error {
  constructor(reasonCode, message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ScenarioClientError';
    this.reasonCode = reasonCode;
  }
}

function exactLoopbackOrigin(origin) {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'http:'
      || !['127.0.0.1', '[::1]'].includes(parsed.hostname)
      || !parsed.port
      || parsed.origin !== origin) {
    throw new TypeError('origin must be an exact loopback HTTP origin');
  }
  return parsed.origin;
}

async function boundedBody(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new ScenarioClientError('SCENARIO_RESPONSE_TOO_LARGE', 'project-app response exceeds the limit');
  }
  const chunks = [];
  let length = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new ScenarioClientError('SCENARIO_RESPONSE_TOO_LARGE', 'project-app response exceeds the limit');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
  }
  return Buffer.concat(chunks, length).toString('utf8');
}

export async function scenarioRequest(origin, path, {
  method = 'GET',
  scenarioId,
  cookie,
  authorization,
  json,
  headers: extraHeaders = {},
  signal,
} = {}) {
  const safeOrigin = exactLoopbackOrigin(origin);
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('?')) {
    throw new TypeError('path must be an absolute path without a query');
  }
  if (!extraHeaders || typeof extraHeaders !== 'object' || Array.isArray(extraHeaders)) {
    throw new TypeError('headers must be an object');
  }
  const headers = {};
  const protectedHeaders = new Set([
    'authorization', 'content-length', 'content-type', 'cookie', 'host', 'x-course-scenario-id',
  ]);
  for (const [rawName, value] of Object.entries(extraHeaders)) {
    const name = rawName.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(name) || protectedHeaders.has(name)) {
      throw new TypeError('extra header name is not allowed');
    }
    if (typeof value !== 'string' || /[^\x20-\x7e]/u.test(value)) {
      throw new TypeError('extra header value is invalid');
    }
    headers[name] = value;
  }
  if (scenarioId !== undefined) {
    if (!SCENARIO_ID_PATTERN.test(scenarioId)) throw new TypeError('scenarioId is invalid');
    headers['x-course-scenario-id'] = scenarioId;
  }
  if (cookie !== undefined) {
    if (typeof cookie !== 'string' || /[\r\n]/u.test(cookie)) throw new TypeError('cookie is invalid');
    headers.cookie = cookie;
  }
  if (authorization !== undefined) {
    if (
      typeof authorization !== 'string'
      || Buffer.byteLength(authorization, 'utf8') > 4096
      || /[^\x20-\x7e]/u.test(authorization)
    ) throw new TypeError('authorization is invalid');
    headers.authorization = authorization;
  }
  let body;
  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  }
  let response;
  try {
    response = await fetch(`${safeOrigin}${path}`, {
      method,
      redirect: 'error',
      headers,
      body,
      signal,
    });
  } catch (error) {
    throw new ScenarioClientError('SCENARIO_HTTP_UNREACHABLE', 'project-app request failed', { cause: error });
  }
  const text = await boundedBody(response);
  let parsed = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new ScenarioClientError('SCENARIO_RESPONSE_INVALID', 'project-app response is not JSON', { cause: error });
    }
  }
  return {
    status: response.status,
    body: parsed,
    retryAfter: response.headers.get('retry-after'),
    wwwAuthenticate: response.headers.get('www-authenticate'),
    setCookie: response.headers.get('set-cookie'),
    scenarioId: response.headers.get('x-course-scenario-id'),
  };
}

export async function withFreshScenario({ origin, lessonId, signal }, callback) {
  if (!['02', '03', '04', '05', '06', '12', '13', '14'].includes(lessonId)) throw new TypeError('lessonId is not scenario-enabled');
  if (typeof callback !== 'function') throw new TypeError('callback is required');
  const root = `/__course/lessons/${lessonId}/scenarios`;
  const created = await scenarioRequest(origin, root, { method: 'POST', signal });
  if (created.status !== 201 || !SCENARIO_ID_PATTERN.test(created.scenarioId ?? '')) {
    throw new ScenarioClientError('SCENARIO_CREATE_FAILED', 'project-app did not create a scenario');
  }
  const scenarioId = created.scenarioId;
  try {
    return await callback(scenarioId);
  } finally {
    await scenarioRequest(origin, root, {
      method: 'DELETE',
      scenarioId,
      signal: signal?.aborted ? undefined : signal,
    }).catch(() => {});
  }
}
