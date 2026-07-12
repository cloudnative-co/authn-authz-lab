import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const PASSWORD = 'course-password-for-oauth-lab';
const OWNERS = Object.freeze([
  Object.freeze({ identifier: 'learner@example.test', password: PASSWORD, subject: 'sub-7f4b92d8e31a6c05' }),
  Object.freeze({ identifier: 'alice@example.test', password: PASSWORD, subject: 'user-100' }),
  Object.freeze({ identifier: 'bob@example.test', password: PASSWORD, subject: 'user-200' }),
  Object.freeze({ identifier: 'dave@example.test', password: PASSWORD, subject: 'user-400' }),
]);

async function derive(password, salt) {
  return scrypt(password, salt, 32, { N: 32_768, r: 8, p: 3, maxmem: 128 * 1024 * 1024 });
}

export async function createResourceOwnerAuthenticator() {
  const dummySalt = randomBytes(16);
  const records = new Map(await Promise.all(OWNERS.map(async (owner) => {
    const salt = randomBytes(16);
    return [owner.identifier, Object.freeze({
      owner,
      salt,
      expected: await derive(owner.password, salt),
    })];
  })));
  return async function authenticate(identifier, password) {
    const normalizedIdentifier = typeof identifier === 'string' ? identifier.normalize('NFC') : '';
    const normalizedPassword = typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= 1024
      ? password.normalize('NFC') : 'invalid-password-shape';
    const record = records.get(normalizedIdentifier) ?? null;
    const actual = await derive(normalizedPassword, record?.salt ?? dummySalt);
    const ok = Boolean(record) && timingSafeEqual(actual, record.expected);
    return Object.freeze({ ok, subject: ok ? record.owner.subject : null });
  };
}

export const TRAINING_RESOURCE_OWNERS = OWNERS;
export const TRAINING_RESOURCE_OWNER = OWNERS[0];
