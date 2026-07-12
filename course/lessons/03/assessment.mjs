const EXPECTED = Object.freeze({
  'AA03-C1': Object.freeze({
    browserValue: 'raw-opaque-session-token-in-cookie',
    tokenSize: '256-bit-32-byte',
    serverStoredValue: 'sha-256-token-digest-only',
    cookieHttpOnly: 'enabled',
    cookieSameSite: 'Lax',
    cookiePath: '/',
    cookieDomain: 'omitted-host-only',
    loopbackTransport: 'secure-disabled-training-deviation-not-production',
  }),
  'AA03-C2': Object.freeze({
    loginRotation: 'mandatory-new-token',
    oldPreAuthToken: 'rejected',
  }),
  'AA03-C3': Object.freeze({
    expiration: 'absolute-not-sliding',
    logoutServerEffect: 'record-revoked',
    logoutCookieEffect: 'max-age-zero',
    loggedOutToken: 'rejected',
  }),
  'AA03-C4': Object.freeze({
    serverRevocation: 'all-authenticated-sessions-for-subject',
    revokedToken: 'rejected',
  }),
});

const ALLOWED = Object.freeze({
  browserValue: ['raw-opaque-session-token-in-cookie', 'server-record-json'],
  tokenSize: ['256-bit-32-byte', '64-bit-8-byte'],
  serverStoredValue: ['sha-256-token-digest-only', 'raw-session-token'],
  cookieHttpOnly: ['enabled', 'disabled'],
  cookieSameSite: ['Lax', 'None'],
  cookiePath: ['/', '/login-only'],
  cookieDomain: ['omitted-host-only', 'example.com'],
  loopbackTransport: ['secure-disabled-training-deviation-not-production', 'production-approved-http'],
  loginRotation: ['mandatory-new-token', 'reuse-pre-auth-token'],
  oldPreAuthToken: ['rejected', 'accepted'],
  expiration: ['absolute-not-sliding', 'slides-on-every-request'],
  logoutServerEffect: ['record-revoked', 'record-remains-active'],
  logoutCookieEffect: ['max-age-zero', 'cookie-unchanged'],
  loggedOutToken: ['rejected', 'accepted'],
  serverRevocation: ['all-authenticated-sessions-for-subject', 'browser-cookie-only'],
  revokedToken: ['rejected', 'accepted-until-expiry'],
});

export class Lesson03SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson03SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson03SubmissionError(reasonCode, message);
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, path) {
  if (!plainRecord(value)) fail('SUBMISSION_SCHEMA_INVALID', `${path} must be an object`);
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    fail('SUBMISSION_SCHEMA_INVALID', `${path} has missing or unknown fields`);
  }
}

export function validateLesson03Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '03') {
    fail('SUBMISSION_VERSION_INVALID', 'submission schemaVersion or lessonId is unsupported');
  }
  exactKeys(value.answers, Object.keys(EXPECTED), 'answers');
  for (const [checkId, expected] of Object.entries(EXPECTED)) {
    exactKeys(value.answers[checkId], Object.keys(expected), `answers.${checkId}`);
    for (const [field, answer] of Object.entries(value.answers[checkId])) {
      if (!ALLOWED[field]?.includes(answer)) {
        fail('SUBMISSION_VALUE_INVALID', `answers.${checkId}.${field} is not allowed`);
      }
    }
  }
  return structuredClone(value);
}

