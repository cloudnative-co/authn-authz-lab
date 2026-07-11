import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createSigningKeyPair, signJwt, verifyJwt } from './jwt.js';
import { issueIdToken as buildIdToken } from './oidc.js';

const ACCESS_TOKEN_TTL_SECONDS = 600;
const AUTHORIZATION_CODE_TTL_MS = 600_000;

function parseScope(scope) {
  return scope ? scope.split(' ').filter(Boolean) : [];
}

// A fixed WWW-Authenticate challenge for an invalid access token. The JWT
// verifier's error message can echo attacker-controlled header fields (e.g. the
// `alg` value), so it must never reach a response header (RFC 6750 §3).
const INVALID_TOKEN_CHALLENGE = 'Bearer error="invalid_token", error_description="the access token is invalid"';

// Drop CR/LF and double quotes before putting any value into a header, so it
// cannot break out of the header or the quoted-string of a challenge.
function sanitizeHeaderValue(value) {
  return String(value).replace(/[\r\n"]/g, '');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function contentType(headers) {
  return (headers['content-type'] ?? '').split(';')[0].trim();
}

function parseBasicClientAuth(header = '') {
  const [scheme, token] = String(header).split(' ');
  if (scheme !== 'Basic' || !token) return null;
  const decoded = Buffer.from(token, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  // Credentials are form-urlencoded before base64 (RFC 6749 §2.3.1); reject
  // malformed percent-encoding instead of throwing.
  try {
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

function verifyPkce(verifier, challenge) {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge ?? '');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

function buildRedirect(uri, params) {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

function cacheHeaders() {
  return { 'cache-control': 'no-store', pragma: 'no-cache' };
}

function tokenSuccess(body) {
  return { status: 200, headers: cacheHeaders(), body };
}

function tokenError(status, error, description) {
  return { status, headers: cacheHeaders(), body: { error, error_description: description } };
}

// Client authenticated with the Authorization header: RFC 6749 §5.2 requires a
// 401 with a matching WWW-Authenticate challenge.
function invalidClientBasic() {
  return {
    status: 401,
    headers: { ...cacheHeaders(), 'www-authenticate': 'Basic realm="oauth-token"' },
    body: { error: 'invalid_client', error_description: 'client authentication failed' },
  };
}

// Client authenticated in the request body (client_secret_post): no HTTP auth
// scheme was used, so a plain 400 invalid_client is returned (RFC 6749 §5.2).
function invalidClientPost() {
  return {
    status: 400,
    headers: cacheHeaders(),
    body: { error: 'invalid_client', error_description: 'client authentication failed' },
  };
}

export class AuthorizationServer {
  constructor({ issuer = 'http://localhost:3000', resource, resolveUser = () => null, keyPair, now = () => Date.now() } = {}) {
    this.issuer = issuer;
    this.resource = resource ?? `${issuer}/api`;
    this.resolveUser = resolveUser;
    this.keyPair = keyPair ?? createSigningKeyPair();
    this.now = now;
    this.clients = new Map();
    this.codes = new Map();
  }

  registerClient(client) {
    this.clients.set(client.clientId, {
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUris: client.redirectUris ?? [],
      allowedScopes: client.allowedScopes ?? [],
      grantTypes: client.grantTypes ?? [],
    });
  }

  handleAuthorizationRequest(searchParams, authenticatedUserId) {
    // RFC 6749 §3.1: request parameters MUST NOT be included more than once.
    const seen = new Set();
    const duplicates = new Set();
    for (const key of searchParams.keys()) {
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    // A duplicated client_id or redirect_uri cannot be resolved to a single
    // trusted value, so refuse without redirecting (open-redirect defense).
    if (duplicates.has('client_id') || duplicates.has('redirect_uri')) {
      return { redirect: false, error: 'invalid_request', error_description: 'client_id and redirect_uri must appear once' };
    }

    const client = this.clients.get(searchParams.get('client_id'));
    if (!client) {
      return { redirect: false, error: 'invalid_request', error_description: 'unknown client_id' };
    }
    const redirectUri = searchParams.get('redirect_uri');
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      return { redirect: false, error: 'invalid_request', error_description: 'redirect_uri mismatch' };
    }

    const state = searchParams.get('state');
    const fail = (error, error_description) => ({
      redirect: true,
      location: buildRedirect(redirectUri, { error, error_description, state }),
    });

    // Any other duplicated parameter is reported to the client via redirect.
    if (duplicates.size > 0) {
      return fail('invalid_request', `duplicate parameter: ${[...duplicates][0]}`);
    }

    const responseType = searchParams.get('response_type');
    if (!responseType) {
      return fail('invalid_request', 'response_type is required');
    }
    if (responseType !== 'code') {
      return fail('unsupported_response_type', 'only response_type=code is supported');
    }
    if (searchParams.get('code_challenge_method') !== 'S256') {
      return fail('invalid_request', 'code_challenge_method must be S256');
    }
    if (!searchParams.get('code_challenge')) {
      return fail('invalid_request', 'code_challenge is required');
    }
    if (!client.grantTypes.includes('authorization_code')) {
      return fail('unauthorized_client', 'client cannot use the authorization_code grant');
    }

    const scopes = parseScope(searchParams.get('scope'));
    const invalidScope = scopes.find((scope) => !client.allowedScopes.includes(scope));
    if (invalidScope) {
      return fail('invalid_scope', `scope not allowed: ${invalidScope}`);
    }

    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, {
      clientId: client.clientId,
      userId: authenticatedUserId,
      redirectUri,
      scopes,
      codeChallenge: searchParams.get('code_challenge'),
      nonce: searchParams.get('nonce'),
      expiresAt: this.now() + AUTHORIZATION_CODE_TTL_MS,
      used: false,
    });
    return { redirect: true, location: buildRedirect(redirectUri, { code, state }) };
  }

  handleTokenRequest(headers, rawBody) {
    if (contentType(headers) !== 'application/x-www-form-urlencoded') {
      return tokenError(400, 'invalid_request', 'content-type must be application/x-www-form-urlencoded');
    }
    const params = new URLSearchParams(rawBody);
    const grantType = params.get('grant_type');
    if (!grantType) {
      return tokenError(400, 'invalid_request', 'grant_type is required');
    }

    const auth = this.authenticateClient(headers, params);
    if (auth.error) return auth.response;
    const client = auth.client;

    if (grantType === 'authorization_code') {
      return this.grantAuthorizationCode(client, params);
    }
    if (grantType === 'client_credentials') {
      return this.grantClientCredentials(client, params);
    }
    return tokenError(400, 'unsupported_grant_type', `unsupported grant_type: ${grantType}`);
  }

  authenticateClient(headers, params) {
    const authorization = headers.authorization ?? headers.Authorization;
    if (/^Basic\s/i.test(String(authorization ?? ''))) {
      const basic = parseBasicClientAuth(authorization);
      if (!basic) return { error: true, response: invalidClientBasic() };
      return this.verifyClientCredentials(basic.clientId, basic.clientSecret, 'basic');
    }
    if (params.get('client_id')) {
      return this.verifyClientCredentials(params.get('client_id'), params.get('client_secret') ?? undefined, 'post');
    }
    // No client authentication supplied; challenge with Basic.
    return { error: true, response: invalidClientBasic() };
  }

  verifyClientCredentials(clientId, clientSecret, method) {
    const reject = () => ({ error: true, response: method === 'basic' ? invalidClientBasic() : invalidClientPost() });
    const client = this.clients.get(clientId);
    if (!client) return reject();
    if (client.clientSecret && (clientSecret === undefined || !safeEqual(clientSecret, client.clientSecret))) {
      return reject();
    }
    return { client };
  }

  grantAuthorizationCode(client, params) {
    const code = params.get('code');
    const grant = code ? this.codes.get(code) : undefined;
    if (!grant) {
      return tokenError(400, 'invalid_grant', 'authorization code is invalid');
    }
    if (grant.used) {
      this.codes.delete(code);
      return tokenError(400, 'invalid_grant', 'authorization code already used');
    }
    if (grant.expiresAt <= this.now()) {
      this.codes.delete(code);
      return tokenError(400, 'invalid_grant', 'authorization code expired');
    }
    if (!client.grantTypes.includes('authorization_code')) {
      return tokenError(400, 'unauthorized_client', 'client cannot use the authorization_code grant');
    }
    if (grant.clientId !== client.clientId) {
      return tokenError(400, 'invalid_grant', 'authorization code was issued to another client');
    }
    if (grant.redirectUri !== params.get('redirect_uri')) {
      return tokenError(400, 'invalid_grant', 'redirect_uri mismatch');
    }
    if (!verifyPkce(params.get('code_verifier'), grant.codeChallenge)) {
      return tokenError(400, 'invalid_grant', 'PKCE verification failed');
    }

    grant.used = true;
    this.codes.delete(code);

    const body = {
      access_token: this.issueAccessToken({ subject: grant.userId, clientId: client.clientId, scopes: grant.scopes }),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: grant.scopes.join(' '),
    };
    if (grant.scopes.includes('openid')) {
      body.id_token = buildIdToken({
        user: this.resolveUser(grant.userId),
        clientId: client.clientId,
        nonce: grant.nonce,
        issuer: this.issuer,
        keyPair: this.keyPair,
        now: this.now(),
      });
    }
    return tokenSuccess(body);
  }

  grantClientCredentials(client, params) {
    if (!client.grantTypes.includes('client_credentials')) {
      return tokenError(400, 'unauthorized_client', 'client cannot use the client_credentials grant');
    }
    const requested = parseScope(params.get('scope'));
    let scopes;
    if (requested.length === 0) {
      scopes = [...client.allowedScopes];
    } else {
      const invalidScope = requested.find((scope) => !client.allowedScopes.includes(scope));
      if (invalidScope) {
        return tokenError(400, 'invalid_scope', `scope not allowed: ${invalidScope}`);
      }
      scopes = requested;
    }
    return tokenSuccess({
      access_token: this.issueAccessToken({ subject: client.clientId, clientId: client.clientId, scopes }),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(' '),
    });
  }

  issueAccessToken({ subject, clientId, scopes }) {
    const issuedAt = Math.floor(this.now() / 1000);
    const payload = {
      iss: this.issuer,
      sub: subject,
      aud: this.resource,
      client_id: clientId,
      iat: issuedAt,
      exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
      jti: randomBytes(16).toString('hex'),
      scope: scopes.join(' '),
    };
    return signJwt(payload, this.keyPair.privateKey, { kid: this.keyPair.kid, typ: 'at+jwt' });
  }

  verifyAccessToken(token) {
    return verifyJwt(token, (header) => (header.kid === this.keyPair.kid ? this.keyPair.publicKey : null), {
      expectedTyp: 'at+jwt',
      now: this.now(),
    });
  }

  authenticateBearer(headers, requiredScope) {
    const header = headers.authorization ?? headers.Authorization;
    if (!header || !/^Bearer\s+/i.test(header)) {
      return { ok: false, status: 401, wwwAuthenticate: 'Bearer', error: null };
    }
    const token = header.replace(/^Bearer\s+/i, '');
    let payload;
    try {
      payload = this.verifyAccessToken(token).payload;
    } catch {
      // The verifier's message is intentionally discarded here (it can contain
      // attacker-controlled bytes); the fixed challenge is safe to send.
      return { ok: false, status: 401, wwwAuthenticate: INVALID_TOKEN_CHALLENGE, error: 'invalid_token' };
    }
    if (payload.aud !== this.resource) {
      return { ok: false, status: 401, wwwAuthenticate: INVALID_TOKEN_CHALLENGE, error: 'invalid_token' };
    }
    if (requiredScope && !parseScope(payload.scope).includes(requiredScope)) {
      return {
        ok: false,
        status: 403,
        wwwAuthenticate: `Bearer error="insufficient_scope", scope="${sanitizeHeaderValue(requiredScope)}"`,
        error: 'insufficient_scope',
      };
    }
    return { ok: true, payload };
  }

  handleIntrospectionRequest(headers, rawBody) {
    if (contentType(headers) !== 'application/x-www-form-urlencoded') {
      return { status: 400, headers: cacheHeaders(), body: { error: 'invalid_request' } };
    }
    const params = new URLSearchParams(rawBody);
    const auth = this.authenticateClient(headers, params);
    if (auth.error) return auth.response;

    const inactive = { status: 200, headers: cacheHeaders(), body: { active: false } };
    const token = params.get('token');
    if (!token) return inactive;

    let payload;
    try {
      payload = this.verifyAccessToken(token).payload;
    } catch {
      return inactive;
    }
    return {
      status: 200,
      headers: cacheHeaders(),
      body: {
        active: true,
        scope: payload.scope,
        client_id: payload.client_id,
        sub: payload.sub,
        aud: payload.aud,
        exp: payload.exp,
        iat: payload.iat,
        iss: payload.iss,
        jti: payload.jti,
        token_type: 'Bearer',
      },
    };
  }
}
