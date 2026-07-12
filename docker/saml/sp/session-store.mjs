import { randomBytes } from 'node:crypto';
import { BoundedDigestStore } from '../../../packages/saml-strict/bounded-store.mjs';

const COOKIE_NAME = 'lesson09_session';

export class SessionStore {
  constructor({ now = Date.now } = {}) {
    this.store = new BoundedDigestStore({ maxEntries: 256, ttlMs: 10 * 60_000, now });
    this.createdCount = 0;
  }

  create(subjectDigest) {
    const token = randomBytes(32).toString('base64url');
    this.store.set(token, Object.freeze({ subjectDigest }));
    this.createdCount += 1;
    return Object.freeze({
      token,
      cookie: `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
    });
  }

  resolve(cookieHeader) {
    if (typeof cookieHeader !== 'string' || cookieHeader.length > 4096) return null;
    const values = cookieHeader.split(';').map((part) => part.trim())
      .filter((part) => part.startsWith(`${COOKIE_NAME}=`));
    if (values.length !== 1) return null;
    const token = values[0].slice(COOKIE_NAME.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    return this.store.get(token);
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
