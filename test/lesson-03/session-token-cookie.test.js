import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  createSessionToken,
  digestSessionToken,
  parseSessionToken,
  SESSION_TOKEN_BYTES,
  SessionTokenError,
} from '../../packages/session/session-token.mjs';
import {
  describeSessionCookieConfiguration,
  parseSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  SessionCookieError,
} from '../../packages/session/session-cookie.mjs';

const TOKEN = Buffer.alloc(SESSION_TOKEN_BYTES, 0xa5).toString('base64url');

test('session tokens are canonical unpadded 256-bit values and are digested for storage', () => {
  const token = createSessionToken((size) => {
    assert.equal(size, 32);
    return Buffer.alloc(size, 0xa5);
  });
  assert.equal(token, TOKEN);
  assert.equal(token.length, 43);
  assert.equal(parseSessionToken(token), token);
  assert.equal(
    digestSessionToken(token),
    createHash('sha256').update(token, 'ascii').digest('hex'),
  );
});

test('non-canonical, malformed, padded, and wrongly sized tokens are rejected', () => {
  for (const value of [
    `${TOKEN}=`,
    TOKEN.slice(0, -1),
    ` ${TOKEN}`,
    TOKEN.replace(/.$/u, '+'),
    '',
    null,
  ]) {
    assert.throws(() => parseSessionToken(value), SessionTokenError);
  }
  assert.throws(() => createSessionToken(() => Buffer.alloc(31)), /exactly 32 bytes/u);
  assert.throws(() => createSessionToken(async () => Buffer.alloc(32)), /synchronously/u);
});

test('Set-Cookie serialization is host-only, HttpOnly, Lax, path-scoped, and bounded', () => {
  const secure = serializeSessionCookie(TOKEN, { maxAgeSeconds: 1800, secure: true });
  assert.equal(
    secure,
    `course_session=${TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800; Secure`,
  );
  assert.equal(secure.includes('Domain='), false);

  const loopback = serializeSessionCookie(TOKEN, { maxAgeSeconds: 300, secure: false });
  assert.equal(loopback.includes('; Secure'), false);
  assert.equal(loopback.includes('HttpOnly'), true);
  assert.equal(loopback.includes('SameSite=Lax'), true);
  assert.equal(loopback.includes('Path=/'), true);
  assert.equal(loopback.includes('Max-Age=300'), true);

  assert.equal(
    serializeClearedSessionCookie({ secure: true }),
    'course_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure',
  );
  assert.throws(
    () => serializeSessionCookie(TOKEN, { domain: 'example.com' }),
    SessionCookieError,
  );
});

test('Cookie parsing rejects duplicate names, ambiguous syntax, and header injection', () => {
  assert.equal(parseSessionCookie(`theme=dark; course_session=${TOKEN}`), TOKEN);
  assert.equal(parseSessionCookie('theme=dark'), null);

  for (const header of [
    `course_session=${TOKEN}; course_session=${TOKEN}`,
    `theme=dark; theme=light; course_session=${TOKEN}`,
    `course_session="${TOKEN}"`,
    `course_session=${TOKEN}\r\nX-Injected: yes`,
    `course_session=${TOKEN};`,
    `course_session=${TOKEN}\t`,
    'broken-pair',
  ]) {
    assert.throws(() => parseSessionCookie(header), SessionCookieError);
  }
});

test('loopback HTTP is labeled as a training deviation, never as a production guarantee', () => {
  const observation = describeSessionCookieConfiguration({ secure: false });
  assert.equal(observation.transportContext, 'loopback-http-training-deviation');
  assert.equal(observation.productionPosture, 'not-approved');
  assert.match(observation.deviation, /only for the loopback HTTP lesson/u);
  assert.equal(JSON.stringify(observation).toLowerCase().includes('production secure'), false);
  assert.equal(observation.domainAttribute, 'omitted');
});
