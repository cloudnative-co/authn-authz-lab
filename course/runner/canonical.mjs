import { createHash } from 'node:crypto';

function normalizeNumber(value, path) {
  if (!Number.isFinite(value)) throw new TypeError(`${path}: non-finite numbers are not canonical JSON`);
  return Object.is(value, -0) ? 0 : value;
}

function normalize(value, path, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return normalizeNumber(value, path);
  if (typeof value !== 'object') {
    throw new TypeError(`${path}: ${typeof value} is not representable as canonical JSON`);
  }
  if (ancestors.has(value)) throw new TypeError(`${path}: circular value is not canonical JSON`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => normalize(entry, `${path}[${index}]`, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path}: only plain objects are canonical JSON objects`);
    }
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalize(value[key], `${path}.${key}`, ancestors);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalize(value) {
  return normalize(value, '$', new Set());
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function digestCanonical(value) {
  return sha256Hex(canonicalJson(value));
}
