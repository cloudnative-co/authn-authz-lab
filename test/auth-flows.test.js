import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticateBasicAuth } from '../src/auth/basic.js';
import { authorizeProjectAction } from '../src/auth/authorization.js';
import { Directory, toIdentityProfile } from '../src/auth/directory.js';
import { issueIdToken, issueSamlAssertion, verifyIdToken, verifySamlAssertion } from '../src/auth/federation.js';
import { issueServiceTicket, validateServiceTicket } from '../src/auth/kerberos.js';
import { AuthorizationServer } from '../src/auth/oauth.js';
import { createDemoAuthenticator, PasskeyStore } from '../src/auth/passkey.js';
import { authenticateWithPassword } from '../src/auth/password.js';
import { SessionStore } from '../src/auth/session.js';
import { createSeedData } from '../src/data/seed.js';

test('02 password authentication identifies a user', () => {
  const store = createSeedData();
  const alice = authenticateWithPassword(store, 'alice@example.com', 'password-alice');
  assert.equal(alice.id, 'user_alice');
  assert.equal(authenticateWithPassword(store, 'alice@example.com', 'wrong-password'), null);
});

test('03 sessions preserve authentication result between requests', () => {
  const sessions = new SessionStore({ ttlMs: 1000 });
  const id = sessions.create('user_alice', 1000);
  assert.equal(sessions.resolve(id, 1500), 'user_alice');
  assert.equal(sessions.resolve(id, 2500), null);
});

test('04 project authorization separates login from delete permission', () => {
  const store = createSeedData();
  assert.equal(authorizeProjectAction(store, 'user_alice', 'project_123', 'project.delete').allowed, true);
  assert.equal(authorizeProjectAction(store, 'user_bob', 'project_123', 'project.delete').allowed, false);
});

test('05 basic authentication authenticates every request with the Authorization header', () => {
  const store = createSeedData();
  const token = Buffer.from('alice@example.com:password-alice').toString('base64');
  const user = authenticateBasicAuth(store, `Basic ${token}`);
  assert.equal(user.id, 'user_alice');
});

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

test('10 oauth authorization code is exchanged for a scoped access token', () => {
  const server = new AuthorizationServer({ secret: 'secret' });
  server.registerClient({
    clientId: 'report-app',
    clientSecret: 'report-app-secret',
    redirectUris: ['https://report.example.test/callback'],
    allowedScopes: ['project:read'],
  });
  const code = server.issueAuthorizationCode({
    clientId: 'report-app',
    userId: 'user_alice',
    redirectUri: 'https://report.example.test/callback',
    scopes: ['project:read'],
  });
  const token = server.exchangeCode({
    clientId: 'report-app',
    clientSecret: 'report-app-secret',
    code,
    redirectUri: 'https://report.example.test/callback',
  });
  assert.equal(server.introspect(token, ['project:read']).subject, 'user_alice');
});

test('11 oidc id token carries who the user is', () => {
  const idToken = issueIdToken({ subject: 'user_alice', email: 'alice@example.com', groups: ['security'] }, 'secret', 1000);
  const claims = verifyIdToken(idToken, 'secret', 1200);
  assert.equal(claims.sub, 'user_alice');
});

test('12 webauthn-like public key authentication verifies a challenge signature', () => {
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

test('13 passkey login uses a registered credential instead of a password', () => {
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

test('14 client credentials token gives a machine client scoped API access', () => {
  const server = new AuthorizationServer({ secret: 'secret' });
  server.registerClient({
    clientId: 'nightly-report-worker',
    clientSecret: 'worker-secret',
    redirectUris: [],
    allowedScopes: ['project:read'],
  });
  const token = server.issueClientCredentialsToken({
    clientId: 'nightly-report-worker',
    clientSecret: 'worker-secret',
    scopes: ['project:read'],
  });
  assert.equal(server.introspect(token, ['project:read']).tokenType, 'client');
});
