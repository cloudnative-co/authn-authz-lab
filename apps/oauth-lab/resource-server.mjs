import { createServer } from 'node:http';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { createLesson04ProjectCore } from '../../services/project-core/index.mjs';
import { canonicalOpaque } from './crypto.mjs';
import { LabHttpError, requestUrl, sendJson } from './http.mjs';
import { scenarioIdFromRequest } from './scenario-registry.mjs';

const OPAQUE_MISSING_CHALLENGE = 'Bearer realm="lesson-10-api"';
const OPAQUE_INVALID_CHALLENGE = 'Bearer realm="lesson-10-api", error="invalid_token"';
const OPAQUE_SCOPE_CHALLENGE = 'Bearer realm="lesson-10-api", error="insufficient_scope", scope="project:read"';
const JWT_MISSING_CHALLENGE = 'Bearer realm="lesson-15-api"';
const JWT_INVALID_CHALLENGE = 'Bearer realm="lesson-15-api", error="invalid_token"';
const JWT_SCOPE_CHALLENGE = 'Bearer realm="lesson-15-api", error="insufficient_scope", scope="project:delete"';
const MAX_SCOPE_LENGTH = 512;
const MAX_JWT_LENGTH = 16 * 1024;
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/u;
const LOCAL_SUBJECT = /^user-[1-9][0-9]*$/u;
const LOCAL_PROJECT = /^p-[1-9][0-9]*$/u;

function credentialFrom(request) {
  const values = request.headersDistinct?.authorization
    ?? (request.headers.authorization === undefined ? [] : [request.headers.authorization]);
  if (values.length === 0) return { kind: 'missing' };
  if (values.length !== 1 || typeof values[0] !== 'string') return { kind: 'invalid' };
  const match = /^Bearer ([\x21-\x7E]+)$/u.exec(values[0]);
  return match ? { kind: 'token', value: match[1] } : { kind: 'invalid' };
}

function opaqueCredential(credential) {
  if (credential.kind !== 'token') return credential;
  return canonicalOpaque(credential.value) ? credential : { kind: 'invalid' };
}

function scopeSet(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SCOPE_LENGTH) return null;
  const values = value.split(' ');
  if (values.some((item) => !SCOPE_TOKEN.test(item)) || new Set(values).size !== values.length) return null;
  return new Set(values);
}

async function introspect(config, resourceSecret, rawToken, scenarioId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const authorization = Buffer.from(`${config.resourceId}:${resourceSecret}`, 'utf8').toString('base64');
    const response = await fetch(`${config.issuer}/oauth/introspect`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${authorization}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(scenarioId ? { 'x-course-scenario-id': scenarioId } : {}),
      },
      body: new URLSearchParams({ token: rawToken, token_type_hint: 'access_token' }),
      signal: controller.signal,
    });
    if (response.status !== 200) return { kind: 'unavailable' };
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > 64 * 1024) return { kind: 'unavailable' };
    const reader = response.body?.getReader();
    const chunks = [];
    let total = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 64 * 1024) {
        await reader.cancel();
        return { kind: 'unavailable' };
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks.map((value) => Buffer.from(value))).toString('utf8'));
    return body && typeof body === 'object' ? { kind: 'ok', body } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

