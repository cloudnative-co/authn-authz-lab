import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import { createLesson02PasswordService } from '../02/password-auth-service.mjs';
import { createSessionToken, digestSessionToken } from '../../../../packages/session/session-token.mjs';
import {
  buildOtpAuthUri,
  createTotpSecret,
  encodeBase32,
  verifyTotp,
} from '../../../../packages/totp/totp.mjs';

const DEFAULTS = Object.freeze({
  issuer: 'CloudNative Course',
  period: 30,
  digits: 6,
  algorithm: 'SHA1',
  window: 1,
  transactionLifetimeMs: 5 * 60 * 1000,
  sessionLifetimeMs: 30 * 60 * 1000,
  failureThreshold: 3,
  failureWindowMs: 30 * 1000,
  blockDurationMs: 30 * 1000,
  recoveryCodeCount: 4,
});
const INVALID_SECOND_FACTOR = Object.freeze({
  ok: false,
  status: 422,
  code: 'INVALID_SECOND_FACTOR',
  message: 'The second factor could not be verified.',
  sessionIssued: false,
});
const TRANSACTION_UNAVAILABLE = Object.freeze({
  ok: false,
  status: 403,
  code: 'PRE_AUTH_UNAVAILABLE',
  message: 'The authentication transaction is unavailable.',
  sessionIssued: false,
});

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function safeTime(clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('clock must return a non-negative integer');
  return value;
}

function safeExpiry(now, lifetime) {
  const expiresAt = now + lifetime;
  if (!Number.isSafeInteger(expiresAt)) throw new TypeError('expiry exceeds the clock range');
  return expiresAt;
}

function tokenPair(randomBytes, existing) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = createSessionToken(randomBytes);
    const digest = digestSessionToken(token);
    if (!existing.has(digest)) return { token, digest };
  }
  throw new Error('unable to allocate a unique transaction token');
}

function tokenDigest(value) {
  try {
    return digestSessionToken(value);
  } catch {
    return null;
  }
}

function recoveryDigest(salt, value) {
  return createHash('sha256').update('lesson-12-recovery\0').update(salt).update(value, 'ascii').digest();
}

function recoveryCode(randomBytes) {
  const raw = encodeBase32(randomBytes(20));
  return raw.match(/.{8}/gu).join('-');
}

function createRecoveryRecords(randomBytes, count) {
  const codes = [];
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const code = recoveryCode(randomBytes);
    const salt = Buffer.from(randomBytes(16));
    if (salt.length !== 16) throw new TypeError('randomBytes returned the wrong recovery salt length');
    codes.push(code);
    records.push({ salt, digest: recoveryDigest(salt, code), usedAt: null });
  }
  if (new Set(codes).size !== codes.length) throw new Error('recovery code collision');
  return { codes: Object.freeze(codes), records };
}

function verifyRecoveryCode(records, value) {
  const candidate = typeof value === 'string' && /^[A-Z2-7]{8}(?:-[A-Z2-7]{8}){3}$/u.test(value)
    ? value
    : 'AAAAAAAA-AAAAAAAA-AAAAAAAA-AAAAAAAA';
  let matched = -1;
  for (const [index, record] of records.entries()) {
    const digest = recoveryDigest(record.salt, candidate);
    if (record.usedAt === null && timingSafeEqual(digest, record.digest)) matched = index;
  }
  return matched;
}

function frozenFailure(result) {
  const retryAfterSeconds = result.retryAfterSeconds;
  return Object.freeze({
    ok: false,
    status: result.status,
    code: result.code,
    message: result.message,
    retryAfterSeconds,
    headers: Object.freeze({ 'retry-after': String(retryAfterSeconds) }),
    sessionIssued: false,
  });
}

