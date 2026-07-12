import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { createBoundedSessionStore } from '../../../../packages/session/bounded-session-store.mjs';
import {
  createSessionToken,
  digestSessionToken,
  SessionTokenError,
} from '../../../../packages/session/session-token.mjs';
import { describeSessionCookieConfiguration } from '../../../../packages/session/session-cookie.mjs';

const ACTIVE_STATUSES = new Set(['pre-authenticated', 'authenticated']);
const DEFAULTS = Object.freeze({
  preAuthLifetimeMs: 5 * 60 * 1000,
  absoluteLifetimeMs: 30 * 60 * 1000,
  maxSessions: 128,
  maxEvents: 256,
  tokenGenerationAttempts: 8,
});
const SESSION_UNAVAILABLE = Object.freeze({
  ok: false,
  status: 403,
  code: 'SESSION_UNAVAILABLE',
  message: 'Session is unavailable.',
  sessionIssued: false,
});
const INVALID_CREDENTIALS = Object.freeze({
  ok: false,
  status: 422,
  code: 'INVALID_CREDENTIALS',
  message: 'Invalid identifier or password.',
  sessionIssued: false,
});
const LOGGED_OUT = Object.freeze({
  ok: true,
  status: 204,
  code: 'LOGGED_OUT',
  sessionIssued: false,
});

