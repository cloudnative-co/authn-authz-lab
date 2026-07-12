import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COURSE_SCRYPT_ENCODING,
  hashPassword,
  inspectStoredPassword,
  normalizePasswordForKdf,
  OWASP_SCRYPT_PROFILE,
  parseStoredPassword,
  PasswordEncodingError,
  PasswordInputError,
  verifyPassword,
} from '../../packages/password/scrypt-password.mjs';
import {
  assessPasswordPolicy,
  LESSON_02_PASSWORD_POLICY,
} from '../../packages/password/password-policy.mjs';

test('real Node scrypt hashes and verifies NFC-equivalent passwords with the lesson profile', async () => {
  const decomposed = 'Cafe\u0301 has a sufficiently long passphrase';
  const composed = 'Caf\u00e9 has a sufficiently long passphrase';
  const first = await hashPassword(decomposed);
  const second = await hashPassword(decomposed);

  assert.notEqual(first, second);
  assert.equal(first.startsWith('$course-scrypt$v=1$'), true);
  assert.equal(COURSE_SCRYPT_ENCODING.standardsStatus, 'application-defined-not-phc');
  assert.equal(await verifyPassword(composed, first), true);
  assert.equal(await verifyPassword('not the password', first), false);

  const firstMetadata = inspectStoredPassword(first);
  const secondMetadata = inspectStoredPassword(second);
  assert.deepEqual(firstMetadata.workFactor, {
    N: OWASP_SCRYPT_PROFILE.N,
    r: OWASP_SCRYPT_PROFILE.r,
    p: OWASP_SCRYPT_PROFILE.p,
  });
  assert.equal(firstMetadata.keyLength, OWASP_SCRYPT_PROFILE.keyLength);
  assert.equal(firstMetadata.saltBytes >= 16, true);
  assert.notEqual(firstMetadata.saltFingerprint, secondMetadata.saltFingerprint);
});

test('stored password parser rejects malformed, non-canonical, and oversized encodings', async () => {
  const valid = await hashPassword('strict encoding test password');
  const parsed = parseStoredPassword(valid);
  const shortSalt = Buffer.alloc(15).toString('base64url');
  const shortKey = Buffer.alloc(31).toString('base64url');
  const salt = parsed.salt.toString('base64url');
  const key = parsed.derivedKey.toString('base64url');
  const malformed = [
    valid.replace('$course-scrypt$', '$pbkdf2$'),
    valid.replace('$v=1$', '$v=2$'),
    valid.replace('N=32768', 'N=032768'),
    valid.replace('N=32768', 'N=32769'),
    `$course-scrypt$v=1$N=32768,r=8,p=3,l=32$${shortSalt}$${key}`,
    `$course-scrypt$v=1$N=32768,r=8,p=3,l=32$${salt}$${shortKey}`,
    `${valid}=`,
    `${valid}$extra`,
    `$course-scrypt$v=1$N=32768,r=8,p=3,l=32$${'a'.repeat(1100)}$${key}`,
  ];

  for (const candidate of malformed) {
    assert.throws(() => parseStoredPassword(candidate), PasswordEncodingError);
  }
  await assert.rejects(verifyPassword('strict encoding test password', malformed[0]), PasswordEncodingError);
});

test('custom work factors are recorded and used during verification', async () => {
  const calls = [];
  const fakeScrypt = async (password, salt, keyLength, workFactor) => {
    calls.push({ keyLength, ...workFactor });
    const digest = Buffer.concat([Buffer.from(password), Buffer.from(salt)]);
    return Buffer.alloc(keyLength, digest[0] ^ digest.at(-1));
  };
  const profile = {
    algorithm: 'scrypt',
    N: 2 ** 14,
    r: 8,
    p: 4,
    keyLength: 48,
    saltBytes: 20,
    maxmem: 128 * 1024 * 1024,
  };
  const encoded = await hashPassword('metadata test password', {
    profile,
    randomBytes: (size) => Buffer.alloc(size, 7),
    scrypt: fakeScrypt,
  });

  const parsed = parseStoredPassword(encoded);
  assert.deepEqual(
    { N: parsed.N, r: parsed.r, p: parsed.p, keyLength: parsed.keyLength, saltBytes: parsed.salt.length },
    { N: 2 ** 14, r: 8, p: 4, keyLength: 48, saltBytes: 20 },
  );
  assert.equal(await verifyPassword('metadata test password', encoded, { scrypt: fakeScrypt }), true);
  assert.deepEqual(calls.map(({ N, r, p, keyLength }) => ({ N, r, p, keyLength })), [
    { N: 2 ** 14, r: 8, p: 4, keyLength: 48 },
    { N: 2 ** 14, r: 8, p: 4, keyLength: 48 },
  ]);
  await assert.rejects(hashPassword('metadata test password', {
    profile: { ...profile, algorithm: 'pbkdf2' },
    scrypt: fakeScrypt,
  }), PasswordEncodingError);
});

test('KDF input bounds are structural and password policy remains independent', () => {
  assert.throws(() => normalizePasswordForKdf(''), PasswordInputError);
  assert.throws(() => normalizePasswordForKdf('x'.repeat(1025)), PasswordInputError);
  assert.equal(normalizePasswordForKdf('short'), 'short');
  assert.deepEqual(assessPasswordPolicy('short'), {
    accepted: false,
    codePoints: 5,
    reasons: ['too-short'],
  });
  assert.equal(LESSON_02_PASSWORD_POLICY.minimumCodePoints, 15);
  assert.equal(assessPasswordPolicy('a'.repeat(15)).accepted, true);
  assert.equal(assessPasswordPolicy('\ud83d\udd10'.repeat(129)).reasons.includes('too-long'), true);
});
