import { randomBytes } from 'node:crypto';

export class SessionStore {
  constructor({ ttlMs = 1000 * 60 * 60 } = {}) {
    this.ttlMs = ttlMs;
    this.sessions = new Map();
  }

  create(userId, now = Date.now()) {
    const id = randomBytes(32).toString('base64url');
    this.sessions.set(id, {
      userId,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    });
    return id;
  }

  resolve(id, now = Date.now()) {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.sessions.delete(id);
      return null;
    }
    return session.userId;
  }

  destroy(id) {
    this.sessions.delete(id);
  }
}

export function parseCookie(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [key, ...value] = entry.split('=');
        return [key, decodeURIComponent(value.join('='))];
      }),
  );
}

export function sessionCookie(sessionId) {
  return `session_id=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/`;
}
