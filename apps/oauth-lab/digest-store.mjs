import { digest } from './crypto.mjs';

export function createDigestStore({ limit = 128, now = () => Date.now() } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4096) throw new TypeError('invalid store limit');
  const records = new Map();

  function sweep() {
    const current = now();
    for (const [key, record] of records) {
      if (record.expiresAt <= current) records.delete(key);
    }
  }

  function set(rawKey, value, ttlMs) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 86_400_000) {
      throw new TypeError('invalid store TTL');
    }
    sweep();
    if (records.size >= limit) throw new Error('STORE_CAPACITY_EXCEEDED');
    records.set(digest(rawKey), { value: structuredClone(value), expiresAt: now() + ttlMs });
  }

  function get(rawKey) {
    sweep();
    const record = records.get(digest(rawKey));
    return record ? structuredClone(record.value) : null;
  }

  function take(rawKey) {
    sweep();
    const key = digest(rawKey);
    const record = records.get(key);
    records.delete(key);
    return record ? structuredClone(record.value) : null;
  }

  function remove(rawKey) {
    return records.delete(digest(rawKey));
  }

  function clear() {
    records.clear();
  }

  function size() {
    sweep();
    return records.size;
  }

  return Object.freeze({ set, get, take, remove, clear, size });
}
