import { randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { createLesson02PasswordService } from '../02/password-auth-service.mjs';
import {
  createSessionToken,
  digestSessionToken,
  SessionTokenError,
} from '../../../../packages/session/session-token.mjs';
import { describeSessionCookieConfiguration } from '../../../../packages/session/session-cookie.mjs';

const ACCOUNT_ID = 'user-alice';
const IDENTIFIER = 'alice@example.com';
const USER_HANDLE_BYTES = 64;
const TRANSACTION_BYTES = 24;
const DEFAULTS = Object.freeze({
  transactionLifetimeMs: 2 * 60 * 1000,
  sessionLifetimeMs: 30 * 60 * 1000,
  maxTransactions: 64,
  maxSessions: 64,
  maxEvents: 256,
});

const DEFAULT_PROTOCOL = Object.freeze({
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
});

function exactCourseOrigin(value) {
  const origin = new URL(value);
  if (origin.protocol !== 'http:'
      || origin.hostname !== 'localhost'
      || !origin.port
      || origin.origin !== value) {
    throw new TypeError('expectedOrigin must be an exact http://localhost:<port> origin');
  }
  return origin.origin;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be positive`);
  return value;
}

function nowFrom(clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('clock is invalid');
  return value;
}

function randomBuffer(randomBytes, size, name) {
  const value = Buffer.from(randomBytes(size));
  if (value.length !== size) throw new TypeError(`${name} random byte length is invalid`);
  return value;
}

function opaqueId(randomBytes) {
  return randomBuffer(randomBytes, TRANSACTION_BYTES, 'transaction').toString('base64url');
}

function canonicalBase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length === 0 || bytes.toString('base64url') !== value) return null;
  return bytes;
}

function byteEqual(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifierReason(error, ceremony) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('challenge')) return 'CHALLENGE_MISMATCH';
  if (message.includes('origin')) return 'ORIGIN_MISMATCH';
  if (message.includes('rp id') || message.includes('rpid') || message.includes('rpidhash')) {
    return 'RP_ID_MISMATCH';
  }
  if (message.includes('signature') || message.includes('signed')) return 'SIGNATURE_INVALID';
  if (message.includes('counter')) return 'SIGN_COUNT_RISK_SIGNAL';
  if (message.includes('user verification') || message.includes('user verified')) return 'UV_REQUIRED';
  return ceremony === 'registration' ? 'REGISTRATION_INVALID' : 'ASSERTION_INVALID';
}

function publicFailure(status = 422) {
  return Object.freeze({
    ok: false,
    status,
    code: 'WEBAUTHN_VERIFICATION_FAILED',
    message: 'WebAuthn ceremony could not be verified.',
  });
}

function sessionUnavailable() {
  return Object.freeze({
    ok: false,
    status: 401,
    code: 'SESSION_UNAVAILABLE',
    message: 'Sign in again before managing credentials.',
  });
}

function assertProtocol(protocol) {
  for (const method of Object.keys(DEFAULT_PROTOCOL)) {
    if (typeof protocol?.[method] !== 'function') throw new TypeError(`protocol.${method} is required`);
  }
  return protocol;
}

export async function createWebAuthnCourseService(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const lessonId = options.lessonId;
  if (!['13', '14'].includes(lessonId)) throw new TypeError('lessonId must be 13 or 14');
  const expectedOrigin = exactCourseOrigin(options.expectedOrigin);
  const rpID = options.rpID ?? 'localhost';
  if (rpID !== 'localhost') throw new TypeError('the course RP ID must be localhost');
  const clock = options.clock ?? Date.now;
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  if (typeof clock !== 'function' || typeof randomBytes !== 'function') {
    throw new TypeError('clock and randomBytes must be functions');
  }
  const protocol = assertProtocol(options.protocol ?? DEFAULT_PROTOCOL);
  const configuration = Object.freeze({
    transactionLifetimeMs: positiveInteger(
      options.transactionLifetimeMs ?? DEFAULTS.transactionLifetimeMs,
      'transactionLifetimeMs',
    ),
    sessionLifetimeMs: positiveInteger(
      options.sessionLifetimeMs ?? DEFAULTS.sessionLifetimeMs,
      'sessionLifetimeMs',
    ),
    maxTransactions: positiveInteger(options.maxTransactions ?? DEFAULTS.maxTransactions, 'maxTransactions'),
    maxSessions: positiveInteger(options.maxSessions ?? DEFAULTS.maxSessions, 'maxSessions'),
    maxEvents: positiveInteger(options.maxEvents ?? DEFAULTS.maxEvents, 'maxEvents'),
  });
  const passwordAuthenticator = options.passwordAuthenticator
    ?? await createLesson02PasswordService({ clock });
  if (typeof passwordAuthenticator.authenticate !== 'function') {
    throw new TypeError('passwordAuthenticator.authenticate is required');
  }

  const account = {
    id: ACCOUNT_ID,
    identifier: IDENTIFIER,
    displayName: 'Course Alice',
    enabled: true,
    sessionGeneration: 0,
    userHandle: randomBuffer(randomBytes, USER_HANDLE_BYTES, 'user handle'),
  };
  const credentials = new Map();
  const transactions = new Map();
  const sessions = new Map();
  const events = [];

  function now() {
    return nowFrom(clock);
  }

  function event(type, fields = {}) {
    events.push(Object.freeze({ type, timestamp: now(), ...fields }));
    if (events.length > configuration.maxEvents) events.shift();
  }

  function sweep(timestamp = now()) {
    for (const [id, transaction] of transactions) {
      if (transaction.expiresAt <= timestamp) transactions.delete(id);
    }
    for (const [digest, session] of sessions) {
      if (session.expiresAt <= timestamp) sessions.delete(digest);
    }
  }

  function reserve(map, limit, reason) {
    sweep();
    if (map.size >= limit) throw new Error(reason);
  }

  function newTransaction(value) {
    reserve(transactions, configuration.maxTransactions, 'transaction capacity exhausted');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = opaqueId(randomBytes);
      if (!transactions.has(id)) {
        transactions.set(id, Object.freeze({
          ...value,
          createdAt: now(),
          expiresAt: now() + configuration.transactionLifetimeMs,
        }));
        return id;
      }
    }
    throw new Error('unique transaction id unavailable');
  }

  function consumeTransaction(id, kind) {
    const timestamp = now();
    sweep(timestamp);
    const transaction = typeof id === 'string' ? transactions.get(id) : null;
    if (!transaction || transaction.kind !== kind || transaction.expiresAt <= timestamp) return null;
    transactions.delete(id);
    return transaction;
  }

  function issueSession(accountId) {
    reserve(sessions, configuration.maxSessions, 'session capacity exhausted');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = createSessionToken(randomBytes);
      const digest = digestSessionToken(token);
      if (sessions.has(digest)) continue;
      const csrfToken = randomBuffer(randomBytes, 32, 'csrf').toString('base64url');
      sessions.set(digest, Object.freeze({
        accountId,
        csrfToken,
        generation: account.sessionGeneration,
        expiresAt: now() + configuration.sessionLifetimeMs,
      }));
      return { token, csrfToken };
    }
    throw new Error('unique session unavailable');
  }

  function resolveSession(token) {
    sweep();
    let digest;
    try {
      digest = digestSessionToken(token);
    } catch (error) {
      if (error instanceof SessionTokenError) return null;
      throw error;
    }
    const session = sessions.get(digest);
    if (!session
        || session.accountId !== account.id
        || session.generation !== account.sessionGeneration
        || !account.enabled) return null;
    return { digest, session, account };
  }

  function requireSession(token, csrfToken = null) {
    const resolved = resolveSession(token);
    if (!resolved) return null;
    if (csrfToken !== null) {
      const actual = canonicalBase64url(csrfToken);
      const expected = canonicalBase64url(resolved.session.csrfToken);
      if (!actual || !expected || !byteEqual(actual, expected)) return null;
    }
    return resolved;
  }

  function activeCredentials() {
    return [...credentials.values()].filter((credential) => credential.active);
  }

  async function passwordLogin(identifier, password) {
    const authenticated = await passwordAuthenticator.authenticate(identifier, password);
    if (!authenticated.ok || authenticated.principal.id !== account.id || !account.enabled) {
      event('password-login-rejected');
      return Object.freeze({
        ok: false,
        status: 422,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid identifier or password.',
      });
    }
    const session = issueSession(account.id);
    event('password-login-accepted');
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'PASSWORD_AUTHENTICATED',
      sessionToken: session.token,
      csrfToken: session.csrfToken,
    });
  }

  async function startRegistration(sessionToken, csrfToken) {
    const resolved = requireSession(sessionToken, csrfToken);
    if (!resolved) return sessionUnavailable();
    const optionsJSON = await protocol.generateRegistrationOptions({
      rpName: 'CloudNative WebAuthn Course',
      rpID,
      userID: new Uint8Array(account.userHandle),
      userName: account.identifier,
      userDisplayName: account.displayName,
      attestationType: 'none',
      supportedAlgorithmIDs: [-7],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: activeCredentials().map(({ credential }) => ({
        id: credential.id,
        transports: credential.transports,
      })),
      timeout: configuration.transactionLifetimeMs,
    });
    const transactionId = newTransaction({
      kind: 'registration',
      accountId: account.id,
      sessionDigest: resolved.digest,
      challenge: optionsJSON.challenge,
    });
    event('registration-started', { userHandleBytes: account.userHandle.length });
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'REGISTRATION_OPTIONS_ISSUED',
      transactionId,
      options: optionsJSON,
    });
  }

  async function finishRegistration(sessionToken, csrfToken, transactionId, response) {
    const transaction = consumeTransaction(transactionId, 'registration');
    const resolved = requireSession(sessionToken, csrfToken);
    if (!transaction || !resolved || transaction.sessionDigest !== resolved.digest || !account.enabled) {
      event('registration-rejected', { reason: 'TRANSACTION_OR_SESSION_INVALID' });
      return publicFailure();
    }
    let verification;
    try {
      verification = await protocol.verifyRegistrationResponse({
        response,
        expectedChallenge: transaction.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserPresence: true,
        requireUserVerification: true,
      });
    } catch (error) {
      event('registration-rejected', { reason: verifierReason(error, 'registration') });
      return publicFailure();
    }
    if (!verification.verified || !verification.registrationInfo?.userVerified) {
      event('registration-rejected', { reason: 'REGISTRATION_INVALID' });
      return publicFailure();
    }
    const { registrationInfo } = verification;
    if (credentials.has(registrationInfo.credential.id)) {
      event('registration-rejected', { reason: 'DUPLICATE_CREDENTIAL' });
      return publicFailure();
    }
    credentials.set(registrationInfo.credential.id, {
      accountId: account.id,
      userHandle: Buffer.from(account.userHandle),
      credential: {
        ...registrationInfo.credential,
        publicKey: new Uint8Array(registrationInfo.credential.publicKey),
      },
      active: true,
      deviceType: registrationInfo.credentialDeviceType,
      backedUp: registrationInfo.credentialBackedUp,
      registeredAt: now(),
      revokedAt: null,
    });
    event('registration-accepted', {
      deviceType: registrationInfo.credentialDeviceType,
      backedUp: registrationInfo.credentialBackedUp,
      attestationFormat: registrationInfo.fmt,
      userVerified: registrationInfo.userVerified,
    });
    return Object.freeze({
      ok: true,
      status: 201,
      code: 'CREDENTIAL_REGISTERED',
      credentialReference: registrationInfo.credential.id,
      deviceType: registrationInfo.credentialDeviceType,
      backedUp: registrationInfo.credentialBackedUp,
    });
  }

  async function startAuthentication({ identifier = null, discoverable = false } = {}) {
    if (typeof discoverable !== 'boolean') throw new TypeError('discoverable must be boolean');
    const boundAccount = discoverable ? null : (identifier === account.identifier ? account : null);
    const optionsJSON = await protocol.generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      timeout: configuration.transactionLifetimeMs,
      ...(discoverable ? {} : {
        allowCredentials: boundAccount ? activeCredentials().map(({ credential }) => ({
          id: credential.id,
          transports: credential.transports,
        })) : [],
      }),
    });
    const transactionId = newTransaction({
      kind: 'authentication',
      accountId: boundAccount?.id ?? null,
      mode: discoverable ? 'discoverable' : 'username-bound',
      challenge: optionsJSON.challenge,
    });
    event('authentication-started', {
      mode: discoverable ? 'discoverable' : 'username-bound',
      allowCredentialsCount: optionsJSON.allowCredentials?.length ?? 0,
    });
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'AUTHENTICATION_OPTIONS_ISSUED',
      transactionId,
      options: optionsJSON,
    });
  }

  async function finishAuthentication(transactionId, response) {
    const transaction = consumeTransaction(transactionId, 'authentication');
    if (!transaction) {
      event('authentication-rejected', { reason: 'TRANSACTION_REPLAY_OR_EXPIRED' });
      return publicFailure();
    }
    const stored = typeof response?.id === 'string' ? credentials.get(response.id) : null;
    if (!stored || !stored.active || !account.enabled
        || (transaction.accountId !== null && transaction.accountId !== stored.accountId)) {
      event('authentication-rejected', { reason: !account.enabled ? 'ACCOUNT_DISABLED' : 'CREDENTIAL_UNAVAILABLE' });
      return publicFailure();
    }
    const returnedHandle = canonicalBase64url(response?.response?.userHandle);
    if (!returnedHandle || !byteEqual(returnedHandle, stored.userHandle)) {
      event('authentication-rejected', { reason: 'USER_HANDLE_MISMATCH' });
      return publicFailure();
    }
    let verification;
    try {
      verification = await protocol.verifyAuthenticationResponse({
        response,
        expectedChallenge: transaction.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        credential: stored.credential,
        requireUserVerification: true,
      });
    } catch (error) {
      event('authentication-rejected', { reason: verifierReason(error, 'authentication') });
      return publicFailure();
    }
    if (!verification.verified || !verification.authenticationInfo.userVerified) {
      event('authentication-rejected', {
        reason: verification.verified ? 'UV_REQUIRED' : 'SIGNATURE_INVALID',
      });
      return publicFailure();
    }
    const previousCounter = stored.credential.counter;
    const { authenticationInfo } = verification;
    stored.credential.counter = authenticationInfo.newCounter;
    stored.deviceType = authenticationInfo.credentialDeviceType;
    stored.backedUp = authenticationInfo.credentialBackedUp;
    const counterDisposition = previousCounter === 0 && authenticationInfo.newCounter === 0
      ? 'zero-counter-no-clone-conclusion'
      : 'counter-increased';
    const session = issueSession(account.id);
    event('authentication-accepted', {
      mode: transaction.mode,
      userVerified: authenticationInfo.userVerified,
      deviceType: authenticationInfo.credentialDeviceType,
      backedUp: authenticationInfo.credentialBackedUp,
      counterDisposition,
    });
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'WEBAUTHN_AUTHENTICATED',
      sessionToken: session.token,
      csrfToken: session.csrfToken,
      mode: transaction.mode,
      deviceType: authenticationInfo.credentialDeviceType,
      backedUp: authenticationInfo.credentialBackedUp,
      counterDisposition,
    });
  }

  function currentUser(sessionToken) {
    const resolved = resolveSession(sessionToken);
    if (!resolved) return Object.freeze({ ok: false, status: 401, code: 'SESSION_UNAVAILABLE' });
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'SESSION_AUTHENTICATED',
      user: Object.freeze({ id: account.id, identifier: account.identifier }),
    });
  }

  function listCredentials(sessionToken) {
    const resolved = resolveSession(sessionToken);
    if (!resolved) return sessionUnavailable();
    return Object.freeze({
      ok: true,
      status: 200,
      code: 'CREDENTIALS_LISTED',
      credentials: Object.freeze([...credentials.entries()].map(([id, value]) => Object.freeze({
        credentialReference: id,
        active: value.active,
        deviceType: value.deviceType,
        backedUp: value.backedUp,
      }))),
    });
  }

  function revokeCredential(sessionToken, csrfToken, credentialReference) {
    if (!requireSession(sessionToken, csrfToken)) return sessionUnavailable();
    const stored = typeof credentialReference === 'string' ? credentials.get(credentialReference) : null;
    if (!stored || !stored.active) return publicFailure(404);
    stored.active = false;
    stored.revokedAt = now();
    event('credential-revoked');
    return Object.freeze({ ok: true, status: 200, code: 'CREDENTIAL_REVOKED' });
  }

  function disableAccount(accountId) {
    if (accountId !== account.id || !account.enabled) return false;
    account.enabled = false;
    account.sessionGeneration += 1;
    transactions.clear();
    sessions.clear();
    event('account-disabled', { sessionsInvalidated: true });
    return true;
  }

  function observe() {
    sweep();
    const allCredentials = [...credentials.values()];
    return structuredClone({
      schemaVersion: 1,
      lessonId,
      implementation: {
        api: 'navigator.credentials.create-and-get',
        verifier: '@simplewebauthn/server-13.3.2',
        rpID,
        expectedOrigin,
        attestation: 'none',
        userVerification: 'required',
        residentKey: 'required',
      },
      account: {
        enabled: account.enabled,
        userHandle: {
          byteLength: account.userHandle.length,
          generation: 'cryptographically-random-per-account',
          containsPII: false,
          rawValue: 'omitted',
          digest: 'omitted',
        },
      },
      state: {
        credentialCount: allCredentials.length,
        activeCredentialCount: allCredentials.filter(({ active }) => active).length,
        revokedCredentialCount: allCredentials.filter(({ active }) => !active).length,
        transactionCount: transactions.size,
        sessionCount: sessions.size,
        credentials: allCredentials.map(({ active, deviceType, backedUp }) => ({
          active,
          deviceType,
          backedUp,
          credentialId: 'omitted',
          publicKey: 'omitted',
          counter: 'omitted',
        })),
        events: events.map((value) => ({ ...value })),
      },
      semantics: {
        registrationAttestationSignature: 'none-format-has-no-device-attestation-signature',
        authenticationSignature: 'verified-with-registered-public-key',
        signCount: 'risk-signal-not-clone-proof',
        backupEligibility: 'credential-may-be-backed-up',
        backupState: 'credential-currently-reported-backed-up',
        virtualBackupFlagsProveCloudSync: false,
      },
      cookie: describeSessionCookieConfiguration({
        name: `course_webauthn_${lessonId}_session`,
        secure: false,
      }),
      redaction: {
        passwords: 'omitted',
        sessionTokens: 'omitted',
        csrfTokens: 'omitted',
        challenges: 'omitted',
        userHandles: 'omitted',
        credentialIds: 'omitted',
        publicKeys: 'omitted',
        attestationObjects: 'omitted',
        assertions: 'omitted',
        signatures: 'omitted',
        fullCounters: 'omitted',
      },
    });
  }

  return Object.freeze({
    passwordLogin,
    startRegistration,
    finishRegistration,
    startAuthentication,
    finishAuthentication,
    currentUser,
    listCredentials,
    revokeCredential,
    disableAccount,
    observe,
  });
}
