import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createLesson03SessionService } from '../../apps/project-app/lessons/03/session-service.mjs';

function fixture(overrides = {}) {
  let timestamp = overrides.initialTime ?? 0;
  let randomSequence = 0;
  const authenticationCalls = [];
  const authenticator = overrides.authenticator ?? (async (identifier, password) => {
    authenticationCalls.push({ identifier, password });
    if (identifier === 'alice@example.com' && password === 'correct password') {
      return {
        ok: true,
        principal: { id: 'user-alice', identifier: 'alice@example.com' },
      };
    }
    return { ok: false };
  });
  const service = createLesson03SessionService({
    clock: () => timestamp,
    randomBytes: () => Buffer.alloc(32, ++randomSequence),
    authenticator,
    preAuthLifetimeMs: overrides.preAuthLifetimeMs ?? 100,
    absoluteLifetimeMs: overrides.absoluteLifetimeMs ?? 1000,
    maxSessions: overrides.maxSessions ?? 16,
    maxEvents: overrides.maxEvents ?? 32,
    secureCookies: overrides.secureCookies ?? false,
  });
  return {
    service,
    authenticationCalls,
    setTime(value) { timestamp = value; },
  };
}

async function authenticatedSession(context) {
  const preAuth = context.service.createPreAuthSession();
  const authenticated = await context.service.login({
    sessionToken: preAuth.sessionToken,
    identifier: 'alice@example.com',
    password: 'correct password',
  });
  assert.equal(authenticated.ok, true);
  return { preAuth, authenticated };
}

test('successful login rotates the pre-auth token and rejects the old token', async () => {
  const context = fixture();
  const { preAuth, authenticated } = await authenticatedSession(context);

  assert.notEqual(authenticated.sessionToken, preAuth.sessionToken);
  assert.equal(authenticated.sessionRotated, true);
  assert.equal(context.service.currentUser(preAuth.sessionToken).code, 'SESSION_UNAVAILABLE');
  assert.deepEqual(context.service.currentUser(authenticated.sessionToken), {
    ok: true,
    status: 200,
    code: 'CURRENT_USER',
    principal: { id: 'user-alice', identifier: 'alice@example.com' },
    expiresAt: 1000,
  });
  assert.deepEqual(context.authenticationCalls, [{
    identifier: 'alice@example.com',
    password: 'correct password',
  }]);
});

test('failed credentials do not rotate or consume the valid pre-auth session', async () => {
  const context = fixture();
  const preAuth = context.service.createPreAuthSession();
  const rejected = await context.service.login({
    sessionToken: preAuth.sessionToken,
    identifier: 'alice@example.com',
    password: 'wrong password',
  });
  assert.deepEqual(rejected, {
    ok: false,
    status: 422,
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid identifier or password.',
    sessionIssued: false,
  });

  const retry = await context.service.login({
    sessionToken: preAuth.sessionToken,
    identifier: 'alice@example.com',
    password: 'correct password',
  });
  assert.equal(retry.ok, true);
});

test('rate-limit and capacity failures keep their retry semantics without rotating', async () => {
  for (const transient of [
    { status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 30 },
    { status: 503, code: 'AUTHENTICATION_CAPACITY_EXCEEDED', retryAfterSeconds: 1 },
  ]) {
    const context = fixture({ authenticator: async () => ({ ok: false, ...transient }) });
    const preAuth = context.service.createPreAuthSession();
    const rejected = await context.service.login({
      sessionToken: preAuth.sessionToken,
      identifier: 'alice@example.com',
      password: 'wrong password',
    });
    assert.deepEqual(rejected, {
      ok: false,
      ...transient,
      message: 'Authentication temporarily unavailable.',
      headers: { 'retry-after': String(transient.retryAfterSeconds) },
      sessionIssued: false,
    });
    assert.equal(context.service.currentUser(preAuth.sessionToken).code, 'SESSION_UNAVAILABLE');
  }
});

test('unknown and malformed tokens receive one generic external failure', async () => {
  const context = fixture();
  const unknown = Buffer.alloc(32, 0xee).toString('base64url');
  const malformedLogin = await context.service.login({
    sessionToken: 'not-a-token',
    identifier: 'alice@example.com',
    password: 'correct password',
  });
  const unknownLogin = await context.service.login({
    sessionToken: unknown,
    identifier: 'alice@example.com',
    password: 'correct password',
  });
  assert.deepEqual(malformedLogin, unknownLogin);
  assert.deepEqual(context.service.currentUser('not-a-token'), context.service.currentUser(unknown));
  assert.equal(malformedLogin.code, 'SESSION_UNAVAILABLE');
  assert.equal(context.authenticationCalls.length, 0);
});

test('authenticated sessions expire at the absolute boundary without sliding', async () => {
  const context = fixture({ absoluteLifetimeMs: 1000 });
  const { authenticated } = await authenticatedSession(context);
  context.setTime(999);
  assert.equal(context.service.currentUser(authenticated.sessionToken).ok, true);
  context.setTime(1000);
  assert.equal(context.service.currentUser(authenticated.sessionToken).code, 'SESSION_UNAVAILABLE');
  const expired = context.service.observe().state.records.find(
    (record) => record.status === 'expired',
  );
  assert.equal(expired.timestamps.expiresAt, 1000);
  assert.equal(expired.timestamps.expiredAt, 1000);
});

