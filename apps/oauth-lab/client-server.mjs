import { createServer } from 'node:http';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { canonicalOpaque, digest, pkceChallenge, randomOpaque, safeEqual } from './crypto.mjs';
import { createDigestStore } from './digest-store.mjs';
import { scenarioIdFromRequest } from './scenario-registry.mjs';
import {
  cookie,
  LabHttpError,
  redirect,
  requestUrl,
  sendHtml,
  sendJson,
  setCookie,
} from './http.mjs';

const TRANSACTION_TTL = 5 * 60_000;
const APP_SESSION_TTL = 10 * 60_000;
const RP_SESSION_COOKIE = 'course_rp_session';

function single(params, name) {
  const values = params.getAll(name);
  return values.length === 1 && values[0] !== '' ? values[0] : null;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 64 * 1024) throw new Error('RESPONSE_TOO_LARGE');
    const reader = response.body?.getReader();
    const chunks = [];
    let total = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 64 * 1024) {
        await reader.cancel();
        throw new Error('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks.map((value) => Buffer.from(value))).toString('utf8');
    const body = raw.length === 0 ? null : JSON.parse(raw);
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function tokenExchange(config, transaction, code, verifier, scenarioId) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: transaction.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
    ...(transaction.resource ? { resource: transaction.resource } : {}),
  });
  return fetchJson(`${config.issuer}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(scenarioId ? { 'x-course-scenario-id': scenarioId } : {}),
    },
    body,
  });
}

async function callResource(config, accessToken, scenarioId) {
  return fetchJson(`${config.apiOrigin}/api/projects`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(scenarioId ? { 'x-course-scenario-id': scenarioId } : {}),
    },
  });
}

async function deleteProject(config, accessToken, projectId, scenarioId) {
  return fetchJson(`${config.apiOrigin}/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(scenarioId ? { 'x-course-scenario-id': scenarioId } : {}),
    },
  });
}

function oidcReason(error) {
  if (error?.code === 'ERR_JWT_EXPIRED') return 'ID_TOKEN_EXPIRED';
  if (error?.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return 'ID_TOKEN_SIGNATURE_REJECTED';
  if (error?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && error.claim === 'iss') {
    return 'ID_TOKEN_ISSUER_REJECTED';
  }
  if (error?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && error.claim === 'aud') {
    return 'ID_TOKEN_AUDIENCE_REJECTED';
  }
  return 'ID_TOKEN_FORMAT_REJECTED';
}

async function validateIdToken(config, rawToken, expectedNonce, scenarioId) {
  if (typeof rawToken !== 'string' || rawToken.length > 16 * 1024) {
    throw Object.assign(new Error('ID token format rejected'), { reasonCode: 'ID_TOKEN_FORMAT_REJECTED' });
  }
  const scenarioHeaders = scenarioId ? { 'x-course-scenario-id': scenarioId } : {};
  const discoveryResult = await fetchJson(`${config.issuer}/.well-known/openid-configuration`, {
    headers: scenarioHeaders,
  });
  const metadata = discoveryResult.body;
  if (
    discoveryResult.response.status !== 200
    || metadata?.issuer !== config.issuer
    || metadata.jwks_uri !== `${config.issuer}/oauth/jwks`
    || !Array.isArray(metadata.id_token_signing_alg_values_supported)
    || !metadata.id_token_signing_alg_values_supported.includes('RS256')
  ) throw Object.assign(new Error('discovery rejected'), { reasonCode: 'DISCOVERY_REJECTED' });
  const jwksResult = await fetchJson(metadata.jwks_uri, { headers: scenarioHeaders });
  if (jwksResult.response.status !== 200 || !Array.isArray(jwksResult.body?.keys)) {
    throw Object.assign(new Error('JWKS rejected'), { reasonCode: 'JWKS_REJECTED' });
  }
  let verified;
  try {
    verified = await jwtVerify(rawToken, createLocalJWKSet(jwksResult.body), {
      algorithms: ['RS256'],
      issuer: config.issuer,
      audience: config.clientId,
      requiredClaims: ['iss', 'sub', 'aud', 'iat', 'exp', 'nonce'],
      maxTokenAge: '5m',
    });
  } catch (error) {
    throw Object.assign(new Error('ID token rejected'), { reasonCode: oidcReason(error) });
  }
  if (!safeEqual(verified.payload.nonce, expectedNonce)) {
    throw Object.assign(new Error('nonce rejected'), { reasonCode: 'ID_TOKEN_NONCE_REJECTED' });
  }
  if (typeof verified.payload.sub !== 'string' || verified.payload.sub.length === 0
      || verified.payload.sub.length > 255) {
    throw Object.assign(new Error('subject rejected'), { reasonCode: 'ID_TOKEN_SUBJECT_REJECTED' });
  }
  return Object.freeze({
    sub: verified.payload.sub,
    emailPresent: typeof verified.payload.email === 'string',
  });
}

function landingPage(config) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>OAuth/OIDC実習</title>
  <h1>OAuth 2.0とOpenID Connectの実習</h1>
  <p><a href="${config.clientOrigin}/lesson/10/start">Lesson 10: APIへのアクセスを許可する</a></p>
  <p><a href="${config.clientOrigin}/lesson/11/start">Lesson 11: OpenID Providerでログインする</a></p>
  <p><a href="${config.clientOrigin}/lesson/15/start">Lesson 15: JWT Access Tokenとproject認可を検証する</a></p></html>`;
}

function resultPage(title, result, explanation) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${title}</title>
  <h1>${title}</h1><p data-result="${result}">${explanation}</p><p><a href="/start">最初に戻る</a></p></html>`;
}

