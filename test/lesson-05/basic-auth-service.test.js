import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createLesson05BasicAuthService,
  LESSON_05_BASIC_CHALLENGE,
  parseBasicAuthorization,
} from '../../apps/project-app/lessons/05/basic-auth-service.mjs';

function header(userPass) {
  return `Basic ${Buffer.from(userPass, 'utf8').toString('base64')}`;
}

test('RFC 7617 parser accepts canonical UTF-8 credentials and the first colon separates password', () => {
  assert.deepEqual(parseBasicAuthorization(header('te\u0301st:pass:with:colons')), {
    userId: 'tést',
    password: 'pass:with:colons',
  });
  assert.deepEqual(parseBasicAuthorization(`bAsIc ${Buffer.from('alice:password').toString('base64')}`), {
    userId: 'alice', password: 'password',
  });
});

test('parser rejects ambiguous, non-canonical, invalid UTF-8, control, and colonless credentials', () => {
  const invalidUtf8 = Buffer.from([0x61, 0x3a, 0xc3, 0x28]).toString('base64');
  for (const value of [
    undefined,
    '',
    'Basic',
    'Basic  YWxpY2U6cGFzcw==',
    'Basic YWxpY2U6cGFzcw',
    'Basic !!!=',
    `Basic ${invalidUtf8}`,
    header(':password'),
    header('alice'),
    header('alice:pass\nword'),
    `Bearer ${Buffer.from('alice:password').toString('base64')}`,
  ]) assert.equal(parseBasicAuthorization(value), null);
});

test('missing, malformed, unknown, and wrong credentials receive one Basic challenge', async () => {
  const calls = [];
  const service = createLesson05BasicAuthService({
    authenticator: async (userId, password) => {
      calls.push({ userId, password });
      if (userId === 'alice' && password === 'correct') {
        return { ok: true, principal: { id: 'user-500', identifier: 'alice' } };
      }
      return { ok: false, status: 422, code: 'INVALID_CREDENTIALS' };
    },
  });
  const failures = await Promise.all([
    service.authenticateAuthorization(undefined),
    service.authenticateAuthorization('Basic invalid'),
    service.authenticateAuthorization(header('unknown:wrong')),
    service.authenticateAuthorization(header('alice:wrong')),
  ]);
  for (const failure of failures) assert.deepEqual(failure, {
    ok: false,
    status: 401,
    code: 'BASIC_AUTH_REQUIRED',
    message: 'Authentication required.',
    headers: { 'www-authenticate': LESSON_05_BASIC_CHALLENGE },
  });
  assert.deepEqual(calls.slice(0, 2), [
    { userId: null, password: 'invalid-basic-credential' },
    { userId: null, password: 'invalid-basic-credential' },
  ]);

  const success = await service.authenticateAuthorization(header('alice:correct'));
  assert.deepEqual(success, {
    ok: true, status: 200, code: 'BASIC_AUTHENTICATED', principal: { id: 'user-500' },
  });
  assert.equal(service.observe().implementation.sessionIssuance, false);
  assert.equal(JSON.stringify(service.observe()).includes('alice'), false);
});

test('rate limiting and capacity retain Retry-After instead of being converted to a challenge', async () => {
  for (const transient of [
    { status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 30 },
    { status: 503, code: 'AUTHENTICATION_CAPACITY_EXCEEDED', retryAfterSeconds: 1 },
  ]) {
    const service = createLesson05BasicAuthService({
      authenticator: async () => ({ ok: false, ...transient }),
    });
    assert.deepEqual(await service.authenticateAuthorization(header('alice:wrong')), {
      ok: false,
      ...transient,
      message: 'Authentication temporarily unavailable.',
      headers: { 'retry-after': String(transient.retryAfterSeconds) },
    });
  }
});