test('logout is idempotent and reveals no unknown, malformed, or repeated-token state', async () => {
  const context = fixture();
  const { authenticated } = await authenticatedSession(context);
  const first = context.service.logout(authenticated.sessionToken);
  const repeated = context.service.logout(authenticated.sessionToken);
  const unknown = context.service.logout(Buffer.alloc(32, 0xdd).toString('base64url'));
  const malformed = context.service.logout('invalid');
  assert.deepEqual(first, repeated);
  assert.deepEqual(repeated, unknown);
  assert.deepEqual(unknown, malformed);
  assert.equal(context.service.currentUser(authenticated.sessionToken).code, 'SESSION_UNAVAILABLE');
});

test('explicit server-side revocation is safe when simultaneous or repeated', async () => {
  const context = fixture();
  const first = await authenticatedSession(context);
  const second = await authenticatedSession(context);

  const results = await Promise.all([
    Promise.resolve().then(() => context.service.revokeSubject('user-alice')),
    Promise.resolve().then(() => context.service.revokeSubject('user-alice')),
  ]);
  assert.equal(results[0].revokedCount + results[1].revokedCount, 2);
  assert.equal(context.service.revokeSubject('user-alice').revokedCount, 0);
  assert.equal(context.service.currentUser(first.authenticated.sessionToken).ok, false);
  assert.equal(context.service.currentUser(second.authenticated.sessionToken).ok, false);
});

test('simultaneous login attempts cannot create two sessions from one pre-auth token', async () => {
  const context = fixture();
  const preAuth = context.service.createPreAuthSession();
  const input = {
    sessionToken: preAuth.sessionToken,
    identifier: 'alice@example.com',
    password: 'correct password',
  };
  const results = await Promise.all([
    context.service.login(input),
    context.service.login(input),
  ]);
  assert.deepEqual(results.map((result) => result.ok).sort(), [false, true]);
  assert.equal(results.find((result) => !result.ok).code, 'SESSION_UNAVAILABLE');
});

test('server state and event history stay bounded and reclaim terminal records', async () => {
  const context = fixture({ maxSessions: 2, maxEvents: 3 });
  const first = context.service.createPreAuthSession();
  const second = context.service.createPreAuthSession();
  assert.equal(context.service.createPreAuthSession().code, 'SESSION_CAPACITY_EXHAUSTED');
  context.service.logout(first.sessionToken);
  assert.equal(context.service.createPreAuthSession().ok, true);

  const observation = context.service.observe();
  assert.equal(observation.state.retainedSessionCount, 2);
  assert.equal(observation.state.records.length, 2);
  assert.equal(observation.state.retainedEventCount, 3);
  assert.equal(observation.state.events.length, 3);
  assert.equal(context.service.currentUser(second.sessionToken).ok, false);
});

test('observation exposes only digest fingerprints and omits tokens and credentials', async () => {
  const context = fixture();
  const { preAuth, authenticated } = await authenticatedSession(context);
  const observation = context.service.observe();
  const text = JSON.stringify(observation);
  const authenticatedDigest = createHash('sha256')
    .update(authenticated.sessionToken, 'ascii')
    .digest('hex');

  assert.equal(text.includes(preAuth.sessionToken), false);
  assert.equal(text.includes(authenticated.sessionToken), false);
  assert.equal(text.includes(authenticatedDigest), false);
  assert.equal(text.includes(authenticatedDigest.slice(0, 16)), true);
  assert.equal(text.includes('correct password'), false);
  assert.equal(text.includes('alice@example.com'), false);
  assert.deepEqual(
    observation.state.records.find((record) => record.subject !== null).subject,
    { id: 'user-alice' },
  );
  assert.equal(
    observation.state.events.some((event) => event.subject?.identifier !== undefined),
    false,
  );
  assert.deepEqual(Object.keys(context.service).sort(), [
    'createPreAuthSession',
    'currentUser',
    'login',
    'logout',
    'observe',
    'revokeSubject',
  ]);
  assert.equal(observation.implementation.serverStorage, 'sha-256-token-digest-only');
  assert.equal(observation.cookie.transportContext, 'loopback-http-training-deviation');
});

test('an invalid authenticator principal fails before revoking the pre-auth session', async () => {
  let attempt = 0;
  const context = fixture({
    authenticator: async () => {
      attempt += 1;
      return attempt === 1
        ? { ok: true, principal: { id: '', identifier: 'alice@example.com' } }
        : { ok: true, principal: { id: 'user-alice', identifier: 'alice@example.com' } };
    },
  });
  const preAuth = context.service.createPreAuthSession();
  const input = {
    sessionToken: preAuth.sessionToken,
    identifier: 'alice@example.com',
    password: 'correct password',
  };

  await assert.rejects(() => context.service.login(input), /principal id is invalid/u);
  const retry = await context.service.login(input);
  assert.equal(retry.ok, true);
  assert.equal(retry.sessionRotated, true);
});

test('an overflowed authenticated expiry fails before revoking the pre-auth session', async () => {
  const context = fixture({
    preAuthLifetimeMs: Number.MAX_SAFE_INTEGER,
    absoluteLifetimeMs: 1000,
  });
  const preAuth = context.service.createPreAuthSession();
  const input = {
    sessionToken: preAuth.sessionToken,
    identifier: 'alice@example.com',
    password: 'correct password',
  };

  context.setTime(Number.MAX_SAFE_INTEGER - 5);
  await assert.rejects(() => context.service.login(input), /exceeds the clock range/u);
  context.setTime(0);
  const retry = await context.service.login(input);
  assert.equal(retry.ok, true);
  assert.equal(retry.sessionRotated, true);
});
