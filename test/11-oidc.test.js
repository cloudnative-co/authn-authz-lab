import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { after, before, test } from 'node:test';
import { base64UrlEncode, verifyJwt } from '../src/auth/jwt.js';
import { codeFromAuthorize, exchangeAuthorizationCode, login, pkcePair, startTestServer } from '../test-support/http.js';

let server;
let baseUrl;

before(async () => {
  ({ server, baseUrl } = await startTestServer());
});

after(() => {
  server.close();
});

const REQUIRED_METADATA = [
  'issuer',
  'authorization_endpoint',
  'token_endpoint',
  'jwks_uri',
  'response_types_supported',
  'subject_types_supported',
  'id_token_signing_alg_values_supported',
];

test('11 discovery document exposes the required OIDC metadata', async () => {
  const res = await fetch(`${baseUrl}/.well-known/openid-configuration`);
  assert.equal(res.status, 200);
  const doc = await res.json();

  assert.equal(doc.issuer, baseUrl);
  for (const field of REQUIRED_METADATA) {
    assert.ok(doc[field], `missing required metadata: ${field}`);
  }
  assert.deepEqual(doc.response_types_supported, ['code']);
  assert.deepEqual(doc.subject_types_supported, ['public']);
  assert.ok(doc.id_token_signing_alg_values_supported.includes('RS256'));
  assert.deepEqual(doc.code_challenge_methods_supported, ['S256']);
  assert.equal(doc.jwks_uri, `${baseUrl}/oauth/jwks`);
});

test('11 an id token is issued and verifies against the published JWKS', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { verifier, challenge } = pkcePair();
  const nonce = 'nonce-abc-789';
  const code = await codeFromAuthorize(baseUrl, cookie, { challenge, scope: 'openid project:read', nonce });
  const body = await (await exchangeAuthorizationCode(baseUrl, { code, verifier })).json();
  assert.ok(body.id_token, 'openid scope must yield an id_token');

  const { keys } = await (await fetch(`${baseUrl}/oauth/jwks`)).json();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].alg, 'RS256');
  assert.equal(keys[0].use, 'sig');
  const publicKey = createPublicKey({ key: keys[0], format: 'jwk' });

  const { header, payload } = verifyJwt(body.id_token, (h) => (h.kid === keys[0].kid ? publicKey : null), {
    expectedTyp: 'JWT',
  });
  assert.equal(header.alg, 'RS256');
  assert.equal(payload.iss, baseUrl);
  assert.equal(payload.sub, 'user_alice');
  assert.equal(payload.aud, 'web-app');
  assert.equal(payload.nonce, nonce);
  assert.equal(payload.email, 'alice@example.com');
  assert.equal(typeof payload.exp, 'number');
  assert.equal(typeof payload.iat, 'number');
});

test('11 no id token is issued without the openid scope', async () => {
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const { verifier, challenge } = pkcePair();
  const code = await codeFromAuthorize(baseUrl, cookie, { challenge, scope: 'project:read' });
  const body = await (await exchangeAuthorizationCode(baseUrl, { code, verifier })).json();
  assert.equal(body.id_token, undefined);
});

test('11 a token signed with alg none is rejected (alg confusion defense)', async () => {
  const { keys } = await (await fetch(`${baseUrl}/oauth/jwks`)).json();
  const publicKey = createPublicKey({ key: keys[0], format: 'jwk' });

  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({ sub: 'user_alice', iss: baseUrl }));
  const forged = `${header}.${payload}.`;

  assert.throws(() => verifyJwt(forged, () => publicKey), /unsupported alg: none/);
});
