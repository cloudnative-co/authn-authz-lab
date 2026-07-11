import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  codeFromAuthorize,
  decodeJwtPart,
  exchangeAuthorizationCode,
  form,
  login,
  pkcePair,
  startTestServer,
} from '../test-support/http.js';

let server;
let baseUrl;

const REPORT_APP_BASIC = `Basic ${Buffer.from('report-app:report-app-secret').toString('base64')}`;

before(async () => {
  ({ server, baseUrl } = await startTestServer());
});

after(() => {
  server.close();
});

async function machineToken(scope = 'project:read') {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'client_credentials', client_id: 'report-app', client_secret: 'report-app-secret', scope }),
  });
  return res;
}

test('15 client credentials issues an at+jwt access token whose subject is the client', async () => {
  const res = await machineToken();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.scope, 'project:read');

  const header = decodeJwtPart(body.access_token, 0);
  assert.equal(header.typ, 'at+jwt');
  assert.equal(header.alg, 'RS256');

  const payload = decodeJwtPart(body.access_token, 1);
  assert.equal(payload.sub, 'report-app');
  assert.equal(payload.client_id, 'report-app');
  assert.equal(payload.scope, 'project:read');
});

test('15 the token endpoint accepts client_secret_basic authentication', async () => {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: REPORT_APP_BASIC },
    body: form({ grant_type: 'client_credentials', scope: 'project:read' }),
  });
  assert.equal(res.status, 200);
});

test('15 a confidential client authentication failure returns 401 invalid_client', async () => {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'client_credentials', client_id: 'report-app', client_secret: 'wrong-secret', scope: 'project:read' }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('www-authenticate'), 'Basic realm="oauth-token"');
  assert.equal((await res.json()).error, 'invalid_client');
});

test('15 introspection reports an active token with its metadata', async () => {
  const { access_token } = await (await machineToken()).json();
  const res = await fetch(`${baseUrl}/oauth/introspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: REPORT_APP_BASIC },
    body: form({ token: access_token }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.active, true);
  assert.equal(body.client_id, 'report-app');
  assert.equal(body.sub, 'report-app');
  assert.equal(body.scope, 'project:read');
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.iss, baseUrl);
  assert.ok(body.exp && body.iat && body.jti);
});

test('15 introspection hides the details of an invalid token', async () => {
  const res = await fetch(`${baseUrl}/oauth/introspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: REPORT_APP_BASIC },
    body: form({ token: 'not-a-real-token' }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { active: false });
});

test('15 introspection requires client authentication', async () => {
  const res = await fetch(`${baseUrl}/oauth/introspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ token: 'whatever' }),
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'invalid_client');
});

test('15 a bearer token without the required scope is rejected with 403 insufficient_scope', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { verifier, challenge } = pkcePair();
  const code = await codeFromAuthorize(baseUrl, cookie, { challenge, scope: 'openid' });
  const { access_token } = await (await exchangeAuthorizationCode(baseUrl, { code, verifier })).json();

  const res = await fetch(`${baseUrl}/reports/projects`, { headers: { authorization: `Bearer ${access_token}` } });
  assert.equal(res.status, 403);
  assert.match(res.headers.get('www-authenticate'), /insufficient_scope/);
});
