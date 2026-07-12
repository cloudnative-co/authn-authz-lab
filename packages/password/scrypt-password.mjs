import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(nodeScrypt);
const ENCODING_PATTERN = /^\$course-scrypt\$v=1\$N=([1-9][0-9]*),r=([1-9][0-9]*),p=([1-9][0-9]*),l=([1-9][0-9]*)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_ENCODED_BYTES = 1024;
const MAX_KDF_MEMORY = 256 * 1024 * 1024;
const MIN_SALT_BYTES = 16;
const MAX_SALT_BYTES = 64;

export const SCRYPT_INPUT_LIMITS = Object.freeze({
  minimumPasswordBytes: 1,
  maximumPasswordBytes: 1024,
  maximumEncodedBytes: MAX_ENCODED_BYTES,
});

// This is an application-defined course format, not the PHC string format.
export const COURSE_SCRYPT_ENCODING = Object.freeze({
  id: 'course-scrypt',
  version: 1,
  standardsStatus: 'application-defined-not-phc',
});

export const OWASP_SCRYPT_PROFILE = Object.freeze({
  algorithm: 'scrypt',
  N: 2 ** 15,
  r: 8,
  p: 3,
  keyLength: 32,
  saltBytes: 16,
  maxmem: 128 * 1024 * 1024,
});

export class PasswordInputError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'PasswordInputError';
    this.code = 'PASSWORD_INPUT_INVALID';
  }
}

export class PasswordEncodingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PasswordEncodingError';
    this.code = 'PASSWORD_ENCODING_INVALID';
  }
}

function integer(value, name) {
  if (!Number.isSafeInteger(value)) throw new PasswordEncodingError(`${name} must be a safe integer`);
  return value;
}

function requiredMaxmem(N, r) {
  return (128 * N * r) + (1024 * 1024);
}

function validateWorkFactor({ N, r, p, keyLength }) {
  integer(N, 'N');
  integer(r, 'r');
  integer(p, 'p');
  integer(keyLength, 'keyLength');
  if (N < 2 ** 14 || N > 2 ** 18 || (N & (N - 1)) !== 0) {
    throw new PasswordEncodingError('N must be a supported power of two');
  }
  if (r < 1 || r > 16) throw new PasswordEncodingError('r is outside the supported range');
  if (p < 1 || p > 8) throw new PasswordEncodingError('p is outside the supported range');
  if (keyLength < 16 || keyLength > 64) {
    throw new PasswordEncodingError('keyLength is outside the supported range');
  }
  if (requiredMaxmem(N, r) > MAX_KDF_MEMORY) {
    throw new PasswordEncodingError('work factor exceeds the verification memory limit');
  }
}

function validateHashProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new PasswordEncodingError('profile must be an object');
  }
  if (profile.algorithm !== undefined && profile.algorithm !== 'scrypt') {
    throw new PasswordEncodingError('profile.algorithm must be scrypt');
  }
  const normalized = {
    N: profile.N,
    r: profile.r,
    p: profile.p,
    keyLength: profile.keyLength,
    saltBytes: profile.saltBytes,
    maxmem: profile.maxmem,
  };
  validateWorkFactor(normalized);
  integer(normalized.saltBytes, 'saltBytes');
  integer(normalized.maxmem, 'maxmem');
  if (normalized.saltBytes < MIN_SALT_BYTES || normalized.saltBytes > MAX_SALT_BYTES) {
    throw new PasswordEncodingError('saltBytes is outside the supported range');
  }
  if (
    normalized.maxmem < requiredMaxmem(normalized.N, normalized.r)
    || normalized.maxmem > MAX_KDF_MEMORY
  ) {
    throw new PasswordEncodingError('maxmem is outside the supported range');
  }
  return normalized;
}

export function normalizePasswordForKdf(password) {
  if (typeof password !== 'string') throw new PasswordInputError('password must be a string');
  const normalized = password.normalize('NFC');
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (
    bytes < SCRYPT_INPUT_LIMITS.minimumPasswordBytes
    || bytes > SCRYPT_INPUT_LIMITS.maximumPasswordBytes
  ) {
    throw new PasswordInputError('password byte length is outside the supported range');
  }
  return normalized;
}

