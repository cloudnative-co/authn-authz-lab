import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createLesson12MfaService } from '../../apps/project-app/lessons/12/mfa-service.mjs';
import { decodeBase32, generateTotp } from '../../packages/totp/totp.mjs';

function deterministicRandom() {
  let counter = 0;
  return (length) => {
    const chunks = [];
    while (Buffer.concat(chunks).length < length) {
      chunks.push(createHash('sha256').update(`lesson-12-${counter}`).digest());
      counter += 1;
    }
    return Buffer.concat(chunks).subarray(0, length);
  };
}

const passwordService = Object.freeze({
  async authenticate(identifier, password) {
    if (identifier !== 'alice@example.com' || password !== 'correct-password') {
      return Object.freeze({
        ok: false,
        status: 422,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid identifier or password.',
        sessionIssued: false,
      });
    }
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'AUTHENTICATED',
      principal: Object.freeze({ id: 'user-alice', identifier }),
      sessionIssued: false,
    });
  },
});

function windowCodes(secret, timeMs) {
  return new Set([-1, 0, 1].map((offset) => generateTotp({
    secret,
    timeMs: timeMs + offset * 30_000,
  })));
}

function invalidCode(secret, timeMs, start = 0) {
  const accepted = windowCodes(secret, timeMs);
  for (let value = start; value < 1_000_000; value += 1) {
    const candidate = String(value).padStart(6, '0');
    if (!accepted.has(candidate)) return candidate;
  }
  throw new Error('no invalid code exists');
}

function expiredCode(secret, timeMs) {
  const accepted = windowCodes(secret, timeMs);
  for (let steps = 2; steps < 100; steps += 1) {
    const candidate = generateTotp({ secret, timeMs: timeMs - steps * 30_000 });
    if (!accepted.has(candidate)) return candidate;
  }
  throw new Error('no expired code exists');
}

test('registration confirmation, replay defense, recovery, and session issuance form one flow', async () => {
  let timeMs = 1_700_000_000_000;
  const service = await createLesson12MfaService({
    clock: () => timeMs,
    randomBytes: deterministicRandom(),
    passwordService,
  });
  const password = await service.beginEnrollment('alice@example.com', 'correct-password');
  assert.equal(password.sessionIssued, false);
  const started = service.startEnrollment(password.enrollmentToken);
  const secret = decodeBase32(started.secret);
  const confirmationCode = generateTotp({ secret, timeMs });
  const confirmed = service.confirmEnrollment(password.enrollmentToken, confirmationCode);
  assert.equal(confirmed.status, 201);
  assert.equal(confirmed.recoveryCodes.length, 4);

  const replayPreAuth = await service.beginLogin('alice@example.com', 'correct-password');
  assert.equal(replayPreAuth.sessionIssued, false);
  assert.deepEqual(
    service.completeLogin(replayPreAuth.preAuthToken, { method: 'totp', code: confirmationCode }),
    {
      ok: false,
      status: 422,
      code: 'INVALID_SECOND_FACTOR',
      message: 'The second factor could not be verified.',
      sessionIssued: false,
    },
  );

  timeMs += 30_000;
  const nextCode = generateTotp({ secret, timeMs });
  const authenticated = service.completeLogin(
    replayPreAuth.preAuthToken,
    { method: 'totp', code: nextCode },
  );
  assert.equal(authenticated.sessionIssued, true);
  assert.deepEqual(authenticated.authenticationMethods, ['password', 'totp']);
  assert.equal(service.currentUser(authenticated.sessionToken).status, 200);

  const recoveryPreAuth = await service.beginLogin('alice@example.com', 'correct-password');
  const recovery = service.completeLogin(recoveryPreAuth.preAuthToken, {
    method: 'recovery-code',
    code: confirmed.recoveryCodes[0],
  });
  assert.deepEqual(recovery.authenticationMethods, ['password', 'recovery-code']);
  const replayRecoveryPreAuth = await service.beginLogin('alice@example.com', 'correct-password');
  assert.equal(service.completeLogin(replayRecoveryPreAuth.preAuthToken, {
    method: 'recovery-code',
    code: confirmed.recoveryCodes[0],
  }).status, 422);

  const observation = service.observe();
  assert.equal(observation.state.factors[0].recoveryCodesUsed, 1);
  assert.equal(observation.state.factors[0].replayStateStored, true);
  const serialized = JSON.stringify(observation);
  assert.equal(serialized.includes(started.secret), false);
  assert.equal(serialized.includes(started.provisioningUri), false);
  assert.equal(serialized.includes(confirmationCode), false);
  assert.equal(serialized.includes(confirmed.recoveryCodes[0]), false);
  assert.equal(serialized.includes(authenticated.sessionToken), false);
});

test('wrong and expired values are generic before the account-level rate limit', async () => {
  let timeMs = 1_700_000_000_000;
  const service = await createLesson12MfaService({
    clock: () => timeMs,
    randomBytes: deterministicRandom(),
    passwordService,
  });
  const enrollmentPassword = await service.beginEnrollment('alice@example.com', 'correct-password');
  const started = service.startEnrollment(enrollmentPassword.enrollmentToken);
  const secret = decodeBase32(started.secret);
  const enrollmentCode = generateTotp({ secret, timeMs });
  service.confirmEnrollment(enrollmentPassword.enrollmentToken, enrollmentCode);
  timeMs += 30_000;
  const preAuth = await service.beginLogin('alice@example.com', 'correct-password');
  const expired = service.completeLogin(preAuth.preAuthToken, {
    method: 'totp',
    code: expiredCode(secret, timeMs),
  });
  const wrong = service.completeLogin(preAuth.preAuthToken, {
    method: 'totp',
    code: invalidCode(secret, timeMs),
  });
  assert.deepEqual(wrong, expired);
  const limited = service.completeLogin(preAuth.preAuthToken, {
    method: 'totp',
    code: invalidCode(secret, timeMs, 1),
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.retryAfterSeconds, 30);
  assert.deepEqual(limited.headers, { 'retry-after': '30' });
});