function transientAuthenticationFailure(result) {
  const recognized = (
    result.status === 429 && result.code === 'RATE_LIMITED'
  ) || (
    result.status === 503 && result.code === 'AUTHENTICATION_CAPACITY_EXCEEDED'
  );
  if (!recognized) return null;
  if (!Number.isSafeInteger(result.retryAfterSeconds) || result.retryAfterSeconds < 1) {
    throw new TypeError('authenticator transient failure must include a positive Retry-After');
  }
  return Object.freeze({
    ok: false,
    status: result.status,
    code: result.code,
    message: 'Authentication temporarily unavailable.',
    retryAfterSeconds: result.retryAfterSeconds,
    headers: Object.freeze({ 'retry-after': String(result.retryAfterSeconds) }),
    sessionIssued: false,
  });
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function safeExpiry(timestamp, lifetime, name) {
  const expiresAt = timestamp + lifetime;
  if (!Number.isSafeInteger(expiresAt)) throw new TypeError(`${name} exceeds the clock range`);
  return expiresAt;
}

function createTimestamps({ createdAt, authenticatedAt = null, expiresAt, revokedAt = null, expiredAt = null }) {
  return Object.freeze({ createdAt, authenticatedAt, expiresAt, revokedAt, expiredAt });
}

function normalizeSubject(principal) {
  if (!principal || typeof principal !== 'object' || Array.isArray(principal)) {
    throw new TypeError('authenticator success must include a principal');
  }
  if (
    typeof principal.id !== 'string'
    || principal.id.length < 1
    || principal.id.length > 128
    || /[\u0000-\u001f\u007f]/u.test(principal.id)
  ) {
    throw new TypeError('authenticator principal id is invalid');
  }
  const subject = { id: principal.id };
  if (principal.identifier !== undefined) {
    if (
      typeof principal.identifier !== 'string'
      || principal.identifier.length < 1
      || principal.identifier.length > 254
      || /[\u0000-\u001f\u007f]/u.test(principal.identifier)
    ) {
      throw new TypeError('authenticator principal identifier is invalid');
    }
    subject.identifier = principal.identifier;
  }
  return Object.freeze(subject);
}

function validateAuthenticator(authenticator) {
  const method = typeof authenticator === 'function' ? authenticator : authenticator?.authenticate;
  if (typeof method !== 'function') {
    throw new TypeError('authenticator must be a function or expose authenticate');
  }
  return (identifier, password) => method.call(authenticator, identifier, password);
}

export function createLesson03SessionService(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const clock = options.clock ?? Date.now;
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof randomBytes !== 'function') throw new TypeError('randomBytes must be a function');
  const authenticate = validateAuthenticator(options.authenticator);
  const configuration = Object.freeze({
    preAuthLifetimeMs: positiveInteger(
      options.preAuthLifetimeMs ?? DEFAULTS.preAuthLifetimeMs,
      'preAuthLifetimeMs',
    ),
    absoluteLifetimeMs: positiveInteger(
      options.absoluteLifetimeMs ?? DEFAULTS.absoluteLifetimeMs,
      'absoluteLifetimeMs',
    ),
    maxSessions: positiveInteger(options.maxSessions ?? DEFAULTS.maxSessions, 'maxSessions'),
    maxEvents: positiveInteger(options.maxEvents ?? DEFAULTS.maxEvents, 'maxEvents'),
    tokenGenerationAttempts: positiveInteger(
      options.tokenGenerationAttempts ?? DEFAULTS.tokenGenerationAttempts,
      'tokenGenerationAttempts',
    ),
    secureCookies: options.secureCookies ?? true,
  });
  if (typeof configuration.secureCookies !== 'boolean') {
    throw new TypeError('secureCookies must be a boolean');
  }
  const store = createBoundedSessionStore(configuration);

  function now() {
    const timestamp = clock();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError('clock must return a non-negative safe integer');
    }
    return timestamp;
  }

  function appendEvent(type, digest, record, timestamp) {
    store.appendEvent({
      type,
      tokenDigest: digest,
      subject: record.subject,
      status: record.status,
      timestamp,
    });
  }

  function expireRecord(digest, record, timestamp) {
    if (!ACTIVE_STATUSES.has(record.status) || timestamp < record.timestamps.expiresAt) return record;
    const expired = store.put({
      ...record,
      status: 'expired',
      timestamps: createTimestamps({
        ...record.timestamps,
        expiredAt: timestamp,
      }),
    });
    appendEvent('session-expired', digest, expired, timestamp);
    return expired;
  }

  function sweepExpired(timestamp) {
    for (const [digest, record] of store.entries()) expireRecord(digest, record, timestamp);
  }

  function terminalTimestamp(record) {
    return record.timestamps.expiredAt ?? record.timestamps.revokedAt ?? record.timestamps.createdAt;
  }

  function reserveSlot() {
    if (store.size() < configuration.maxSessions) return true;
    const terminal = store.entries()
      .filter(([, record]) => !ACTIVE_STATUSES.has(record.status))
      .sort((left, right) => terminalTimestamp(left[1]) - terminalTimestamp(right[1]));
    for (const [digest] of terminal) {
      store.delete(digest);
      if (store.size() < configuration.maxSessions) return true;
    }
    return false;
  }

  function freshTokenPair() {
    for (let attempt = 0; attempt < configuration.tokenGenerationAttempts; attempt += 1) {
      const token = createSessionToken(randomBytes);
      const digest = digestSessionToken(token);
      if (!store.has(digest)) return { token, digest };
    }
    throw new Error('unable to generate a unique session token');
  }

  function resolve(token, expectedStatus, timestamp) {
    let digest;
    try {
      digest = digestSessionToken(token);
    } catch (error) {
      if (error instanceof SessionTokenError) return null;
      throw error;
    }
    const existing = store.get(digest);
    if (!existing) return null;
    const record = expireRecord(digest, existing, timestamp);
    if (expectedStatus !== null && record.status !== expectedStatus) return null;
    return { digest, record };
  }

  function revokeResolved(resolved, timestamp, eventType) {
    if (!ACTIVE_STATUSES.has(resolved.record.status)) return false;
    const revoked = store.put({
      ...resolved.record,
      status: 'revoked',
      timestamps: createTimestamps({ ...resolved.record.timestamps, revokedAt: timestamp }),
    });
    appendEvent(eventType, resolved.digest, revoked, timestamp);
    return true;
  }

  function createPreAuthSession() {
    const timestamp = now();
    sweepExpired(timestamp);
    if (!reserveSlot()) {
      return Object.freeze({
        ok: false,
        status: 503,
        code: 'SESSION_CAPACITY_EXHAUSTED',
        message: 'Session service is temporarily unavailable.',
        sessionIssued: false,
      });
    }
    const { token, digest } = freshTokenPair();
    const expiresAt = safeExpiry(timestamp, configuration.preAuthLifetimeMs, 'preAuthLifetimeMs');
    const record = store.put({
      tokenDigest: digest,
      subject: null,
      status: 'pre-authenticated',
      timestamps: createTimestamps({ createdAt: timestamp, expiresAt }),
    });
    appendEvent('pre-auth-session-created', digest, record, timestamp);
    return Object.freeze({
      ok: true,
      status: 201,
      code: 'PRE_AUTH_SESSION_CREATED',
      sessionToken: token,
      expiresAt,
      sessionIssued: true,
    });
  }

  async function login(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return SESSION_UNAVAILABLE;
    const initial = resolve(input.sessionToken, 'pre-authenticated', now());
    if (!initial) return SESSION_UNAVAILABLE;
    const result = await authenticate(input.identifier, input.password);
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      throw new TypeError('authenticator must return an authentication result');
    }
    const completionTime = now();
    const current = resolve(input.sessionToken, 'pre-authenticated', completionTime);
    if (!current || current.digest !== initial.digest) return SESSION_UNAVAILABLE;
    if (!result.ok) return transientAuthenticationFailure(result) ?? INVALID_CREDENTIALS;

    const subject = normalizeSubject(result.principal);
    const replacement = freshTokenPair();
    const expiresAt = safeExpiry(
      completionTime,
      configuration.absoluteLifetimeMs,
      'absoluteLifetimeMs',
    );
    revokeResolved(current, completionTime, 'session-rotated-out');
    if (!reserveSlot()) throw new Error('rotated session did not release a store slot');
    const authenticated = store.put({
      tokenDigest: replacement.digest,
      subject,
      status: 'authenticated',
      timestamps: createTimestamps({
        createdAt: completionTime,
        authenticatedAt: completionTime,
        expiresAt,
      }),
    });
    appendEvent('authenticated-session-created', replacement.digest, authenticated, completionTime);
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'AUTHENTICATED',
      principal: authenticated.subject,
      sessionToken: replacement.token,
      expiresAt,
      sessionRotated: true,
      sessionIssued: true,
    });
  }

  function currentUser(sessionToken) {
    const resolved = resolve(sessionToken, 'authenticated', now());
    if (!resolved) return SESSION_UNAVAILABLE;
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'CURRENT_USER',
      principal: resolved.record.subject,
      expiresAt: resolved.record.timestamps.expiresAt,
    });
  }

  function logout(sessionToken) {
    const timestamp = now();
    const resolved = resolve(sessionToken, null, timestamp);
    if (resolved) revokeResolved(resolved, timestamp, 'session-logged-out');
    return LOGGED_OUT;
  }

  function revokeSubject(subjectId) {
    if (
      typeof subjectId !== 'string'
      || subjectId.length < 1
      || subjectId.length > 128
      || /[\u0000-\u001f\u007f]/u.test(subjectId)
    ) {
      throw new TypeError('subjectId is invalid');
    }
    const timestamp = now();
    sweepExpired(timestamp);
    let revokedCount = 0;
    for (const [digest, record] of store.entries()) {
      if (record.status !== 'authenticated' || record.subject.id !== subjectId) continue;
      if (revokeResolved({ digest, record }, timestamp, 'session-server-revoked')) revokedCount += 1;
    }
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'SUBJECT_SESSIONS_REVOKED',
      revokedCount,
    });
  }

  function observe() {
    const timestamp = now();
    sweepExpired(timestamp);
    return structuredClone({
      schemaVersion: 1,
      lessonId: '03',
      implementation: {
        sessionToken: 'opaque-256-bit-random',
        serverStorage: 'sha-256-token-digest-only',
        loginRotation: 'mandatory',
        expiration: 'absolute-not-sliding',
        serverSideRevocation: true,
      },
      configuration,
      cookie: describeSessionCookieConfiguration({ secure: configuration.secureCookies }),
      state: store.observe(),
      redaction: {
        sessionTokens: 'omitted',
        fullTokenDigests: 'omitted',
        tokenDigestFingerprints: 'first-16-hex-only',
        credentials: 'omitted',
      },
    });
  }

  return Object.freeze({
    createPreAuthSession,
    login,
    currentUser,
    logout,
    revokeSubject,
    observe,
  });
}
