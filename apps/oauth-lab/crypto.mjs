import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomOpaque(bytes = 32) {
  if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 64) {
    throw new TypeError('random byte count is out of bounds');
  }
  return randomBytes(bytes).toString('base64url');
}

export function digest(value) {
  if (typeof value !== 'string') throw new TypeError('digest input must be a string');
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export function pkceChallenge(verifier) {
  return digest(verifier);
}

export function canonicalVerifier(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9._~-]{43,128}$/u.test(value)
    && Buffer.byteLength(value, 'ascii') === value.length;
}

export function canonicalOpaque(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9_-]{43}$/u.test(value)
    && Buffer.from(value, 'base64url').length === 32
    && Buffer.from(value, 'base64url').toString('base64url') === value;
}

export function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
