import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as client from 'openid-client';
import { login, startTestServer, WEB_APP_REDIRECT_URI } from '../../test-support/http.js';

let server;
let baseUrl;

before(async () => {
  ({ server, baseUrl } = await startTestServer());
});

after(() => {
  server.close();
});

// openid-client is an OpenID Certified relying party. Driving our own OP with
// it validates discovery, the authorization-code + PKCE exchange, and the
// RS256 ID Token (signature via JWKS, iss/aud/nonce/exp) against a conformant
// implementation.
test('interop openid-client completes the authorization code + PKCE flow against our OP', async () => {
  const config = await client.discovery(
    new URL(baseUrl),
    'web-app',
    'web-app-secret',
    client.ClientSecretPost(),
    { execute: [client.allowInsecureRequests] },
  );

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const authorizationUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: WEB_APP_REDIRECT_URI,
    scope: 'openid project:read',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  // Simulate the user-agent: authenticate the resource owner, then follow the
  // authorization request to capture the redirect back to the client.
  const cookie = await login(baseUrl, 'alice@example.com', 'password-alice');
  const redirect = await fetch(authorizationUrl, { headers: { cookie }, redirect: 'manual' });
  assert.equal(redirect.status, 302);
  const callbackUrl = new URL(redirect.headers.get('location'));

  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
    expectedNonce: nonce,
  });

  assert.ok(tokens.access_token);
  assert.equal(tokens.token_type.toLowerCase(), 'bearer');

  const claims = tokens.claims();
  assert.ok(claims, 'id_token claims must be present');
  assert.equal(claims.iss, baseUrl);
  assert.equal(claims.sub, 'user_alice');
  assert.equal(claims.aud, 'web-app');
  assert.equal(claims.nonce, nonce);
});
