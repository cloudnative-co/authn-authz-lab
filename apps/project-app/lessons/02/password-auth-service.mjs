import { createHash } from 'node:crypto';
import {
  createScryptPasswordKdf,
  normalizePasswordForKdf,
  OWASP_SCRYPT_PROFILE,
  PasswordInputError,
} from '../../../../packages/password/scrypt-password.mjs';
import { LESSON_02_PASSWORD_POLICY } from '../../../../packages/password/password-policy.mjs';

const DEFAULT_RATE_LIMIT = Object.freeze({
  failureThreshold: 3,
  failureWindowMs: 30_000,
  blockDurationMs: 30_000,
  maxTrackedIdentifiers: 1024,
});
const INVALID_CREDENTIALS = Object.freeze({
  ok: false,
  status: 422,
  code: 'INVALID_CREDENTIALS',
  message: 'Invalid identifier or password.',
  sessionIssued: false,
});
const AUTHENTICATION_CAPACITY_EXCEEDED = Object.freeze({
  ok: false,
  status: 503,
  code: 'AUTHENTICATION_CAPACITY_EXCEEDED',
  message: 'Authentication temporarily unavailable.',
  retryAfterSeconds: 1,
  headers: Object.freeze({ 'retry-after': '1' }),
  sessionIssued: false,
});
const INVALID_PASSWORD_COMPARISON = 'invalid-password-input-for-comparison';

function normalizedIdentifier(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().normalize('NFC').toLowerCase();
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (bytes < 3 || bytes > 254 || /[\u0000-\u001f\u007f]/u.test(normalized)) return null;
  return normalized;
}

function rateKey(identifier) {
  return createHash('sha256').update(identifier ?? '<invalid-identifier>').digest('hex');
}

function validateClockValue(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('clock must return a non-negative integer');
  return value;
}

function validateRateLimit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('rateLimit must be an object');
  for (const name of ['failureThreshold', 'failureWindowMs', 'blockDurationMs', 'maxTrackedIdentifiers']) {
    if (!Number.isSafeInteger(value[name]) || value[name] < 1) {
      throw new TypeError(`rateLimit.${name} must be a positive integer`);
    }
  }
  return Object.freeze({
    failureThreshold: value.failureThreshold,
    failureWindowMs: value.failureWindowMs,
    blockDurationMs: value.blockDurationMs,
    maxTrackedIdentifiers: value.maxTrackedIdentifiers,
  });
}

function validateKdf(kdf) {
  if (!kdf || typeof kdf !== 'object') throw new TypeError('kdf must be an object');
  for (const method of ['hash', 'verify', 'inspect']) {
    if (typeof kdf[method] !== 'function') throw new TypeError(`kdf.${method} must be a function`);
  }
  return kdf;
}

function credentialObservation(kdf, encoded) {
  const inspected = kdf.inspect(encoded);
  return Object.freeze({
    format: inspected.format,
    version: inspected.version,
    workFactor: Object.freeze({ ...inspected.workFactor }),
    keyLength: inspected.keyLength,
    saltBytes: inspected.saltBytes,
    saltFingerprint: inspected.saltFingerprint,
  });
}

function frozenResult(value) {
  return Object.freeze(value);
}

