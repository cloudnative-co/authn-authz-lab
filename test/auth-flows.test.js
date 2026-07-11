import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Directory, toIdentityProfile } from '../src/auth/directory.js';
import { issueSamlAssertion, verifySamlAssertion } from '../src/auth/federation.js';
import { issueServiceTicket, validateServiceTicket } from '../src/auth/kerberos.js';
import { createDemoAuthenticator, PasskeyStore } from '../src/auth/passkey.js';
import { createSeedData } from '../src/data/seed.js';

// Phase A replaced 02-05 (moved to 02-05-core-auth.test.js) and 10-12, 15
// (rewritten as protocol-accurate suites: 10-oauth, 11-oidc, 12-totp,
// 15-api-authorization). The 06-09 and 13-14 cases below still exercise the
// "concept model" modules (directory/kerberos/federation SAML/passkey) and are
// replaced by real LDAP/Kerberos/SAML/WebAuthn implementations in Phase B/C.

test('06 directory can authenticate and return group membership', () => {
  const store = createSeedData();
  const directory = new Directory(store);
  const alice = directory.authenticate('alice@example.com', 'password-alice');
  assert.deepEqual(directory.groupsForUser(alice.id).map((group) => group.id), ['engineering', 'security']);
});

test('07 kerberos-like ticket lets the app trust a prior authentication event', () => {
  const ticket = issueServiceTicket({ principal: 'user_alice', service: 'mini-project-app' }, 'secret', 1000);
  const payload = validateServiceTicket(ticket, 'mini-project-app', 'secret', 1200);
  assert.equal(payload.principal, 'user_alice');
});

test('08 identity profile normalizes directory data for the app', () => {
  const store = createSeedData();
  const directory = new Directory(store);
  const alice = directory.findUserByEmail('alice@example.com');
  const profile = toIdentityProfile(alice, directory.groupsForUser(alice.id));
  assert.deepEqual(profile.groups, ['engineering', 'security']);
});

test('09 saml assertion carries an IdP authentication result', () => {
  const assertion = issueSamlAssertion({ subject: 'user_alice', email: 'alice@example.com', groups: ['security'] }, 'secret', 1000);
  const profile = verifySamlAssertion(assertion, 'secret', 1200);
  assert.equal(profile.subject, 'user_alice');
});

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