export function createClientServer({
  config,
  evidence,
  now = () => Date.now(),
  oauthClientFaultQueue = [],
  scenarioRegistry,
  control = null,
} = {}) {
  if (!config || !scenarioRegistry) throw new TypeError('client dependencies are required');
  const contexts = new WeakMap();

  function contextFor(scenario) {
    let context = contexts.get(scenario);
    if (!context) {
      context = {
        transactions: createDigestStore({ limit: 128, now }),
        appSessions: createDigestStore({ limit: 64, now }),
        oauthFaults: [...(scenario.oauthClientFaultQueue.length > 0
          ? scenario.oauthClientFaultQueue : oauthClientFaultQueue)],
      };
      contexts.set(scenario, context);
    }
    return context;
  }

  function record(scenario, request, role, status, reason, checks = {}) {
    scenario.evidence.record({
      role, origin: config.clientOrigin, method: request.method,
      path: new URL(request.url, config.clientOrigin).pathname, status, reason, checks,
    });
  }

  function startFlow(response, lessonId, requestedScope, context, projectId = null) {
    const state = randomOpaque();
    const verifier = randomOpaque();
    const nonce = lessonId === '11' ? randomOpaque() : null;
    const redirectUri = lessonId === '11'
      ? config.oidcRedirectUri
      : (lessonId === '15' ? config.apiRedirectUri : config.oauthRedirectUri);
    const scope = lessonId === '11' ? 'openid email profile:read' : requestedScope;
    const resource = lessonId === '15' ? config.audience : null;
    context.transactions.set(state, {
      lessonId,
      redirectUri,
      verifier,
      verifierDigest: digest(verifier),
      nonce,
      expectedIssuer: config.issuer,
      resource,
      projectId,
    }, TRANSACTION_TTL);
    const target = new URL('/oauth/authorize', config.issuer);
    for (const [name, value] of Object.entries({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
      ...(nonce ? { nonce } : {}),
      ...(resource ? { resource } : {}),
    })) target.searchParams.set(name, value);
    redirect(response, target.toString());
  }

  async function oauthCallback(request, response, url, context, scenario, scenarioId) {
    const state = single(url.searchParams, 'state');
    const code = single(url.searchParams, 'code');
    const issuer = single(url.searchParams, 'iss');
    const transaction = canonicalOpaque(state) ? context.transactions.take(state) : null;
    if (!transaction || transaction.lessonId !== '10' || !canonicalOpaque(code)
        || !safeEqual(issuer, transaction.expectedIssuer)) {
      sendHtml(response, 400, resultPage('OAuth応答を拒否しました', 'rejected', 'state、issuer、codeの検証に失敗しました。'));
      record(scenario, request, 'oauth-client', 400, transaction ? 'AUTHORIZATION_RESPONSE_REJECTED' : 'STATE_REJECTED', {
        transactionConsumed: Boolean(transaction), issuerMatched: Boolean(transaction && safeEqual(issuer, transaction.expectedIssuer)),
      });
      return;
    }
    const fault = context.oauthFaults.length > 0 ? context.oauthFaults.shift() : null;
    const verifier = fault === 'pkce' ? randomOpaque() : transaction.verifier;
    const exchanged = await tokenExchange(config, transaction, code, verifier, scenarioId);
    if (exchanged.response.status !== 200) {
      sendHtml(response, 400, resultPage('Token交換を拒否されました', 'rejected', '認可codeまたはPKCEの検証に失敗しました。'));
      record(scenario, request, 'oauth-client', 400, fault === 'pkce' ? 'PKCE_REJECTED' : 'TOKEN_EXCHANGE_REJECTED', {
        stateConsumed: true, tokenIssued: false,
      });
      return;
    }
    if (fault === 'replay') {
      const replayed = await tokenExchange(config, transaction, code, transaction.verifier, scenarioId);
      const rejected = replayed.response.status === 400 && replayed.body?.error === 'invalid_grant';
      sendHtml(response, rejected ? 200 : 500, resultPage('code再利用の検証', rejected ? 'replay-rejected' : 'failed',
        rejected ? '一度使った認可codeは再利用できません。' : '再利用が拒否されませんでした。'));
      record(scenario, request, 'oauth-client', rejected ? 200 : 500, rejected ? 'CODE_REPLAY_REJECTED' : 'CODE_REPLAY_ACCEPTED', {
        firstExchangeSucceeded: true, secondExchangeRejected: rejected,
      });
      return;
    }
    const resource = await callResource(config, exchanged.body.access_token, scenarioId);
    const successful = resource.response.status === 200;
    sendHtml(response, successful ? 200 : resource.response.status,
      resultPage('OAuth APIアクセス結果', successful ? 'resource-authorized' : 'resource-rejected',
        successful ? 'Clientは委譲されたscopeでResource APIを呼び出しました。' : 'Access TokenのscopeではResource APIを呼び出せません。'));
    record(scenario, request, 'oauth-client', successful ? 200 : resource.response.status,
      successful ? 'RESOURCE_CALL_SUCCEEDED' : 'RESOURCE_CALL_REJECTED', {
        stateConsumed: true, issuerMatched: true, tokenExchangedBackChannel: true,
        resourceAuthorized: successful, sessionCookieIssued: false,
      });
  }

  async function oidcCallback(request, response, url, context, scenario, scenarioId) {
    const state = single(url.searchParams, 'state');
    const code = single(url.searchParams, 'code');
    const issuer = single(url.searchParams, 'iss');
    const transaction = canonicalOpaque(state) ? context.transactions.take(state) : null;
    if (!transaction || transaction.lessonId !== '11' || !canonicalOpaque(code)
        || !safeEqual(issuer, transaction.expectedIssuer)) {
      sendHtml(response, 400, resultPage('OIDC応答を拒否しました', 'rejected', 'state、issuer、codeの検証に失敗しました。'));
      record(scenario, request, 'oidc-rp', 400, transaction ? 'AUTHORIZATION_RESPONSE_REJECTED' : 'STATE_REJECTED', {
        transactionConsumed: Boolean(transaction), issuerMatched: Boolean(transaction && safeEqual(issuer, transaction.expectedIssuer)),
      });
      return;
    }
    const exchanged = await tokenExchange(config, transaction, code, transaction.verifier, scenarioId);
    if (exchanged.response.status !== 200 || typeof exchanged.body.id_token !== 'string') {
      sendHtml(response, 400, resultPage('OIDC Token応答を拒否しました', 'rejected', 'ID Tokenを取得できませんでした。'));
      record(scenario, request, 'oidc-rp', 400, 'TOKEN_EXCHANGE_REJECTED', {
        stateConsumed: true, idTokenReceivedBackChannel: false,
      });
      return;
    }
    let identity;
    try {
      identity = await validateIdToken(config, exchanged.body.id_token, transaction.nonce, scenarioId);
    } catch (error) {
      const reason = /^[A-Z][A-Z0-9_]{2,63}$/u.test(error.reasonCode ?? '')
        ? error.reasonCode : 'ID_TOKEN_REJECTED';
      sendHtml(response, 400, resultPage('ID Tokenを拒否しました', 'rejected', '署名またはclaimの検証に失敗しました。'));
      record(scenario, request, 'oidc-rp', 400, reason, {
        stateConsumed: true, idTokenReceivedBackChannel: true, idTokenValidated: false,
      });
      return;
    }
    const appSession = randomOpaque();
    context.appSessions.set(appSession, { sub: identity.sub }, APP_SESSION_TTL);
    redirect(response, `${config.clientOrigin}/me`, {
      'set-cookie': setCookie(RP_SESSION_COOKIE, appSession),
      'x-course-outcome': 'oidc-authenticated',
    });
    record(scenario, request, 'oidc-rp', 302, 'APP_SESSION_ISSUED', {
      discoveryFetched: true, jwksFetched: true, algorithmAllowed: true,
      issuerMatched: true, audienceMatched: true, timeValidated: true, nonceMatched: true,
      idTokenReceivedBackChannel: true,
    });
  }

  async function apiCallback(request, response, url, context, scenario, scenarioId) {
    const state = single(url.searchParams, 'state');
    const code = single(url.searchParams, 'code');
    const issuer = single(url.searchParams, 'iss');
    const transaction = canonicalOpaque(state) ? context.transactions.take(state) : null;
    if (!transaction || transaction.lessonId !== '15' || !canonicalOpaque(code)
        || !safeEqual(issuer, transaction.expectedIssuer)) {
      sendHtml(response, 400, resultPage('OAuth応答を拒否しました', 'rejected', 'state、issuer、codeの検証に失敗しました。'));
      record(scenario, request, 'oauth-client', 400, transaction ? 'AUTHORIZATION_RESPONSE_REJECTED' : 'STATE_REJECTED', {
        transactionConsumed: Boolean(transaction), issuerMatched: Boolean(transaction && safeEqual(issuer, transaction.expectedIssuer)),
      });
      return;
    }
    const exchanged = await tokenExchange(config, transaction, code, transaction.verifier, scenarioId);
    if (exchanged.response.status !== 200 || typeof exchanged.body?.access_token !== 'string') {
      sendHtml(response, 400, resultPage('Token応答を拒否しました', 'rejected', 'Access Tokenを取得できませんでした。'));
      record(scenario, request, 'oauth-client', 400, 'TOKEN_EXCHANGE_REJECTED', {
        stateConsumed: true, tokenReceived: false,
      });
      return;
    }
    const resource = await deleteProject(
      config, exchanged.body.access_token, transaction.projectId, scenarioId,
    );
    const resourceStatus = resource.response.status;
    const outcome = resourceStatus === 204
      ? 'project-deleted'
      : (resource.body?.error?.code === 'INSUFFICIENT_SCOPE'
        ? 'scope-rejected'
        : (resourceStatus === 401
          ? 'token-rejected'
          : (resourceStatus === 404 ? 'resource-concealed' : 'policy-rejected')));
    const callbackStatus = resourceStatus === 204 ? 200 : resourceStatus;
    const resourceChallenge = resource.response.headers.get('www-authenticate');
    sendHtml(response, callbackStatus, resultPage('OAuth API認可結果', outcome,
      resourceStatus === 204
        ? 'Token検証、scope検証、project認可のすべてを通過しました。'
        : 'Resource APIがToken、scope、またはproject認可の境界で拒否しました。'), {
      'x-course-resource-status': String(resourceStatus),
      ...(resourceChallenge ? { 'x-course-resource-challenge': resourceChallenge } : {}),
    });
    record(scenario, request, 'oauth-client', callbackStatus,
      resourceStatus === 204 ? 'RESOURCE_CALL_SUCCEEDED' : 'RESOURCE_CALL_REJECTED', {
        stateConsumed: true,
        issuerMatched: true,
        tokenExchangedBackChannel: true,
        tokenForwardedOpaque: true,
        resourceAuthorized: resourceStatus === 204,
      });
  }

  const server = createServer(async (request, response) => {
    try {
      const url = requestUrl(request, config.clientOrigin);
      if (request.method === 'GET' && url.pathname === '/__course/health' && !url.search) {
        sendJson(response, 200, {
          role: 'oauth-client',
          origin: config.clientOrigin,
          ...(control ? control.identity : {}),
        });
        return;
      }
      const scenario = scenarioRegistry.fromRequest(request);
      if (!scenario) {
        sendJson(response, 400, { error: { code: 'SCENARIO_INVALID' } });
        return;
      }
      const context = contextFor(scenario);
      const scenarioId = scenarioIdFromRequest(request);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/start')) {
        sendHtml(response, 200, landingPage(config));
        record(scenario, request, 'oauth-client', 200, 'START_PAGE_RETURNED');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/lesson/10/start') {
        const scope = url.searchParams.size === 0 ? 'project:read'
          : (url.searchParams.size === 1 && single(url.searchParams, 'scope') === 'profile:read'
            ? 'profile:read' : null);
        if (!scope) {
          sendJson(response, 400, { error: { code: 'START_REQUEST_INVALID' } });
          record(scenario, request, 'oauth-client', 400, 'START_REQUEST_INVALID');
          return;
        }
        startFlow(response, '10', scope, context);
        record(scenario, request, 'oauth-client', 302, 'AUTHORIZATION_STARTED', {
          stateGenerated: true, pkceS256: true, clientSecretAbsent: true,
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/lesson/11/start' && url.searchParams.size === 0) {
        startFlow(response, '11', undefined, context);
        record(scenario, request, 'oidc-rp', 302, 'AUTHENTICATION_STARTED', {
          stateGenerated: true, nonceGenerated: true, pkceS256: true,
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/lesson/15/start') {
        const allowed = new Set(['scope', 'project']);
        if ([...url.searchParams.keys()].some((name) => !allowed.has(name)
            || url.searchParams.getAll(name).length !== 1)) {
          sendJson(response, 400, { error: { code: 'START_REQUEST_INVALID' } });
          record(scenario, request, 'oauth-client', 400, 'START_REQUEST_INVALID');
          return;
        }
        const scope = url.searchParams.get('scope') ?? 'project:delete';
        const projectId = url.searchParams.get('project') ?? 'p-100';
        if (!['project:delete', 'project:read'].includes(scope)
            || !/^p-[1-9][0-9]*$/u.test(projectId)) {
          sendJson(response, 400, { error: { code: 'START_REQUEST_INVALID' } });
          record(scenario, request, 'oauth-client', 400, 'START_REQUEST_INVALID');
          return;
        }
        startFlow(response, '15', scope, context, projectId);
        record(scenario, request, 'oauth-client', 302, 'AUTHORIZATION_STARTED', {
          stateGenerated: true, pkceS256: true, resourceIndicatorIncluded: true,
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/oauth/callback') {
        await oauthCallback(request, response, url, context, scenario, scenarioId);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/oidc/callback') {
        await oidcCallback(request, response, url, context, scenario, scenarioId);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/callback') {
        await apiCallback(request, response, url, context, scenario, scenarioId);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/me') {
        const raw = cookie(request, RP_SESSION_COOKIE);
        const session = canonicalOpaque(raw) ? context.appSessions.get(raw) : null;
        if (!session) {
          sendHtml(response, 403, resultPage('ログインしていません', 'not-authenticated', '有効なRP sessionがありません。'));
          record(scenario, request, 'oidc-rp', 403, 'APP_SESSION_REQUIRED', { duplicateOrMalformedRejected: true });
          return;
        }
        sendHtml(response, 200, resultPage('OIDCログイン完了', 'authenticated', '検証済みID TokenからRP sessionを発行しました。'));
        record(scenario, request, 'oidc-rp', 200, 'AUTHENTICATED_PAGE_RETURNED', { appSessionValidated: true });
        return;
      }
      sendJson(response, 404, { error: { code: 'NOT_FOUND' } });
      record(scenario, request, 'oauth-client', 404, 'NOT_FOUND');
    } catch (error) {
      const status = error instanceof LabHttpError ? error.status : 500;
      if (!response.headersSent) {
        sendJson(response, status, { error: { code: status === 500 ? 'INTERNAL_ERROR' : error.reasonCode } });
        const scenario = scenarioRegistry.fromRequest(request);
        if (scenario) record(scenario, request, 'oauth-client', status, status === 500 ? 'INTERNAL_ERROR' : error.reasonCode);
      } else if (!response.writableEnded) response.end();
    }
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  return Object.freeze({ server });
}

export const clientServerInternals = Object.freeze({
  validateIdToken,
  oidcReason,
  RP_SESSION_COOKIE,
});