function createRuntime({
  clock,
  kdf,
  rateLimit,
  userRecords,
  dummyCredential,
  seedObservation,
}) {
  const users = new Map(userRecords.map((record) => [record.identifier, record]));
  const attempts = new Map();
  const reservedAttemptKeys = new Set();
  const authenticationQueues = new Map();

  function now() {
    return validateClockValue(clock());
  }

  function currentAttempt(key, timestamp) {
    const attempt = attempts.get(key);
    if (!attempt) return null;
    if (attempt.blockedUntil !== null) {
      if (timestamp < attempt.blockedUntil) return attempt;
      attempts.delete(key);
      return null;
    }
    if (timestamp - attempt.windowStartedAt >= rateLimit.failureWindowMs) {
      attempts.delete(key);
      return null;
    }
    return attempt;
  }

  function pruneExpiredAttempts(timestamp) {
    for (const key of attempts.keys()) currentAttempt(key, timestamp);
  }

  function reserveAttemptCapacity(key, timestamp) {
    if (attempts.has(key) || reservedAttemptKeys.has(key)) return true;
    pruneExpiredAttempts(timestamp);
    if (attempts.size + reservedAttemptKeys.size >= rateLimit.maxTrackedIdentifiers) return false;
    reservedAttemptKeys.add(key);
    return true;
  }

  function limitedResult(attempt, timestamp) {
    const retryAfterSeconds = Math.max(1, Math.ceil((attempt.blockedUntil - timestamp) / 1000));
    return frozenResult({
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Authentication temporarily unavailable.',
      retryAfterSeconds,
      headers: Object.freeze({ 'retry-after': String(retryAfterSeconds) }),
      sessionIssued: false,
    });
  }

  function recordFailure(key, timestamp, existing) {
    const failureCount = (existing?.failureCount ?? 0) + 1;
    const attempt = {
      failureCount,
      windowStartedAt: existing?.windowStartedAt ?? timestamp,
      blockedUntil: failureCount >= rateLimit.failureThreshold
        ? timestamp + rateLimit.blockDurationMs
        : null,
    };
    attempts.set(key, attempt);
    return attempt;
  }

  async function serializeAuthentication(key, operation) {
    const predecessor = authenticationQueues.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolvePromise) => {
      release = resolvePromise;
    });
    authenticationQueues.set(key, current);
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      if (authenticationQueues.get(key) === current) authenticationQueues.delete(key);
    }
  }

  async function authenticate(identifier, password) {
    const canonicalIdentifier = normalizedIdentifier(identifier);
    const key = rateKey(canonicalIdentifier);
    if (!reserveAttemptCapacity(key, now())) return AUTHENTICATION_CAPACITY_EXCEEDED;
    try {
      return await serializeAuthentication(key, async () => {
        const timestamp = now();
        const priorAttempt = currentAttempt(key, timestamp);
        if (priorAttempt?.blockedUntil !== null && priorAttempt?.blockedUntil !== undefined) {
          return limitedResult(priorAttempt, timestamp);
        }

        const user = canonicalIdentifier ? users.get(canonicalIdentifier) : null;
        const credential = user?.credential ?? dummyCredential;
        let normalizedPassword;
        try {
          normalizedPassword = normalizePasswordForKdf(password);
        } catch (error) {
          if (!(error instanceof PasswordInputError)) throw error;
          const verified = await kdf.verify(INVALID_PASSWORD_COMPARISON, credential);
          if (typeof verified !== 'boolean') throw new TypeError('kdf.verify must return a boolean');
          const failedAttempt = recordFailure(key, timestamp, priorAttempt);
          return failedAttempt.blockedUntil === null
            ? INVALID_CREDENTIALS
            : limitedResult(failedAttempt, timestamp);
        }

        const verified = await kdf.verify(normalizedPassword, credential);
        if (typeof verified !== 'boolean') throw new TypeError('kdf.verify must return a boolean');
        if (!user || !verified) {
          const failureTimestamp = now();
          const latestAttempt = currentAttempt(key, failureTimestamp);
          if (latestAttempt?.blockedUntil !== null && latestAttempt?.blockedUntil !== undefined) {
            return limitedResult(latestAttempt, failureTimestamp);
          }
          const failedAttempt = recordFailure(key, failureTimestamp, latestAttempt);
          return failedAttempt.blockedUntil === null
            ? INVALID_CREDENTIALS
            : limitedResult(failedAttempt, failureTimestamp);
        }

        attempts.delete(key);
        return frozenResult({
          ok: true,
          status: 200,
          code: 'AUTHENTICATED',
          principal: Object.freeze({ id: user.id, identifier: user.identifier }),
          sessionIssued: false,
        });
      });
    } finally {
      reservedAttemptKeys.delete(key);
    }
  }

  function observe() {
    const timestamp = now();
    const activeRateLimits = [];
    for (const [key] of attempts) {
      const attempt = currentAttempt(key, timestamp);
      if (!attempt) continue;
      activeRateLimits.push(Object.freeze({
        keyFingerprint: key.slice(0, 16),
        failureCount: attempt.failureCount,
        blocked: attempt.blockedUntil !== null,
        retryAfterSeconds: attempt.blockedUntil === null
          ? null
          : Math.max(1, Math.ceil((attempt.blockedUntil - timestamp) / 1000)),
      }));
    }
    activeRateLimits.sort((left, right) => left.keyFingerprint.localeCompare(right.keyFingerprint));
    return structuredClone({
      schemaVersion: 1,
      lessonId: '02',
      implementation: {
        authentication: 'password',
        sessionIssuance: 'not-implemented',
        unknownUserVerification: 'dummy-scrypt',
        genericCredentialFailure: true,
      },
      kdf: {
        algorithm: 'scrypt',
        defaultProfile: {
          N: OWASP_SCRYPT_PROFILE.N,
          r: OWASP_SCRYPT_PROFILE.r,
          p: OWASP_SCRYPT_PROFILE.p,
        },
        passwordPolicyIsSeparate: true,
      },
      passwordPolicy: LESSON_02_PASSWORD_POLICY,
      seed: seedObservation,
      rateLimit: {
        configuration: rateLimit,
        trackedIdentifiers: activeRateLimits.length,
        capacityBehavior: 'reject-new-identifier-with-503-before-kdf',
        active: activeRateLimits,
      },
      redaction: {
        plaintextCredentials: 'omitted',
        encodedCredentials: 'omitted',
        derivedKeys: 'omitted',
      },
    });
  }

  return Object.freeze({ authenticate, observe });
}

