import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new TypeError('value must be a bounded non-empty string');
  }
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export class BoundedDigestStore {
  #entries = new Map();

  constructor({ maxEntries = 256, ttlMs = 5 * 60_000, now = Date.now } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096) {
      throw new TypeError('maxEntries is invalid');
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 24 * 60 * 60_000) {
      throw new TypeError('ttlMs is invalid');
    }
    if (typeof now !== 'function') throw new TypeError('now is required');
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  #purgeExpired() {
    const cutoff = this.now() - this.ttlMs;
    for (const [digest, entry] of this.#entries) {
      if (entry.createdAt <= cutoff) this.#entries.delete(digest);
    }
  }

  set(key, value) {
    this.#purgeExpired();
    const digest = sha256(key);
    if (!this.#entries.has(digest) && this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      this.#entries.delete(oldest);
    }
    this.#entries.set(digest, Object.freeze({ createdAt: this.now(), value }));
  }

  get(key) {
    this.#purgeExpired();
    return this.#entries.get(sha256(key))?.value ?? null;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.#purgeExpired();
    return this.#entries.delete(sha256(key));
  }

  get size() {
    this.#purgeExpired();
    return this.#entries.size;
  }

  snapshot() {
    this.#purgeExpired();
    return Object.freeze([...this.#entries].map(([digest, entry]) => Object.freeze({
      digest,
      createdAt: entry.createdAt,
    })));
  }
}

export class DigestCacheProvider {
  constructor(options = {}) {
    this.store = new BoundedDigestStore(options);
  }

  async saveAsync(key, value) {
    this.store.set(key, value);
    return key;
  }

  async getAsync(key) {
    return this.store.get(key);
  }

  async removeAsync(key) {
    const value = this.store.get(key);
    this.store.delete(key);
    return value;
  }
}

export class LoginTransactionStore {
  constructor(options = {}) {
    this.store = new BoundedDigestStore(options);
  }

  create(requestId) {
    const relayState = randomBytes(32).toString('base64url');
    this.store.set(relayState, sha256(requestId));
    return relayState;
  }

  matches(relayState, requestId) {
    const expected = this.store.get(relayState);
    return expected !== null && constantTimeEqual(expected, sha256(requestId));
  }

  consume(relayState) {
    this.store.delete(relayState);
  }
}