export async function createLesson12MfaService(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const clock = options.clock ?? Date.now;
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof randomBytes !== 'function') throw new TypeError('randomBytes must be a function');
  const configuration = Object.freeze({
    issuer: options.issuer ?? DEFAULTS.issuer,
    period: positiveInteger(options.period ?? DEFAULTS.period, 'period'),
    digits: positiveInteger(options.digits ?? DEFAULTS.digits, 'digits'),
    algorithm: options.algorithm ?? DEFAULTS.algorithm,
    window: options.window ?? DEFAULTS.window,
    transactionLifetimeMs: positiveInteger(
      options.transactionLifetimeMs ?? DEFAULTS.transactionLifetimeMs,
      'transactionLifetimeMs',
    ),
    sessionLifetimeMs: positiveInteger(
      options.sessionLifetimeMs ?? DEFAULTS.sessionLifetimeMs,
      'sessionLifetimeMs',
    ),
    failureThreshold: positiveInteger(
      options.failureThreshold ?? DEFAULTS.failureThreshold,
      'failureThreshold',
    ),
    failureWindowMs: positiveInteger(
      options.failureWindowMs ?? DEFAULTS.failureWindowMs,
      'failureWindowMs',
    ),
    blockDurationMs: positiveInteger(
      options.blockDurationMs ?? DEFAULTS.blockDurationMs,
      'blockDurationMs',
    ),
    recoveryCodeCount: positiveInteger(
      options.recoveryCodeCount ?? DEFAULTS.recoveryCodeCount,
      'recoveryCodeCount',
    ),
  });
  if (configuration.digits !== 6
      || !Number.isSafeInteger(configuration.window)
      || configuration.window > 1
      || configuration.window < 0) {
    throw new TypeError('the lesson supports six digits and a window from zero through one');
  }
  if (!['SHA1', 'SHA256', 'SHA512'].includes(configuration.algorithm)) {
    throw new TypeError('algorithm is unsupported');
  }

  const passwordService = options.passwordService ?? await createLesson02PasswordService({ clock });
  if (!passwordService || typeof passwordService.authenticate !== 'function') {
    throw new TypeError('passwordService must expose authenticate');
  }
  const enrollments = new Map();
  const preAuth = new Map();
  const sessions = new Map();
  const factors = new Map();
  const attempts = new Map();
  const events = [];

  function now() {
    return safeTime(clock);
  }

  function event(type, subjectId, details = {}) {
    events.push(Object.freeze({ type, subjectId, timestamp: now(), ...details }));
    if (events.length > 256) events.shift();
  }

  function sweep(timestamp = now()) {
    for (const [digest, record] of enrollments) {
      if (timestamp >= record.expiresAt) enrollments.delete(digest);
    }
    for (const [digest, record] of preAuth) {
      if (timestamp >= record.expiresAt) preAuth.delete(digest);
    }
    for (const [digest, record] of sessions) {
      if (timestamp >= record.expiresAt) sessions.delete(digest);
    }
    for (const [subjectId, attempt] of attempts) {
      const expiredWindow = timestamp - attempt.windowStartedAt >= configuration.failureWindowMs;
      const expiredBlock = attempt.blockedUntil !== null && timestamp >= attempt.blockedUntil;
      if (expiredWindow || expiredBlock) attempts.delete(subjectId);
    }
  }

  function resolve(map, token, timestamp = now()) {
    sweep(timestamp);
    const digest = tokenDigest(token);
    if (digest === null) return null;
    const record = map.get(digest);
    return record ? { digest, record } : null;
  }

  function currentLimit(subjectId, timestamp) {
    sweep(timestamp);
    const attempt = attempts.get(subjectId);
    if (!attempt?.blockedUntil || timestamp >= attempt.blockedUntil) return null;
    const retryAfterSeconds = Math.max(1, Math.ceil((attempt.blockedUntil - timestamp) / 1000));
    return frozenFailure({
      status: 429,
      code: 'SECOND_FACTOR_RATE_LIMITED',
      message: 'Second-factor verification is temporarily unavailable.',
      retryAfterSeconds,
    });
  }

  function recordFailure(subjectId, timestamp, reason) {
    const previous = attempts.get(subjectId);
    const sameWindow = previous && timestamp - previous.windowStartedAt < configuration.failureWindowMs;
    const count = (sameWindow ? previous.failureCount : 0) + 1;
    const blockedUntil = count >= configuration.failureThreshold
      ? timestamp + configuration.blockDurationMs
      : null;
    attempts.set(subjectId, {
      failureCount: count,
      windowStartedAt: sameWindow ? previous.windowStartedAt : timestamp,
      blockedUntil,
    });
    event('second-factor-rejected', subjectId, { reason, rateLimited: blockedUntil !== null });
    return blockedUntil === null ? INVALID_SECOND_FACTOR : currentLimit(subjectId, timestamp);
  }

  async function authenticatePassword(identifier, password) {
    const result = await passwordService.authenticate(identifier, password);
    if (!result || typeof result.ok !== 'boolean') throw new TypeError('password service result is invalid');
    return result;
  }

  function issue(map, record) {
    const pair = tokenPair(randomBytes, map);
    map.set(pair.digest, record);
    return pair.token;
  }

  async function beginEnrollment(identifier, password) {
    const passwordResult = await authenticatePassword(identifier, password);
    if (!passwordResult.ok) return passwordResult;
    const subject = passwordResult.principal;
    if (factors.has(subject.id)) {
      return Object.freeze({
        ok: false,
        status: 409,
        code: 'FACTOR_ALREADY_ACTIVE',
        message: 'A second factor is already active.',
        sessionIssued: false,
      });
    }
    const timestamp = now();
    const token = issue(enrollments, {
      subject,
      secret: null,
      expiresAt: safeExpiry(timestamp, configuration.transactionLifetimeMs),
    });
    event('enrollment-password-verified', subject.id);
    return Object.freeze({
      ok: true,
      status: 201,
      code: 'ENROLLMENT_PASSWORD_VERIFIED',
      enrollmentToken: token,
      expiresAt: safeExpiry(timestamp, configuration.transactionLifetimeMs),
      sessionIssued: false,
    });
  }

  function startEnrollment(enrollmentToken) {
    const resolved = resolve(enrollments, enrollmentToken);
    if (!resolved) return TRANSACTION_UNAVAILABLE;
    if (factors.has(resolved.record.subject.id)) return TRANSACTION_UNAVAILABLE;
    if (resolved.record.secret === null) {
      resolved.record.secret = createTotpSecret(randomBytes);
      event('totp-secret-generated', resolved.record.subject.id);
    }
    const { subject, secret, expiresAt } = resolved.record;
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'TOTP_ENROLLMENT_STARTED',
      secret: encodeBase32(secret),
      provisioningUri: buildOtpAuthUri({
        secret,
        accountName: subject.identifier,
        issuer: configuration.issuer,
        period: configuration.period,
        digits: configuration.digits,
        algorithm: configuration.algorithm,
      }),
      algorithm: configuration.algorithm,
      digits: configuration.digits,
      period: configuration.period,
      expiresAt,
      sessionIssued: false,
    });
  }

  function confirmEnrollment(enrollmentToken, code) {
    const timestamp = now();
    const resolved = resolve(enrollments, enrollmentToken, timestamp);
    if (!resolved?.record.secret || factors.has(resolved?.record.subject.id)) {
      return TRANSACTION_UNAVAILABLE;
    }
    const limited = currentLimit(resolved.record.subject.id, timestamp);
    if (limited) return limited;
    const verification = verifyTotp({
      secret: resolved.record.secret,
      code,
      timeMs: timestamp,
      period: configuration.period,
      digits: configuration.digits,
      algorithm: configuration.algorithm,
      window: configuration.window,
    });
    if (!verification.ok) {
      return recordFailure(resolved.record.subject.id, timestamp, verification.reason);
    }
    const recovery = createRecoveryRecords(randomBytes, configuration.recoveryCodeCount);
    factors.set(resolved.record.subject.id, {
      secret: Buffer.from(resolved.record.secret),
      lastAcceptedCounter: verification.counter,
      recoveryRecords: recovery.records,
      enrolledAt: timestamp,
    });
    attempts.delete(resolved.record.subject.id);
    enrollments.delete(resolved.digest);
    event('totp-enrolled', resolved.record.subject.id, {
      confirmationCounterStoredForReplayDefense: true,
      recoveryCodeCount: recovery.codes.length,
    });
    return Object.freeze({
      ok: true,
      status: 201,
      code: 'TOTP_ENROLLED',
      recoveryCodes: recovery.codes,
      recoveryCodesShownOnce: true,
      sessionIssued: false,
    });
  }

  async function beginLogin(identifier, password) {
    const passwordResult = await authenticatePassword(identifier, password);
    if (!passwordResult.ok) return passwordResult;
    const subject = passwordResult.principal;
    if (!factors.has(subject.id)) {
      return Object.freeze({
        ok: false,
        status: 409,
        code: 'SECOND_FACTOR_NOT_ENROLLED',
        message: 'A second factor must be enrolled.',
        sessionIssued: false,
      });
    }
    const timestamp = now();
    const token = issue(preAuth, {
      subject,
      expiresAt: safeExpiry(timestamp, configuration.transactionLifetimeMs),
    });
    event('password-factor-verified', subject.id);
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'PASSWORD_FACTOR_VERIFIED',
      preAuthToken: token,
      expiresAt: safeExpiry(timestamp, configuration.transactionLifetimeMs),
      nextFactor: 'totp-or-recovery-code',
      sessionIssued: false,
    });
  }

  function completeLogin(preAuthToken, { method, code } = {}) {
    const timestamp = now();
    const resolved = resolve(preAuth, preAuthToken, timestamp);
    if (!resolved) return TRANSACTION_UNAVAILABLE;
    const factor = factors.get(resolved.record.subject.id);
    if (!factor) return TRANSACTION_UNAVAILABLE;
    const limited = currentLimit(resolved.record.subject.id, timestamp);
    if (limited) return limited;

    let acceptedMethod = null;
    if (method === 'totp') {
      const verification = verifyTotp({
        secret: factor.secret,
        code,
        timeMs: timestamp,
        period: configuration.period,
        digits: configuration.digits,
        algorithm: configuration.algorithm,
        window: configuration.window,
        lastAcceptedCounter: factor.lastAcceptedCounter,
      });
      if (!verification.ok) {
        return recordFailure(resolved.record.subject.id, timestamp, verification.reason);
      }
      factor.lastAcceptedCounter = verification.counter;
      acceptedMethod = 'totp';
    } else if (method === 'recovery-code') {
      const matched = verifyRecoveryCode(factor.recoveryRecords, code);
      if (matched < 0) return recordFailure(resolved.record.subject.id, timestamp, 'invalid-or-used');
      factor.recoveryRecords[matched].usedAt = timestamp;
      acceptedMethod = 'recovery-code';
    } else {
      return recordFailure(resolved.record.subject.id, timestamp, 'method-invalid');
    }

    attempts.delete(resolved.record.subject.id);
    preAuth.delete(resolved.digest);
    const sessionToken = issue(sessions, {
      subject: resolved.record.subject,
      authenticationMethods: Object.freeze(['password', acceptedMethod]),
      createdAt: timestamp,
      expiresAt: safeExpiry(timestamp, configuration.sessionLifetimeMs),
    });
    event('application-session-issued', resolved.record.subject.id, { secondFactor: acceptedMethod });
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'MFA_AUTHENTICATED',
      sessionToken,
      authenticationMethods: Object.freeze(['password', acceptedMethod]),
      expiresAt: safeExpiry(timestamp, configuration.sessionLifetimeMs),
      sessionIssued: true,
    });
  }

  function currentUser(sessionToken) {
    const resolved = resolve(sessions, sessionToken);
    if (!resolved) {
      return Object.freeze({
        ok: false,
        status: 403,
        code: 'SESSION_UNAVAILABLE',
        message: 'Session is unavailable.',
      });
    }
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'SESSION_AUTHENTICATED',
      principal: resolved.record.subject,
      authenticationMethods: resolved.record.authenticationMethods,
    });
  }

  function observe() {
    const timestamp = now();
    sweep(timestamp);
    const factorSummaries = [...factors.entries()].map(([subjectId, factor]) => ({
      subjectId,
      algorithm: configuration.algorithm,
      digits: configuration.digits,
      period: configuration.period,
      verificationWindow: configuration.window,
      replayStateStored: Number.isSafeInteger(factor.lastAcceptedCounter),
      recoveryCodesRemaining: factor.recoveryRecords.filter(({ usedAt }) => usedAt === null).length,
      recoveryCodesUsed: factor.recoveryRecords.filter(({ usedAt }) => usedAt !== null).length,
    }));
    return structuredClone({
      schemaVersion: 1,
      lessonId: '12',
      implementation: {
        factors: ['password', 'totp-or-single-use-recovery-code'],
        provisioning: 'otpauth-uri-ecosystem-convention',
        totpAlgorithm: 'rfc6238',
        hotpFoundation: 'rfc4226-dynamic-truncation',
        applicationSessionIssuedAfterSecondFactorOnly: true,
      },
      configuration: {
        algorithm: configuration.algorithm,
        digits: configuration.digits,
        period: configuration.period,
        verificationWindow: configuration.window,
        failureThreshold: configuration.failureThreshold,
        blockDurationMs: configuration.blockDurationMs,
      },
      state: {
        pendingEnrollments: enrollments.size,
        pendingPreAuthTransactions: preAuth.size,
        activeSessions: sessions.size,
        factors: factorSummaries,
        events: events.map((entry) => ({ ...entry })),
      },
      redaction: {
        passwords: 'omitted',
        totpSecrets: 'omitted',
        provisioningUris: 'omitted',
        totpCodes: 'omitted',
        recoveryCodes: 'omitted',
        transactionTokens: 'omitted',
        sessionTokens: 'omitted',
        tokenDigests: 'omitted',
        fullCounters: 'omitted',
      },
      limitations: {
        phishingResistant: false,
        sharedSecretAtRest: 'in-memory-training-only',
        authenticatorClockBehaviorTested: false,
        provisioningUriStandard: 'ecosystem-convention-not-rfc6238',
      },
    });
  }

  return Object.freeze({
    beginEnrollment,
    startEnrollment,
    confirmEnrollment,
    beginLogin,
    completeLogin,
    currentUser,
    observe,
  });
}
