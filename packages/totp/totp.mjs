import { createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ALGORITHMS = new Map([
  ['SHA1', 'sha1'],
  ['SHA256', 'sha256'],
  ['SHA512', 'sha512'],
]);

export class TotpInputError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'TotpInputError';
    this.code = 'TOTP_INPUT_INVALID';
  }
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TotpInputError(`${name} must be a positive safe integer`);
  }
  return value;
}

function secretBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TotpInputError('secret must be a byte array');
  }
  const secret = Buffer.from(value);
  if (secret.length < 16 || secret.length > 128) {
    throw new TotpInputError('secret must contain between 16 and 128 bytes');
  }
  return secret;
}

function canonicalAlgorithm(value) {
  if (typeof value !== 'string' || !ALGORITHMS.has(value.toUpperCase())) {
    throw new TotpInputError('algorithm must be SHA1, SHA256, or SHA512');
  }
  return value.toUpperCase();
}

function validDigits(value) {
  if (![6, 7, 8].includes(value)) {
    throw new TotpInputError('digits must be 6, 7, or 8');
  }
  return value;
}

function validTime(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TotpInputError('timeMs must be a non-negative safe integer');
  }
  return value;
}

function counterBuffer(counter) {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new TotpInputError('counter must be a non-negative safe integer');
  }
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(counter));
  return value;
}

function hotp({ secret, counter, digits, algorithm }) {
  const digest = createHmac(ALGORITHMS.get(algorithm), secret)
    .update(counterBuffer(counter))
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

function safeCodeMatch(actual, expected) {
  const left = Buffer.from(actual, 'ascii');
  const right = Buffer.from(expected, 'ascii');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function encodeBase32(value) {
  const input = secretBytes(value);
  let bits = 0;
  let accumulator = 0;
  let output = '';
  for (const byte of input) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(accumulator >>> bits) & 31];
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(value) {
  if (typeof value !== 'string' || !/^[A-Z2-7]+$/u.test(value) || value.length > 205) {
    throw new TotpInputError('base32 secret must be canonical uppercase without padding');
  }
  let bits = 0;
  let accumulator = 0;
  const bytes = [];
  for (const character of value) {
    accumulator = (accumulator << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 255);
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && accumulator !== 0) {
    throw new TotpInputError('base32 secret has non-zero trailing bits');
  }
  const decoded = secretBytes(Buffer.from(bytes));
  if (encodeBase32(decoded) !== value) {
    throw new TotpInputError('base32 secret is not canonical');
  }
  return decoded;
}

export function createTotpSecret(randomBytes = nodeRandomBytes, length = 20) {
  if (typeof randomBytes !== 'function') throw new TotpInputError('randomBytes must be a function');
  positiveInteger(length, 'length');
  const generated = randomBytes(length);
  const secret = secretBytes(generated);
  if (secret.length !== length) throw new TotpInputError('randomBytes returned the wrong length');
  return Buffer.from(secret);
}

export function totpCounter(timeMs, period = 30) {
  const timestamp = validTime(timeMs);
  const seconds = positiveInteger(period, 'period');
  return Math.floor(timestamp / (seconds * 1000));
}

export function generateTotp({
  secret,
  timeMs,
  period = 30,
  digits = 6,
  algorithm = 'SHA1',
} = {}) {
  const bytes = secretBytes(secret);
  const canonical = canonicalAlgorithm(algorithm);
  const width = validDigits(digits);
  return hotp({
    secret: bytes,
    counter: totpCounter(timeMs, period),
    digits: width,
    algorithm: canonical,
  });
}

export function verifyTotp({
  secret,
  code,
  timeMs,
  period = 30,
  digits = 6,
  algorithm = 'SHA1',
  window = 1,
  lastAcceptedCounter = -1,
} = {}) {
  const bytes = secretBytes(secret);
  const canonical = canonicalAlgorithm(algorithm);
  const width = validDigits(digits);
  const current = totpCounter(timeMs, period);
  if (!Number.isSafeInteger(window) || window < 0 || window > 10) {
    throw new TotpInputError('window must be an integer from 0 through 10');
  }
  if (!Number.isSafeInteger(lastAcceptedCounter) || lastAcceptedCounter < -1) {
    throw new TotpInputError('lastAcceptedCounter must be -1 or a non-negative integer');
  }
  if (typeof code !== 'string' || !new RegExp(`^[0-9]{${width}}$`, 'u').test(code)) {
    return Object.freeze({ ok: false, reason: 'invalid-or-expired' });
  }

  const matchingCounters = [];
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + offset;
    if (counter < 0) continue;
    const expected = hotp({ secret: bytes, counter, digits: width, algorithm: canonical });
    if (safeCodeMatch(code, expected)) matchingCounters.push(counter);
  }
  const counter = matchingCounters.filter((candidate) => candidate > lastAcceptedCounter).at(-1);
  if (counter === undefined) {
    return Object.freeze({
      ok: false,
      reason: matchingCounters.length > 0 ? 'replayed' : 'invalid-or-expired',
    });
  }
  return Object.freeze({ ok: true, counter, offset: counter - current });
}

function provisioningLabel(issuer, accountName) {
  const issuerLabel = encodeURIComponent(issuer).replaceAll('%20', '%20');
  const accountLabel = encodeURIComponent(accountName).replaceAll('%20', '%20');
  return `${issuerLabel}:${accountLabel}`;
}

function provisioningText(value, name) {
  if (typeof value !== 'string'
      || value.length < 1
      || value.length > 128
      || /[:\u0000-\u001f\u007f]/u.test(value)) {
    throw new TotpInputError(`${name} is invalid`);
  }
  return value;
}

export function buildOtpAuthUri({
  secret,
  accountName,
  issuer,
  period = 30,
  digits = 6,
  algorithm = 'SHA1',
} = {}) {
  const canonical = canonicalAlgorithm(algorithm);
  const width = validDigits(digits);
  const seconds = positiveInteger(period, 'period');
  const canonicalIssuer = provisioningText(issuer, 'issuer');
  const canonicalAccount = provisioningText(accountName, 'accountName');
  const query = new URLSearchParams({
    secret: encodeBase32(secret),
    issuer: canonicalIssuer,
    algorithm: canonical,
    digits: String(width),
    period: String(seconds),
  });
  return `otpauth://totp/${provisioningLabel(canonicalIssuer, canonicalAccount)}?${query}`;
}
