import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Secret, TOTP } from 'otpauth';
import { generateTotp, generateTotpSecret } from '../../src/auth/totp.js';

// Cross-check our node:crypto TOTP against otpauth (a maintained OTP library)
// to prove the HMAC-SHA1 + dynamic-truncation math is interoperable.
test('interop totp output matches otpauth for the same secret and timestamps', () => {
  const base32Secret = generateTotpSecret();
  const reference = new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(base32Secret),
  });

  const timestamps = [0, 59_000, 1_111_111_109_000, 1_234_567_890_000, 2_000_000_000_000, Date.now()];
  for (const timestamp of timestamps) {
    assert.equal(
      generateTotp(base32Secret, { now: timestamp }),
      reference.generate({ timestamp }),
      `mismatch at timestamp=${timestamp}`,
    );
  }
});
