import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoAuthenticator, PasskeyStore } from '../src/auth/passkey.js';

// Legacy "concept model" WebAuthn/passkey cases. Phase C replaces passkey.js
// with @simplewebauthn/server + a browser front end and moves these to e2e.
// Kept here (unit, no container) so `npm test` still covers 13-14 until then.

test('13 webauthn-like public key authentication verifies a challenge signature', () => {
  const store = new PasskeyStore();
  const authenticator = createDemoAuthenticator();
  const registerChallenge = store.startRegistration('user_alice');
  assert.equal(
    store.finishRegistration({
      userId: 'user_alice',
      credentialId: 'credential_alice_macbook',
      publicKeyPem: authenticator.publicKeyPem,
      challenge: registerChallenge,
    }),
    true,
  );

  const challenge = store.startAuthentication('user_alice');
  const signature = authenticator.signChallenge(challenge);
  assert.equal(
    store.finishAuthentication({
      userId: 'user_alice',
      credentialId: 'credential_alice_macbook',
      challenge,
      signature,
    }),
    true,
  );
});

test('14 passkey login uses a registered credential instead of a password', () => {
  const store = new PasskeyStore();
  const authenticator = createDemoAuthenticator();
  const registration = store.startRegistration('user_bob');
  store.finishRegistration({
    userId: 'user_bob',
    credentialId: 'credential_bob_phone',
    publicKeyPem: authenticator.publicKeyPem,
    challenge: registration,
  });

  const loginChallenge = store.startAuthentication('user_bob');
  const signature = authenticator.signChallenge(loginChallenge);
  assert.equal(
    store.finishAuthentication({
      userId: 'user_bob',
      credentialId: 'credential_bob_phone',
      challenge: loginChallenge,
      signature,
    }),
    true,
  );
});
