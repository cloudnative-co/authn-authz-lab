import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TOKEN_CHARACTERS = 43;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export class SessionTokenError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'SessionTokenError';
    this.code = 'SESSION_TOKEN_INVALID';
  }
}

export function parseSessionToken(value) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    throw new SessionTokenError('session token must be canonical unpadded base64url');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== SESSION_TOKEN_BYTES || bytes.toString('base64url') !== value) {
    bytes.fill(0);
    throw new SessionTokenError('session token must encode exactly 256 random bits');
  }
  bytes.fill(0);
  return value;
}

export function createSessionToken(randomBytes = nodeRandomBytes) {
  if (typeof randomBytes !== 'function') {
    throw new TypeError('randomBytes must be a function');
  }
  const supplied = randomBytes(SESSION_TOKEN_BYTES);
  if (supplied && typeof supplied.then === 'function') {
    throw new TypeError('randomBytes must return bytes synchronously');
  }
  let bytes;
  try {
    bytes = Buffer.from(supplied);
  } catch {
    throw new TypeError('randomBytes must return a byte sequence');
  }
  try {
    if (bytes.length !== SESSION_TOKEN_BYTES) {
      throw new TypeError(`randomBytes must return exactly ${SESSION_TOKEN_BYTES} bytes`);
    }
    const token = bytes.toString('base64url');
    parseSessionToken(token);
    return token;
  } finally {
    bytes.fill(0);
  }
}

export function digestSessionToken(value) {
  const token = parseSessionToken(value);
  return createHash('sha256').update(token, 'ascii').digest('hex');
}

export function sessionDigestFingerprint(digest) {
  if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
    throw new TypeError('session token digest must be a lowercase SHA-256 hex digest');
  }
  return digest.slice(0, 16);
}