function decodeBase64url(value, label) {
  if (!BASE64URL_PATTERN.test(value)) throw new PasswordEncodingError(`${label} is not base64url`);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0 || decoded.toString('base64url') !== value) {
    throw new PasswordEncodingError(`${label} is not canonical base64url`);
  }
  return decoded;
}

export function parseStoredPassword(encoded) {
  if (typeof encoded !== 'string') throw new PasswordEncodingError('encoded password must be a string');
  if (Buffer.byteLength(encoded, 'utf8') > MAX_ENCODED_BYTES) {
    throw new PasswordEncodingError('encoded password is too large');
  }
  const match = ENCODING_PATTERN.exec(encoded);
  if (!match) throw new PasswordEncodingError('encoded password does not match the supported format');
  const N = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  const keyLength = Number(match[4]);
  validateWorkFactor({ N, r, p, keyLength });
  const salt = decodeBase64url(match[5], 'salt');
  const derivedKey = decodeBase64url(match[6], 'derived key');
  if (salt.length < MIN_SALT_BYTES || salt.length > MAX_SALT_BYTES) {
    throw new PasswordEncodingError('salt length is outside the supported range');
  }
  if (derivedKey.length !== keyLength) {
    throw new PasswordEncodingError('derived key length does not match the stored metadata');
  }
  return { version: 1, N, r, p, keyLength, salt, derivedKey };
}

function encodeStoredPassword({ N, r, p, keyLength, salt, derivedKey }) {
  return `$course-scrypt$v=1$N=${N},r=${r},p=${p},l=${keyLength}`
    + `$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

async function derive(password, salt, workFactor, scrypt = scryptAsync) {
  const normalized = normalizePasswordForKdf(password);
  const passwordBytes = Buffer.from(normalized, 'utf8');
  try {
    const derived = await scrypt(passwordBytes, salt, workFactor.keyLength, {
      N: workFactor.N,
      r: workFactor.r,
      p: workFactor.p,
      maxmem: workFactor.maxmem,
    });
    const result = Buffer.from(derived);
    if (result.length !== workFactor.keyLength) {
      result.fill(0);
      throw new Error('scrypt returned an unexpected derived key length');
    }
    return result;
  } finally {
    passwordBytes.fill(0);
  }
}

export async function hashPassword(password, options = {}) {
  const profile = validateHashProfile(options.profile ?? OWASP_SCRYPT_PROFILE);
  const randomBytesFunction = options.randomBytes ?? randomBytes;
  const salt = Buffer.from(await randomBytesFunction(profile.saltBytes));
  if (salt.length !== profile.saltBytes) throw new Error('randomBytes returned an unexpected salt length');
  const derivedKey = await derive(password, salt, profile, options.scrypt ?? scryptAsync);
  try {
    return encodeStoredPassword({ ...profile, salt, derivedKey });
  } finally {
    derivedKey.fill(0);
  }
}

export async function verifyPassword(password, encoded, options = {}) {
  const parsed = parseStoredPassword(encoded);
  const maxmem = Math.max(OWASP_SCRYPT_PROFILE.maxmem, requiredMaxmem(parsed.N, parsed.r));
  const candidate = await derive(password, parsed.salt, { ...parsed, maxmem }, options.scrypt ?? scryptAsync);
  try {
    return timingSafeEqual(candidate, parsed.derivedKey);
  } finally {
    candidate.fill(0);
  }
}

export function inspectStoredPassword(encoded) {
  const parsed = parseStoredPassword(encoded);
  return Object.freeze({
    format: COURSE_SCRYPT_ENCODING.id,
    version: parsed.version,
    workFactor: Object.freeze({ N: parsed.N, r: parsed.r, p: parsed.p }),
    keyLength: parsed.keyLength,
    saltBytes: parsed.salt.length,
    saltFingerprint: createHash('sha256').update(parsed.salt).digest('hex').slice(0, 16),
  });
}

export function createScryptPasswordKdf(options = {}) {
  const profile = options.profile ?? OWASP_SCRYPT_PROFILE;
  return Object.freeze({
    hash: (password) => hashPassword(password, { ...options, profile }),
    verify: (password, encoded) => verifyPassword(password, encoded, options),
    inspect: inspectStoredPassword,
  });
}