async function deriveSeedState(kdf, accountSeeds, dummyPassword) {
  if (!Array.isArray(accountSeeds) || accountSeeds.length < 1 || accountSeeds.length > 32) {
    throw new TypeError('accounts must contain between 1 and 32 entries');
  }
  normalizePasswordForKdf(dummyPassword);

  const identifiers = new Set();
  const subjectIds = new Set();
  const userRecords = [];
  const userObservations = [];
  for (const [index, account] of accountSeeds.entries()) {
    if (!account || typeof account !== 'object' || Array.isArray(account)) {
      throw new TypeError(`accounts[${index}] is invalid`);
    }
    const identifier = normalizedIdentifier(account.identifier);
    if (
      !identifier
      || typeof account.id !== 'string'
      || account.id.length < 1
      || account.id.length > 128
      || /[\u0000-\u001f\u007f]/u.test(account.id)
    ) {
      throw new TypeError(`accounts[${index}] is invalid`);
    }
    if (identifiers.has(identifier) || subjectIds.has(account.id)) {
      throw new TypeError('accounts must have unique identifiers and subject IDs');
    }
    identifiers.add(identifier);
    subjectIds.add(account.id);
    normalizePasswordForKdf(account.password);
    const credential = await kdf.hash(account.password);
    userRecords.push(Object.freeze({ id: account.id, identifier, credential }));
    userObservations.push(Object.freeze({
      id: account.id,
      credential: credentialObservation(kdf, credential),
    }));
  }

  const dummyCredential = await kdf.hash(dummyPassword);
  const dummyCredentialComparison = await kdf.hash(dummyPassword);
  const dummyObservation = credentialObservation(kdf, dummyCredential);
  const comparisonObservation = credentialObservation(kdf, dummyCredentialComparison);
  if (dummyObservation.saltFingerprint === comparisonObservation.saltFingerprint) {
    throw new Error('dummy password derivations must use distinct random salts');
  }

  return Object.freeze({
    userRecords: Object.freeze(userRecords),
    dummyCredential,
    seedObservation: Object.freeze({
      users: Object.freeze(userObservations),
      dummySaltDemonstration: Object.freeze({
        sameInput: true,
        saltsDiffer: true,
        first: dummyObservation,
        second: comparisonObservation,
      }),
    }),
  });
}

export async function createLesson02PasswordService(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const clock = options.clock ?? Date.now;
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const kdf = validateKdf(options.kdf ?? createScryptPasswordKdf());
  const rateLimit = validateRateLimit(options.rateLimit ?? DEFAULT_RATE_LIMIT);
  if (options.accounts !== undefined && options.alice !== undefined) {
    throw new TypeError('accounts and alice cannot be provided together');
  }
  const defaultAccount = options.alice ?? {
    id: 'user-alice',
    identifier: 'alice@example.com',
    password: 'alice-password-for-lesson-02',
  };
  const accountSeeds = options.accounts ?? [defaultAccount];
  const seedState = await deriveSeedState(
    kdf,
    accountSeeds,
    options.dummyPassword ?? 'dummy-password-for-lesson-02',
  );
  return createRuntime({ clock, kdf, rateLimit, ...seedState });
}
