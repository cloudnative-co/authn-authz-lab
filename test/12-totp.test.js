import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base32Encode } from '../src/auth/base32.js';
import { buildOtpauthUri, generateTotp, generateTotpSecret, verifyTotp } from '../src/auth/totp.js';

// RFC 6238 Appendix B reference values (SHA1 seed "12345678901234567890",
// T0 = 0, X = 30s). Appendix B prints 8-digit codes.
const RFC_SEED_BASE32 = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const RFC_VECTORS = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

test('12 totp matches the RFC 6238 appendix B test vectors', () => {
  for (const [seconds, expected] of RFC_VECTORS) {
    assert.equal(generateTotp(RFC_SEED_BASE32, { now: seconds * 1000, digits: 8 }), expected, `t=${seconds}`);
  }
});

test('12 six digit codes are zero padded when shorter than six digits', () => {
  // The t=1111111109 vector truncates to 7081804; its 6-digit form drops a
  // leading digit and must be zero padded to 081804.
  assert.equal(generateTotp(RFC_SEED_BASE32, { now: 1111111109 * 1000, digits: 6 }), '081804');
});

test('12 generateTotp produces six digits verified within the step window', () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const code = generateTotp(secret, { now });
  assert.match(code, /^\d{6}$/);

  assert.equal(verifyTotp(code, secret, { now }), true);
  assert.equal(verifyTotp(generateTotp(secret, { now: now - 30_000 }), secret, { now }), true);
  assert.equal(verifyTotp(generateTotp(secret, { now: now + 30_000 }), secret, { now }), true);
  assert.equal(verifyTotp(generateTotp(secret, { now: now - 90_000 }), secret, { now }), false);
  assert.equal(verifyTotp('000000', secret, { now: 0 }), false);
});

test('12 buildOtpauthUri follows the Key Uri Format', () => {
  const uri = buildOtpauthUri({ issuer: 'Mini Project App', accountName: 'alice@example.com', secret: 'JBSWY3DPEHPK3PXP' });
  assert.equal(uri, 'otpauth://totp/Mini%20Project%20App:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Mini%20Project%20App');
});