function jwtReason(error) {
  if (error?.reasonCode) return error.reasonCode;
  if (error?.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'
      || error?.code === 'ERR_JWKS_NO_MATCHING_KEY') return 'TOKEN_SIGNATURE_REJECTED';
  if (error?.code === 'ERR_JWT_EXPIRED') return 'TOKEN_EXPIRED';
  if (error?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && error.claim === 'iss') {
    return 'TOKEN_ISSUER_REJECTED';
  }
  if (error?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && error.claim === 'aud') {
    return 'TOKEN_AUDIENCE_REJECTED';
  }
  if (error?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') return 'TOKEN_CLAIMS_REJECTED';
  return 'TOKEN_FORMAT_REJECTED';
}

function unavailableJwks(error) {
  return error?.code === 'ERR_JWKS_TIMEOUT'
    || error?.cause?.code === 'ECONNREFUSED'
    || error?.cause?.code === 'ENOTFOUND';
}

async function validateJwtAccessToken(rawToken, { config, jwks, now }) {
  if (typeof rawToken !== 'string' || rawToken.length === 0 || rawToken.length > MAX_JWT_LENGTH) {
    throw Object.assign(new Error('JWT access token has an invalid wire shape'), {
      reasonCode: 'TOKEN_FORMAT_REJECTED',
    });
  }
  let header;
  try {
    header = decodeProtectedHeader(rawToken);
  } catch {
    throw Object.assign(new Error('JWT access token cannot be decoded'), {
      reasonCode: 'TOKEN_FORMAT_REJECTED',
    });
  }
  if (!['at+jwt', 'application/at+jwt'].includes(header.typ)) {
    throw Object.assign(new Error('JWT access token type is not explicit'), {
      reasonCode: 'TOKEN_TYPE_REJECTED',
    });
  }
  let verified;
  try {
    verified = await jwtVerify(rawToken, jwks, {
      algorithms: ['RS256'],
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ['iss', 'exp', 'aud', 'sub', 'client_id', 'iat', 'jti', 'scope'],
      clockTolerance: 5,
      maxTokenAge: '10m',
      currentDate: new Date(now()),
    });
  } catch (error) {
    if (unavailableJwks(error)) throw Object.assign(error, { reasonCode: 'JWKS_UNAVAILABLE' });
    throw Object.assign(error, { reasonCode: jwtReason(error) });
  }
  const { payload } = verified;
  const scopes = scopeSet(payload.scope);
  if (verified.protectedHeader.alg !== 'RS256'
      || payload.client_id !== config.clientId
      || typeof payload.sub !== 'string'
      || !LOCAL_SUBJECT.test(payload.sub)
      || typeof payload.jti !== 'string'
      || payload.jti.length < 1
      || payload.jti.length > 128
      || !Number.isSafeInteger(payload.iat)
      || scopes === null) {
    throw Object.assign(new Error('JWT access token claims violate local resource policy'), {
      reasonCode: 'TOKEN_CLAIMS_REJECTED',
    });
  }
  return Object.freeze({ subject: payload.sub, clientId: payload.client_id, scopes });
}

function sendNoContent(response, status) {
  response.statusCode = status;
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-length', '0');
  response.end();
}

export function createResourceServer({
  config, resourceSecret, scenarioRegistry, control = null, now = () => Date.now(),
} = {}) {
  if (!config || !scenarioRegistry || typeof resourceSecret !== 'string') {
    throw new TypeError('resource dependencies are required');
  }
  const jwks = createRemoteJWKSet(new URL(`${config.issuer}/oauth/jwks`), {
    timeoutDuration: 3_000,
    cooldownDuration: 1_000,
    cacheMaxAge: 5 * 60_000,
  });
  const projectCores = new WeakMap();

  function projectCoreFor(scenario) {
    let core = projectCores.get(scenario);
    if (!core) {
      core = createLesson04ProjectCore({ maxAuditEntries: 128 });
      projectCores.set(scenario, core);
    }
    return core;
  }

  function record(scenario, request, status, reason, checks = {}) {
    scenario.evidence.record({
      role: 'resource-api', origin: config.apiOrigin, method: request.method,
      path: new URL(request.url, config.apiOrigin).pathname, status, reason, checks,
    });
  }

  async function opaqueProjects(request, response, scenario) {
    const credential = opaqueCredential(credentialFrom(request));
    if (credential.kind === 'missing') {
      sendJson(response, 401, { error: { code: 'BEARER_REQUIRED' } }, {
        'www-authenticate': OPAQUE_MISSING_CHALLENGE,
      });
      record(scenario, request, 401, 'BEARER_REQUIRED', { challengePresent: true });
      return;
    }
    if (credential.kind === 'invalid') {
      sendJson(response, 401, { error: { code: 'INVALID_TOKEN' } }, {
        'www-authenticate': OPAQUE_INVALID_CHALLENGE,
      });
      record(scenario, request, 401, 'INVALID_TOKEN', { challengePresent: true });
      return;
    }
    const result = await introspect(config, resourceSecret, credential.value, scenarioIdFromRequest(request));
    if (result.kind === 'unavailable') {
      sendJson(response, 503, { error: { code: 'TOKEN_VALIDATION_UNAVAILABLE' } }, {
        'retry-after': '1',
      });
      record(scenario, request, 503, 'TOKEN_VALIDATION_UNAVAILABLE', { introspected: false, retryable: true });
      return;
    }
    const metadata = result.body;
    const grantedScopes = scopeSet(metadata?.scope);
    const nowSeconds = Math.floor(now() / 1000);
    const authenticated = metadata?.active === true
      && metadata.aud === config.audience
      && metadata.token_type === 'Bearer'
      && typeof metadata.sub === 'string'
      && metadata.sub.length > 0
      && metadata.client_id === config.clientId
      && Number.isSafeInteger(metadata.exp)
      && metadata.exp > nowSeconds
      && grantedScopes !== null;
    if (!authenticated) {
      sendJson(response, 401, { error: { code: 'INVALID_TOKEN' } }, {
        'www-authenticate': OPAQUE_INVALID_CHALLENGE,
      });
      record(scenario, request, 401, 'INVALID_TOKEN', { introspected: true, activeForResource: false });
      return;
    }
    if (!grantedScopes.has('project:read')) {
      sendJson(response, 403, { error: { code: 'INSUFFICIENT_SCOPE' } }, {
        'www-authenticate': OPAQUE_SCOPE_CHALLENGE,
      });
      record(scenario, request, 403, 'INSUFFICIENT_SCOPE', {
        introspected: true, activeForResource: true, requiredScopePresent: false,
      });
      return;
    }
    sendJson(response, 200, {
      projects: [{ id: 'project-100', name: 'Protocol Lab' }],
      principal: { sub: metadata.sub },
    });
    record(scenario, request, 200, 'RESOURCE_RETURNED', {
      introspected: true, audienceMatched: true, requiredScopePresent: true,
    });
  }

  async function deleteProject(request, response, scenario, projectId) {
    const credential = credentialFrom(request);
    if (credential.kind === 'missing') {
      sendJson(response, 401, { error: { code: 'BEARER_REQUIRED' } }, {
        'www-authenticate': JWT_MISSING_CHALLENGE,
      });
      record(scenario, request, 401, 'BEARER_REQUIRED', {
        tokenValidated: false, scopeValidated: false, policyEvaluated: false,
      });
      return;
    }
    if (credential.kind === 'invalid') {
      sendJson(response, 401, { error: { code: 'INVALID_TOKEN' } }, {
        'www-authenticate': JWT_INVALID_CHALLENGE,
      });
      record(scenario, request, 401, 'TOKEN_FORMAT_REJECTED', {
        tokenValidated: false, scopeValidated: false, policyEvaluated: false,
      });
      return;
    }
    let principal;
    try {
      principal = await validateJwtAccessToken(credential.value, { config, jwks, now });
    } catch (error) {
      if (error.reasonCode === 'JWKS_UNAVAILABLE') {
        sendJson(response, 503, { error: { code: 'TOKEN_VALIDATION_UNAVAILABLE' } }, {
          'retry-after': '1',
        });
        record(scenario, request, 503, 'JWKS_UNAVAILABLE', {
          tokenValidated: false, scopeValidated: false, policyEvaluated: false,
        });
        return;
      }
      sendJson(response, 401, { error: { code: 'INVALID_TOKEN' } }, {
        'www-authenticate': JWT_INVALID_CHALLENGE,
      });
      record(scenario, request, 401, jwtReason(error), {
        tokenValidated: false, scopeValidated: false, policyEvaluated: false,
      });
      return;
    }
    if (!principal.scopes.has('project:delete')) {
      sendJson(response, 403, { error: { code: 'INSUFFICIENT_SCOPE' } }, {
        'www-authenticate': JWT_SCOPE_CHALLENGE,
      });
      record(scenario, request, 403, 'INSUFFICIENT_SCOPE', {
        tokenValidated: true, scopeValidated: false, policyEvaluated: false,
      });
      return;
    }
    if (!LOCAL_PROJECT.test(projectId)) {
      sendJson(response, 404, { error: { code: 'PROJECT_NOT_FOUND' } });
      record(scenario, request, 404, 'RESOURCE_CONCEALED', {
        tokenValidated: true, scopeValidated: true, policyEvaluated: true,
      });
      return;
    }
    const decision = projectCoreFor(scenario).deleteProject({
      principal: { id: principal.subject },
      resourceId: projectId,
    });
    if (decision.status === 204) {
      sendNoContent(response, 204);
      record(scenario, request, 204, 'PROJECT_DELETED', {
        tokenValidated: true, scopeValidated: true, policyEvaluated: true,
      });
      return;
    }
    sendJson(response, decision.status, { error: { code: decision.code } });
    record(scenario, request, decision.status,
      decision.status === 403 ? 'PROJECT_DELETE_FORBIDDEN' : 'RESOURCE_CONCEALED', {
        tokenValidated: true, scopeValidated: true, policyEvaluated: true,
      });
  }

  const server = createServer(async (request, response) => {
    try {
      const url = requestUrl(request, config.apiOrigin);
      if (request.method === 'GET' && url.pathname === '/__course/health' && !url.search) {
        sendJson(response, 200, {
          role: 'resource-api', origin: config.apiOrigin, ...(control ? control.identity : {}),
        });
        return;
      }
      const scenario = scenarioRegistry.fromRequest(request);
      if (!scenario) {
        sendJson(response, 400, { error: { code: 'SCENARIO_INVALID' } });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/projects' && !url.search) {
        await opaqueProjects(request, response, scenario);
        return;
      }
      const project = /^\/api\/projects\/([^/]+)$/u.exec(url.pathname);
      if (request.method === 'DELETE' && project && !url.search) {
        await deleteProject(request, response, scenario, project[1]);
        return;
      }
      sendJson(response, 404, { error: { code: 'NOT_FOUND' } });
      record(scenario, request, 404, 'NOT_FOUND');
    } catch (error) {
      const status = error instanceof LabHttpError ? error.status : 500;
      if (!response.headersSent) {
        sendJson(response, status, { error: { code: status === 500 ? 'INTERNAL_ERROR' : error.reasonCode } });
        const scenario = scenarioRegistry.fromRequest(request);
        if (scenario) record(scenario, request, status, status === 500 ? 'INTERNAL_ERROR' : error.reasonCode);
      } else if (!response.writableEnded) response.end();
    }
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  return Object.freeze({ server });
}

export const bearerChallenges = Object.freeze({
  missing: OPAQUE_MISSING_CHALLENGE,
  invalid: OPAQUE_INVALID_CHALLENGE,
  insufficientScope: OPAQUE_SCOPE_CHALLENGE,
  jwtMissing: JWT_MISSING_CHALLENGE,
  jwtInvalid: JWT_INVALID_CHALLENGE,
  jwtInsufficientScope: JWT_SCOPE_CHALLENGE,
});

export const resourceServerInternals = Object.freeze({
  credentialFrom,
  scopeSet,
  validateJwtAccessToken,
  jwtReason,
});