function answersMatch(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

export function evaluateLesson03Submission(submissionInput, runtime) {
  const submission = validateLesson03Submission(submissionInput);
  if (runtime?.schemaVersion !== 1 || runtime.lessonId !== '03'
      || runtime.runtimeEvidence !== true || runtime.wireEvidence !== true) {
    throw new TypeError('lesson 03 runtime observation is invalid');
  }
  const c1Runtime = runtime.transport?.tokenBytes === 32
    && runtime.transport.opaqueToken === true
    && runtime.transport.httpOnly === true
    && runtime.transport.sameSite === 'Lax'
    && runtime.transport.path === '/'
    && runtime.transport.domainOmitted === true
    && runtime.transport.secure === false
    && runtime.transport.transportContext === 'loopback-http-training-deviation'
    && runtime.transport.browserEnforcementTested === false
    && runtime.storage?.mode === 'sha-256-token-digest-only'
    && runtime.storage.rawValuesExposed === false
    && runtime.storage.fullDigestsExposed === false;
  const c2Runtime = runtime.rotation?.observed === true
    && runtime.rotation.priorHandleStatus === 403
    && runtime.rotation.currentHandleStatus === 200;
  const c3Runtime = runtime.expiration?.mode === 'absolute-not-sliding'
    && runtime.expiration.postBoundaryStatus === 403
    && runtime.logout?.status === 204
    && runtime.logout.cleared === true
    && runtime.logout.postLogoutStatus === 403;
  const c4Runtime = runtime.revocation?.firstCount === 1
    && runtime.revocation.postRevocationStatus === 403
    && runtime.revocation.repeatedCount === 0;

  const checks = [
    {
      checkId: 'AA03-C1', runtimePassed: c1Runtime,
      submissionPassed: answersMatch(submission.answers['AA03-C1'], EXPECTED['AA03-C1']),
      data: {
        tokenBytes: runtime.transport?.tokenBytes,
        opaqueHandle: runtime.transport?.opaqueToken,
        httpOnly: runtime.transport?.httpOnly,
        sameSite: runtime.transport?.sameSite,
        path: runtime.transport?.path,
        domainOmitted: runtime.transport?.domainOmitted,
        secure: runtime.transport?.secure,
        transportContext: runtime.transport?.transportContext,
        serverStorage: runtime.storage?.mode,
        rawValuesExposed: runtime.storage?.rawValuesExposed,
        fullDigestsExposed: runtime.storage?.fullDigestsExposed,
        browserEnforcementTested: runtime.transport?.browserEnforcementTested,
      },
    },
    {
      checkId: 'AA03-C2', runtimePassed: c2Runtime,
      submissionPassed: answersMatch(submission.answers['AA03-C2'], EXPECTED['AA03-C2']),
      data: {
        rotationObserved: runtime.rotation?.observed,
        priorHandleStatus: runtime.rotation?.priorHandleStatus,
        currentHandleStatus: runtime.rotation?.currentHandleStatus,
      },
    },
    {
      checkId: 'AA03-C3', runtimePassed: c3Runtime,
      submissionPassed: answersMatch(submission.answers['AA03-C3'], EXPECTED['AA03-C3']),
      data: {
        expirationMode: runtime.expiration?.mode,
        postBoundaryStatus: runtime.expiration?.postBoundaryStatus,
        logoutStatus: runtime.logout?.status,
        responseCleared: runtime.logout?.cleared,
        postLogoutStatus: runtime.logout?.postLogoutStatus,
      },
    },
    {
      checkId: 'AA03-C4', runtimePassed: c4Runtime,
      submissionPassed: answersMatch(submission.answers['AA03-C4'], EXPECTED['AA03-C4']),
      data: {
        revokedCount: runtime.revocation?.firstCount,
        postRevocationStatus: runtime.revocation?.postRevocationStatus,
        repeatCount: runtime.revocation?.repeatedCount,
      },
    },
  ].map((check) => Object.freeze({
    ...check,
    passed: check.runtimePassed && check.submissionPassed,
    allowlist: Object.freeze(Object.keys(check.data)),
  }));
  return Object.freeze({
    status: checks.every(({ passed }) => passed) ? 'pass' : 'fail',
    checks: Object.freeze(checks),
  });
}

export function lesson03AnswerKey() {
  return structuredClone({ schemaVersion: 1, lessonId: '03', answers: EXPECTED });
}
