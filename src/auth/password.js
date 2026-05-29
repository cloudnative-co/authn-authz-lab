import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_ITERATIONS = 120_000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

export function hashPassword(password, options = {}) {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const salt = options.salt ?? randomBytes(16);
  const hash = pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST);
  return `pbkdf2$${DIGEST}$${iterations}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, encodedHash) {
  const [scheme, digest, iterationsRaw, saltRaw, expectedRaw] = encodedHash.split('$');
  if (scheme !== 'pbkdf2' || digest !== DIGEST) return false;

  const iterations = Number.parseInt(iterationsRaw, 10);
  const salt = Buffer.from(saltRaw, 'base64url');
  const expected = Buffer.from(expectedRaw, 'base64url');
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, digest);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function authenticateWithPassword({ users }, email, password) {
  const user = users.find((candidate) => candidate.email === email);
  if (!user) return null;
  return verifyPassword(password, user.passwordHash) ? user : null;
}
