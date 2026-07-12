import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as OTPAuth from 'otpauth';
import {
  buildOtpAuthUri,
  decodeBase32,
  encodeBase32,
  generateTotp,
  verifyTotp,
} from '../../packages/totp/totp.mjs';

const TIMES = [59, 1_111_111_109, 1_111_111_111, 1_234_567_890, 2_000_000_000, 20_000_000_000];
const VECTORS = Object.freeze({
  SHA1: ['94287082', '07081804', '14050471', '89005924', '69279037', '65353130'],
  SHA256: ['46119246', '68084774', '67062674', '91819424', '90698825', '77737706'],
  SHA512: ['90693936', '25091201', '99943326', '93441116', '38618901', '47863826'],
});
const SECRETS = Object.freeze({
  SHA1: Buffer.from('12345678901234567890', 'ascii'),
  SHA256: Buffer.from('12345678901234567890123456789012', 'ascii'),
  SHA512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234', 'ascii'),
});

test('RFC 6238 Appendix B test vectors match for all required algorithms', () => {
  for (const [algorithm, expectedCodes] of Object.entries(VECTORS)) {
    for (const [index, seconds] of TIMES.entries()) {
      assert.equal(generateTotp({
        secret: SECRETS[algorithm],
        timeMs: seconds * 1000,
        period: 30,
        digits: 8,
        algorithm,
      }), expectedCodes[index]);
    }
  }
});

test('base32 and provisioning URI use a canonical round trip without padding', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii');
  const encoded = encodeBase32(secret);
  assert.equal(encoded, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(decodeBase32(encoded), secret);
  const uri = new URL(buildOtpAuthUri({
    secret,
    issuer: 'CloudNative Course',
    accountName: 'alice@example.com',
  }));
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.hostname, 'totp');
  assert.equal(uri.pathname, '/CloudNative%20Course:alice%40example.com');
  assert.equal(uri.searchParams.get('secret'), encoded);
  assert.equal(uri.searchParams.get('issuer'), 'CloudNative Course');
  assert.equal(uri.searchParams.get('algorithm'), 'SHA1');
  assert.equal(uri.searchParams.get('digits'), '6');
  assert.equal(uri.searchParams.get('period'), '30');
});

test('verification accepts the configured window once and rejects replay', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii');
  const timeMs = 1_700_000_000_000;
  const priorCode = generateTotp({ secret, timeMs: timeMs - 30_000 });
  const accepted = verifyTotp({ secret, code: priorCode, timeMs, window: 1 });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.offset, -1);
  assert.deepEqual(
    verifyTotp({
      secret,
      code: priorCode,
      timeMs,
      window: 1,
      lastAcceptedCounter: accepted.counter,
    }),
    { ok: false, reason: 'replayed' },
  );
  assert.deepEqual(
    verifyTotp({ secret, code: 'not-six-digits', timeMs, window: 1 }),
    { ok: false, reason: 'invalid-or-expired' },
  );
});

test('the lesson implementation interoperates with an independent OTPAuth implementation', () => {
  const secret = Buffer.from('independent-interop-secret-for-l12', 'utf8');
  const encoded = encodeBase32(secret);
  const timeMs = 1_700_000_040_000;
  const independent = new OTPAuth.TOTP({
    issuer: 'CloudNative Course',
    label: 'alice@example.com',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(encoded),
  });
  assert.equal(
    generateTotp({ secret, timeMs, algorithm: 'SHA1', digits: 6, period: 30 }),
    independent.generate({ timestamp: timeMs }),
  );
});
