import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { canonicalOpaque, canonicalVerifier, digest, pkceChallenge, randomOpaque, safeEqual } from './crypto.mjs';
import { createDigestStore } from './digest-store.mjs';
import {
  cookie,
  escapeHtml,
  exactSingle,
  LabHttpError,
  readForm,
  redirect,
  requestUrl,
  sendHtml,
  sendJson,
  setCookie,
} from './http.mjs';

const AUTH_REQUEST_TTL = 5 * 60_000;
const SESSION_TTL = 10 * 60_000;
const CODE_TTL = 90_000;
const ACCESS_TOKEN_TTL_SECONDS = 300;
const AS_SESSION_COOKIE = 'course_as_session';
const REQUIRED_AUTHORIZE_FIELDS = [
  'response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method',
];

function scopes(value, supported) {
  if (typeof value !== 'string' || value.length > 512) return null;
  const result = value.split(' ').filter(Boolean);
  if (result.length === 0 || new Set(result).size !== result.length) return null;
  return result.every((item) => supported.includes(item)) ? result : null;
}

function invalidAuthorize(error = 'invalid_request', context = {}) {
  return Object.freeze({ ok: false, error, ...context });
}

function validateAuthorizationRequest(params, config) {
  if (params.getAll('client_id').length !== 1 || params.getAll('redirect_uri').length !== 1) {
    return invalidAuthorize();
  }
  const clientId = exactSingle(params, 'client_id');
  const redirectUri = exactSingle(params, 'redirect_uri');
  if (clientId !== config.clientId) return invalidAuthorize();
  if (![config.oauthRedirectUri, config.oidcRedirectUri, config.apiRedirectUri].includes(redirectUri)) {
    return invalidAuthorize();
  }
  const state = exactSingle(params, 'state');
  const errorContext = {
    redirectUri,
    state: canonicalOpaque(state) ? state : null,
    redirect: true,
  };
  for (const name of params.keys()) {
    if (params.getAll(name).length !== 1) return invalidAuthorize('invalid_request', errorContext);
  }
  if (exactSingle(params, 'response_type') !== 'code') {
    return invalidAuthorize('unsupported_response_type', errorContext);
  }
  const challenge = exactSingle(params, 'code_challenge');
  const requestedScopes = scopes(exactSingle(params, 'scope'), config.supportedScopes);
  if (
    REQUIRED_AUTHORIZE_FIELDS.some((field) => !exactSingle(params, field))
    || exactSingle(params, 'code_challenge_method') !== 'S256'
    || !canonicalOpaque(state)
    || !/^[A-Za-z0-9_-]{43}$/u.test(challenge ?? '')
  ) return invalidAuthorize('invalid_request', errorContext);
  if (!requestedScopes) return invalidAuthorize('invalid_scope', errorContext);
  const isOidc = requestedScopes.includes('openid');
  const nonce = params.get('nonce');
  if (isOidc !== (redirectUri === config.oidcRedirectUri)) {
    return invalidAuthorize('invalid_scope', errorContext);
  }
  if (isOidc && !canonicalOpaque(nonce)) return invalidAuthorize('invalid_request', errorContext);
  if (!isOidc && params.has('nonce')) return invalidAuthorize('invalid_request', errorContext);
  const resources = params.getAll('resource');
  const isApiAccess = redirectUri === config.apiRedirectUri;
  if (resources.length > 1 || (isApiAccess && resources[0] !== config.audience)) {
    return invalidAuthorize('invalid_target', errorContext);
  }
  if (isApiAccess !== (resources.length === 1)) {
    return invalidAuthorize('invalid_target', errorContext);
  }
  return Object.freeze({
    ok: true,
    clientId,
    redirectUri,
    state,
    challenge,
    scopes: requestedScopes,
    nonce: isOidc ? nonce : null,
    resource: isApiAccess ? resources[0] : null,
  });
}

function oauthError(response, status, error) {
  sendJson(response, status, { error }, { 'cache-control': 'no-store', pragma: 'no-cache' });
}

