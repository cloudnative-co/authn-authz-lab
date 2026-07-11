import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { base32Decode, base32Encode } from './base32.js';

export function hotp(keyBuffer, counter, digits = 6) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', keyBuffer).update(counterBuffer).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function generateTotp(base32Secret, { now = Date.now(), stepSeconds = 30, digits = 6 } = {}) {
  const counter = BigInt(Math.floor(now / 1000 / stepSeconds));
  return hotp(base32Decode(base32Secret), counter, digits);
}

export function verifyTotp(token, base32Secret, { now = Date.now(), stepSeconds = 30, digits = 6, window = 1 } = {}) {
  const key = base32Decode(base32Secret);
  const current = Math.floor(now / 1000 / stepSeconds);
  const tokenBuffer = Buffer.from(String(token));
  for (let step = -window; step <= window; step += 1) {
    const counter = current + step;
    if (counter < 0) continue;
    const candidate = Buffer.from(hotp(key, BigInt(counter), digits));
    if (candidate.length === tokenBuffer.length && timingSafeEqual(candidate, tokenBuffer)) {
      return true;
    }
  }
  return false;
}

export function generateTotpSecret(bytes = 20) {
  return base32Encode(randomBytes(bytes)).replace(/=+$/, '');
}

export function buildOtpauthUri({ issuer, accountName, secret }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}
