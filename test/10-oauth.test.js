import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  authorizeForCode,
  codeFromAuthorize,
  decodeJwtPart,
  exchangeAuthorizationCode,
  form,
  login,
  pkcePair,
  startTestServer,
  WEB_APP_REDIRECT_URI,
} from '../test-support/http.js';

let server;
let baseUrl;

before(async () => {
  ({ server, baseUrl } = await startTestServer());
});

after(() => {
  server.close();
});

test('10 authorization code with PKCE is exchanged for a JWT access token', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { verifier, challenge } = pkcePair();
  const authRes = await authorizeForCode(baseUrl, cookie, { challenge, scope: 'project:read', state: 'xyz-123' });
  assert.equal(authRes.status, 302);

  const location = new URL(authRes.headers.get('location'));
  assert.equal(location.origin + location.pathname, WEB_APP_REDIRECT_URI);
  assert.equal(location.searchParams.get('state'), 'xyz-123');
  const code = location.searchParams.get('code');
  assert.ok(code);

  const tokenRes = await exchangeAuthorizationCode(baseUrl, { code, verifier });
  assert.equal(tokenRes.status, 200);
  assert.equal(tokenRes.headers.get('cache-control'), 'no-store');

  const body = await tokenRes.json();
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.scope, 'project:read');
  assert.equal(typeof body.expires_in, 'number');

  const header = decodeJwtPart(body.access_token, 0);
  assert.deepEqual(header, { alg: 'RS256', typ: 'at+jwt', kid: header.kid });
  assert.ok(header.kid);

  const payload = decodeJwtPart(body.access_token, 1);
  assert.equal(payload.sub, 'user_alice');
  assert.equal(payload.client_id, 'web-app');
  assert.equal(payload.scope, 'project:read');
  assert.equal(payload.iss, baseUrl);
  assert.equal(payload.aud, `${baseUrl}/api`);
  assert.equal(typeof payload.exp, 'number');
  assert.equal(typeof payload.iat, 'number');
  assert.ok(payload.jti);
});

test('10 mismatched PKCE verifier is rejected with invalid_grant', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { challenge } = pkcePair();
  const code = await codeFromAuthorize(baseUrl, cookie, { challenge, scope: 'project:read' });

  const tokenRes = await exchangeAuthorizationCode(baseUrl, { code, verifier: randomBytes(32).toString('base64url') });
  assert.equal(tokenRes.status, 400);
  assert.equal((await tokenRes.json()).error, 'invalid_grant');
});

test('10 authorization code cannot be replayed', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { verifier, challenge } = pkcePair();
  const code = await codeFromAuthorize(baseUrl, cookie, { challenge, scope: 'project:read' });

  const first = await exchangeAuthorizationCode(baseUrl, { code, verifier });
  assert.equal(first.status, 200);

  const second = await exchangeAuthorizationCode(baseUrl, { code, verifier });
  assert.equal(second.status, 400);
  assert.equal((await second.json()).error, 'invalid_grant');
});

test('10 token endpoint rejects a JSON body', async () => {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_request');
});

test('10 token endpoint requires grant_type', async () => {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: 'web-app', client_secret: 'web-app-secret' }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_request');
});

test('10 authorization request rejects an unregistered redirect_uri without redirecting', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { challenge } = pkcePair();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'web-app',
    redirect_uri: 'http://evil.example/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'project:read',
  });
  const res = await fetch(`${baseUrl}/oauth/authorize?${params}`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_request');
});

test('10 the bearer access token grants access to the protected resource', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { verifier, challenge } = pkcePair();
  const code = await codeFromAuthorize(baseUrl, cookie, { challenge, scope: 'project:read' });
  const { access_token } = await (await exchangeAuthorizationCode(baseUrl, { code, verifier })).json();

  const authorized = await fetch(`${baseUrl}/reports/projects`, { headers: { authorization: `Bearer ${access_token}` } });
  assert.equal(authorized.status, 200);
  assert.ok(Array.isArray((await authorized.json()).projects));

  const anonymous = await fetch(`${baseUrl}/reports/projects`);
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get('www-authenticate'), /Bearer/);
});

async function authorize(cookie, query) {
  return fetch(`${baseUrl}/oauth/authorize?${query}`, { headers: { cookie }, redirect: 'manual' });
}

test('10 authorization request rejects a duplicated client_id without redirecting', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { challenge } = pkcePair();
  const query = `response_type=code&client_id=web-app&client_id=web-app&redirect_uri=${encodeURIComponent(WEB_APP_REDIRECT_URI)}&code_challenge=${challenge}&code_challenge_method=S256&scope=project:read`;
  const res = await authorize(cookie, query);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_request');
});

test('10 authorization request reports a duplicated parameter via redirect', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { challenge } = pkcePair();
  const query = `response_type=code&client_id=web-app&redirect_uri=${encodeURIComponent(WEB_APP_REDIRECT_URI)}&code_challenge=${challenge}&code_challenge_method=S256&scope=project:read&scope=openid`;
  const res = await authorize(cookie, query);
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get('location')).searchParams.get('error'), 'invalid_request');
});

test('10 authorization request requires response_type', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { challenge } = pkcePair();
  const query = `client_id=web-app&redirect_uri=${encodeURIComponent(WEB_APP_REDIRECT_URI)}&code_challenge=${challenge}&code_challenge_method=S256&scope=project:read`;
  const res = await authorize(cookie, query);
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get('location')).searchParams.get('error'), 'invalid_request');
});

test('10 authorization request rejects an unsupported response_type', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { challenge } = pkcePair();
  const query = `response_type=token&client_id=web-app&redirect_uri=${encodeURIComponent(WEB_APP_REDIRECT_URI)}&code_challenge=${challenge}&code_challenge_method=S256&scope=project:read`;
  const res = await authorize(cookie, query);
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get('location')).searchParams.get('error'), 'unsupported_response_type');
});