function basicCredential(header) {
  if (typeof header !== 'string' || header.length > 4096
      || !/^Basic [A-Za-z0-9+/]+={0,2}$/u.test(header)) return null;
  const token = header.slice(6);
  const decoded = Buffer.from(token, 'base64').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('base64') !== token) return null;
  const separator = decoded.indexOf(':');
  if (separator < 1) return null;
  return { id: decoded.slice(0, separator), secret: decoded.slice(separator + 1) };
}

function loginPage(requestReference) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>認可サーバーでログイン</title>
  <h1>認可サーバーでログイン</h1><p>パスワードはClientではなく、このAuthorization Serverへだけ送信されます。</p>
  <form method="post" action="/interaction/login"><input type="hidden" name="ref" value="${escapeHtml(requestReference)}">
  <label>ID <input name="identifier" autocomplete="username" required></label>
  <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">ログイン</button></form></html>`;
}

function consentPage(requestReference, requestedScopes) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>権限の確認</title>
  <h1>Clientに許可する範囲</h1><p>${escapeHtml(requestedScopes.join(' '))}</p>
  <form method="post" action="/interaction/consent"><input type="hidden" name="ref" value="${escapeHtml(requestReference)}">
  <button name="decision" value="allow" type="submit">許可する</button>
  <button name="decision" value="deny" type="submit">拒否する</button></form></html>`;
}

async function buildSigningKeys() {
  const primary = await generateKeyPair('RS256', { extractable: true, modulusLength: 2048 });
  const attacker = await generateKeyPair('RS256', { extractable: true, modulusLength: 2048 });
  const publicJwk = await exportJWK(primary.publicKey);
  return Object.freeze({
    primary,
    attacker,
    publicJwk: Object.freeze({ ...publicJwk, alg: 'RS256', use: 'sig', kid: 'course-op-rs256-1' }),
  });
}

async function issueIdToken({ config, keys, subject, nonce, scopes: grantedScopes, nowSeconds, fault }) {
  if (fault === 'access-token') return null;
  const issuer = fault === 'issuer' ? 'http://127.0.0.1:4999' : config.issuer;
  const audience = fault === 'audience' ? 'other-client' : config.clientId;
  const tokenNonce = fault === 'nonce' ? randomOpaque() : nonce;
  const issuedAt = fault === 'expiry' ? nowSeconds - 60 : nowSeconds;
  const expiration = fault === 'expiry' ? nowSeconds - 1 : nowSeconds + 120;
  const tokenSubject = fault === 'subject' ? '' : subject;
  const privateKey = fault === 'signature' ? keys.attacker.privateKey : keys.primary.privateKey;
  const claims = grantedScopes.includes('email')
    ? { nonce: tokenNonce, email: 'learner@example.test' }
    : { nonce: tokenNonce };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'course-op-rs256-1' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(tokenSubject)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiration)
    .sign(privateKey);
}

async function issueAccessToken({ config, keys, grant, nowSeconds, fault }) {
  if (fault === 'malformed') return randomOpaque();
  if (fault === 'id-token') {
    return issueIdToken({
      config,
      keys,
      subject: grant.subject,
      nonce: randomOpaque(),
      scopes: ['openid'],
      nowSeconds,
      fault: null,
    });
  }
  const claims = {};
  if (fault !== 'missing-client-id') {
    claims.client_id = fault === 'wrong-client-id' ? 'unregistered-client' : grant.clientId;
  }
  if (fault !== 'missing-scope') claims.scope = grant.scopes.join(' ');
  if (fault !== 'missing-jti') claims.jti = randomOpaque();
  const token = new SignJWT(claims)
    .setProtectedHeader({
      alg: 'RS256',
      typ: fault === 'wrong-typ' ? 'JWT' : 'at+jwt',
      kid: 'course-op-rs256-1',
    })
    .setIssuer(fault === 'issuer' ? 'http://127.0.0.1:4999' : config.issuer)
    .setAudience(fault === 'audience' ? config.clientId : grant.resource)
    .setExpirationTime(fault === 'expiry' ? nowSeconds - 60 : nowSeconds + ACCESS_TOKEN_TTL_SECONDS);
  if (fault !== 'missing-sub') token.setSubject(grant.subject);
  if (fault !== 'missing-iat') token.setIssuedAt(nowSeconds);
  return token.sign(fault === 'signature' ? keys.attacker.privateKey : keys.primary.privateKey);
}

export async function createAuthorizationServer({
  config,
  evidence,
  authenticate,
  resourceSecret,
  now = () => Date.now(),
  idTokenFaultQueue = [],
  control = null,
  scenarioRegistry,
} = {}) {
  if (!config || typeof authenticate !== 'function' || !scenarioRegistry) throw new TypeError('AS dependencies are required');
  const keys = await buildSigningKeys();
  const contexts = new WeakMap();
  function contextFor(scenario) {
    let context = contexts.get(scenario);
    if (!context) {
      context = {
        pendingRequests: createDigestStore({ limit: 128, now }),
        sessions: createDigestStore({ limit: 64, now }),
        codes: createDigestStore({ limit: 128, now }),
        tokens: createDigestStore({ limit: 256, now }),
        faults: [...(scenario.idTokenFaultQueue.length > 0
          ? scenario.idTokenFaultQueue : idTokenFaultQueue)],
        accessTokenFaults: [...(scenario.accessTokenFaultQueue ?? [])],
      };
      contexts.set(scenario, context);
    }
    return context;
  }

  function record(scenario, request, status, reason, checks = {}) {
    scenario.evidence.record({
      role: 'authorization-server', origin: config.issuer, method: request.method, path: new URL(request.url, config.issuer).pathname,
      status, reason, checks,
    });
  }

  function activeSubject(request, context) {
    const raw = cookie(request, AS_SESSION_COOKIE);
    if (!canonicalOpaque(raw)) return null;
    return context.sessions.get(raw)?.subject ?? null;
  }

  function beginAuthorization(params, context) {
    const validated = validateAuthorizationRequest(params, config);
    if (!validated.ok) return validated;
    const reference = randomOpaque();
    context.pendingRequests.set(reference, validated, AUTH_REQUEST_TTL);
    return { ok: true, reference, request: validated };
  }

  function authorizationRedirect(grant, additions) {
    const target = new URL(grant.redirectUri);
    for (const [name, value] of Object.entries({ ...additions, state: grant.state, iss: config.issuer })) {
      target.searchParams.set(name, value);
    }
    return target.toString();
  }

  function showInteraction(request, response, reference, context, observe) {
    const pending = canonicalOpaque(reference) ? context.pendingRequests.get(reference) : null;
    if (!pending) {
      oauthError(response, 400, 'invalid_request');
      observe(400, 'INTERACTION_REFERENCE_REJECTED', { oauthParameter: false });
      return;
    }
    const subject = activeSubject(request, context);
    if (!subject) {
      sendHtml(response, 200, loginPage(reference));
      observe(200, 'RESOURCE_OWNER_LOGIN_REQUIRED', {
        clientPasswordAbsent: true, internalInteraction: true,
      });
      return;
    }
    sendHtml(response, 200, consentPage(reference, pending.scopes));
    observe(200, 'CONSENT_REQUIRED', {
      authenticatedResourceOwner: true, internalInteraction: true,
    });
  }

  async function tokenResponse(form, context) {
    const required = ['grant_type', 'code', 'redirect_uri', 'client_id', 'code_verifier'];
    if ([...form.keys()].some((name) => form.getAll(name).length !== 1)
        || required.some((name) => !exactSingle(form, name))
        || exactSingle(form, 'grant_type') !== 'authorization_code'
        || exactSingle(form, 'client_id') !== config.clientId
        || form.has('state')) {
      return { status: 400, body: { error: 'invalid_request' } };
    }
    const rawCode = form.get('code');
    const verifier = form.get('code_verifier');
    if (!canonicalOpaque(rawCode) || !canonicalVerifier(verifier)) {
      if (canonicalOpaque(rawCode)) context.codes.take(rawCode);
      return { status: 400, body: { error: 'invalid_grant' } };
    }
    const grant = context.codes.take(rawCode);
    const verifierMatches = grant && safeEqual(pkceChallenge(verifier), grant.challenge);
    if (!grant
        || grant.clientId !== form.get('client_id')
        || grant.redirectUri !== form.get('redirect_uri')
        || !verifierMatches) {
      return { status: 400, body: { error: 'invalid_grant' } };
    }
    const expectedFields = new Set([...required, ...(grant.resource ? ['resource'] : [])]);
    if ([...form.keys()].some((name) => !expectedFields.has(name))
        || (grant.resource && exactSingle(form, 'resource') !== grant.resource)
        || (!grant.resource && form.has('resource'))) {
      return { status: 400, body: { error: grant.resource ? 'invalid_target' : 'invalid_request' } };
    }
    const nowSeconds = Math.floor(now() / 1000);
    const fault = grant.resource && context.accessTokenFaults.length > 0
      ? context.accessTokenFaults.shift() : null;
    const rawAccessToken = grant.resource
      ? await issueAccessToken({ config, keys, grant, nowSeconds, fault })
      : randomOpaque();
    if (!grant.resource) {
      context.tokens.set(rawAccessToken, {
        clientId: grant.clientId,
        subject: grant.subject,
        scopes: grant.scopes,
        audience: config.audience,
        issuedAt: nowSeconds,
        expiresAt: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
      }, ACCESS_TOKEN_TTL_SECONDS * 1000);
    }
    const body = {
      access_token: rawAccessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: grant.scopes.join(' '),
    };
    if (grant.scopes.includes('openid')) {
      const fault = context.faults.length > 0 ? context.faults.shift() : null;
      const idToken = await issueIdToken({
        config, keys, subject: grant.subject, nonce: grant.nonce, scopes: grant.scopes, nowSeconds, fault,
      });
      body.id_token = fault === 'access-token' ? rawAccessToken : idToken;
    }
    return { status: 200, body };
  }

  async function handler(request, response) {
    let url;
    try {
      url = requestUrl(request, config.issuer);
      if (control && request.method === 'GET' && url.pathname === '/__course/health' && !url.search) {
        sendJson(response, 200, control.identity);
        return;
      }
      if (control && request.method === 'POST' && url.pathname === '/__course/shutdown' && !url.search) {
        const instanceIds = request.headersDistinct?.['x-course-instance-id']
          ?? (request.headers['x-course-instance-id'] === undefined ? [] : [request.headers['x-course-instance-id']]);
        const tokens = request.headersDistinct?.['x-course-control-token']
          ?? (request.headers['x-course-control-token'] === undefined ? [] : [request.headers['x-course-control-token']]);
        const authorized = instanceIds.length === 1
          && tokens.length === 1
          && instanceIds[0] === control.identity.instanceId
          && safeEqual(digest(tokens[0]), digest(control.shutdownToken));
        if (!authorized) {
          sendJson(response, 403, { error: { code: 'SHUTDOWN_FORBIDDEN' } });
          return;
        }
        response.statusCode = 202;
        response.setHeader('cache-control', 'no-store');
        response.setHeader('content-length', '0');
        response.setHeader('x-course-instance-id', control.identity.instanceId);
        response.once('finish', () => setImmediate(async () => {
          try {
            await control.onShutdown();
          } catch {
            process.exitCode = 1;
          }
        }));
        response.end();
        return;
      }
      const controlAuthorized = () => {
        const instanceIds = request.headersDistinct?.['x-course-instance-id']
          ?? (request.headers['x-course-instance-id'] === undefined ? [] : [request.headers['x-course-instance-id']]);
        const tokens = request.headersDistinct?.['x-course-control-token']
          ?? (request.headers['x-course-control-token'] === undefined ? [] : [request.headers['x-course-control-token']]);
        return Boolean(control) && instanceIds.length === 1 && tokens.length === 1
          && instanceIds[0] === control.identity.instanceId
          && safeEqual(digest(tokens[0]), digest(control.shutdownToken));
      };
      if (url.pathname === '/__course/scenarios' && !url.search
          && ['POST', 'GET', 'DELETE'].includes(request.method)) {
        if (!controlAuthorized()) {
          sendJson(response, 403, { error: { code: 'SCENARIO_CONTROL_FORBIDDEN' } });
          return;
        }
        if (request.method === 'POST') {
          const form = await readForm(request);
          const profile = exactSingle(form, 'profile');
          const scenarioId = scenarioRegistry.create(profile);
          sendJson(response, 201, { scenario_id: scenarioId });
          return;
        }
        const scenarioId = request.headers['x-course-scenario-id'];
        const scenario = scenarioRegistry.get(scenarioId);
        if (!scenario) {
          sendJson(response, 404, { error: { code: 'SCENARIO_NOT_FOUND' } });
          return;
        }
        if (request.method === 'GET') {
          sendJson(response, 200, { events: scenario.evidence.snapshot() });
          return;
        }
        scenarioRegistry.remove(scenarioId);
        response.statusCode = 204;
        response.setHeader('cache-control', 'no-store');
        response.setHeader('content-length', '0');
        response.end();
        return;
      }
      const scenario = scenarioRegistry.fromRequest(request);
      if (!scenario) {
        sendJson(response, 400, { error: 'invalid_request' });
        return;
      }
      const context = contextFor(scenario);
      const observe = (status, reason, checks = {}) => record(scenario, request, status, reason, checks);
      if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
        sendJson(response, 200, {
          issuer: config.issuer,
          authorization_endpoint: `${config.issuer}/oauth/authorize`,
          token_endpoint: `${config.issuer}/oauth/token`,
          jwks_uri: `${config.issuer}/oauth/jwks`,
          introspection_endpoint: `${config.issuer}/oauth/introspect`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          scopes_supported: config.supportedScopes,
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code'],
          token_endpoint_auth_methods_supported: ['none'],
          authorization_response_iss_parameter_supported: true,
        });
        observe(200, 'DISCOVERY_RETURNED', { fixedIssuer: true });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/oauth/jwks') {
        sendJson(response, 200, { keys: [keys.publicJwk] });
        observe(200, 'JWKS_RETURNED', { publicKeyOnly: true });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/oauth/authorize') {
        const started = beginAuthorization(url.searchParams, context);
        if (!started.ok || !started.request || !canonicalOpaque(started.reference)) {
          if (started.redirect && started.redirectUri) {
            const target = new URL(started.redirectUri);
            target.searchParams.set('error', started.error ?? 'invalid_request');
            if (started.state) target.searchParams.set('state', started.state);
            target.searchParams.set('iss', config.issuer);
            redirect(response, target.toString());
            observe(302, 'AUTHORIZATION_ERROR_REDIRECTED', {
              trustedRedirect: true, issuerIncluded: true,
            });
            return;
          }
          oauthError(response, 400, started.error ?? 'invalid_request');
          observe(400, 'AUTHORIZATION_REQUEST_REJECTED', { redirected: false });
          return;
        }
        showInteraction(request, response, started.reference, context, observe);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/interaction/resume') {
        const reference = url.searchParams.size === 1 ? exactSingle(url.searchParams, 'ref') : null;
        showInteraction(request, response, reference, context, observe);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/interaction/login') {
        const form = await readForm(request);
        const reference = exactSingle(form, 'ref');
        const pending = canonicalOpaque(reference) ? context.pendingRequests.get(reference) : null;
        const result = pending && await authenticate(exactSingle(form, 'identifier'), exactSingle(form, 'password'));
        if (!pending || !result?.ok) {
          sendHtml(response, 403, '<!doctype html><html lang="ja"><h1>ログインできませんでした</h1></html>');
          observe(403, 'RESOURCE_OWNER_LOGIN_REJECTED', { genericFailure: true });
          return;
        }
        const session = randomOpaque();
        context.sessions.set(session, {
          subject: typeof result.subject === 'string' && result.subject.length > 0
            ? result.subject
            : 'sub-7f4b92d8e31a6c05',
        }, SESSION_TTL);
        redirect(response, `${config.issuer}/interaction/resume?ref=${encodeURIComponent(reference)}`, {
          'set-cookie': setCookie(AS_SESSION_COOKIE, session),
        });
        observe(302, 'RESOURCE_OWNER_AUTHENTICATED', { passwordReceivedByAsOnly: true });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/interaction/consent') {
        const form = await readForm(request);
        const reference = exactSingle(form, 'ref');
        const grant = canonicalOpaque(reference) ? context.pendingRequests.take(reference) : null;
        const subject = activeSubject(request, context);
        const decision = exactSingle(form, 'decision');
        if (!grant || !subject || !['allow', 'deny'].includes(decision)) {
          oauthError(response, 400, 'invalid_request');
          observe(400, 'CONSENT_REQUEST_REJECTED', { consumed: Boolean(grant) });
          return;
        }
        if (decision === 'deny') {
          redirect(response, authorizationRedirect(grant, { error: 'access_denied' }));
          observe(302, 'CONSENT_DENIED', { issuerIncluded: true });
          return;
        }
        const code = randomOpaque();
        context.codes.set(code, { ...grant, subject }, CODE_TTL);
        redirect(response, authorizationRedirect(grant, { code }));
        observe(302, 'AUTHORIZATION_CODE_ISSUED', {
          exactRedirect: true, pkceBound: true, oneTime: true, issuerIncluded: true,
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/oauth/token') {
        const authorizations = request.headersDistinct?.authorization
          ?? (request.headers.authorization === undefined ? [] : [request.headers.authorization]);
        if (authorizations.length > 0) {
          oauthError(response, 400, 'invalid_request');
          observe(400, 'TOKEN_CLIENT_AUTH_REJECTED', { publicClient: true });
          return;
        }
        const form = await readForm(request);
        const result = await tokenResponse(form, context);
        sendJson(response, result.status, result.body);
        observe(result.status, result.status === 200 ? 'TOKEN_ISSUED' : 'TOKEN_REQUEST_REJECTED', {
          formEncoded: true, stateAbsent: !form.has('state'),
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/oauth/introspect') {
        const authorizations = request.headersDistinct?.authorization
          ?? (request.headers.authorization === undefined ? [] : [request.headers.authorization]);
        const credentials = authorizations.length === 1 ? basicCredential(authorizations[0]) : null;
        const authenticated = credentials?.id === config.resourceId
          && safeEqual(digest(credentials.secret), digest(resourceSecret));
        if (!authenticated) {
          sendJson(response, 401, { error: 'invalid_client' }, {
            'www-authenticate': 'Basic realm="lesson-10-introspection"',
          });
          observe(401, 'INTROSPECTION_CLIENT_REJECTED', { authenticated: false });
          return;
        }
        const form = await readForm(request);
        const token = exactSingle(form, 'token');
        const metadata = canonicalOpaque(token) ? context.tokens.get(token) : null;
        if (!metadata || metadata.expiresAt <= Math.floor(now() / 1000)) {
          sendJson(response, 200, { active: false });
          observe(200, 'TOKEN_INACTIVE', { authenticated: true, active: false });
          return;
        }
        sendJson(response, 200, {
          active: true,
          client_id: metadata.clientId,
          scope: metadata.scopes.join(' '),
          token_type: 'Bearer',
          exp: metadata.expiresAt,
          iat: metadata.issuedAt,
          sub: metadata.subject,
          aud: metadata.audience,
        });
        observe(200, 'TOKEN_ACTIVE', { authenticated: true, active: true });
        return;
      }
      sendJson(response, 404, { error: 'not_found' });
      observe(404, 'NOT_FOUND');
    } catch (error) {
      const status = error instanceof LabHttpError ? error.status : 500;
      const reason = error instanceof LabHttpError ? error.reasonCode : 'INTERNAL_ERROR';
      const scenario = scenarioRegistry.fromRequest(request);
      if (scenario) record(scenario, request, status, reason);
      if (!response.headersSent) {
        sendJson(response, status, { error: status === 500 ? 'server_error' : 'invalid_request' });
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  }

  const server = createServer(handler);
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  return Object.freeze({ server });
}

export const authorizationServerInternals = Object.freeze({
  validateAuthorizationRequest,
  AS_SESSION_COOKIE,
});
