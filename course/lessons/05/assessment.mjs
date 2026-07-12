const EXPECTED = Object.freeze({
  'AA05-C1': Object.freeze({
    challenge: '401-with-basic-realm-and-utf8',
    credentialConstruction: 'base64-of-utf8-nfc-user-colon-password',
    success: '200-without-session',
    requestReuse: 'authorization-required-on-every-request',
  }),
  'AA05-C2': Object.freeze({
    transport: 'tls-required-loopback-http-training-only',
    base64Security: 'encoding-not-encryption',
    logging: 'omit-header-and-decoded-credentials',
    adoption: 'narrow-controlled-use-only',
  }),
});

const ALLOWED = Object.freeze({
  challenge: ['401-with-basic-realm-and-utf8', '401-without-www-authenticate'],
  credentialConstruction: [
    'base64-of-utf8-nfc-user-colon-password',
    'password-hash-in-authorization-header',
  ],
  success: ['200-without-session', '200-and-session-cookie'],
  requestReuse: ['authorization-required-on-every-request', 'first-request-creates-login-session'],
  transport: ['tls-required-loopback-http-training-only', 'plain-http-approved-for-production'],
  base64Security: ['encoding-not-encryption', 'encryption-protects-the-password'],
  logging: ['omit-header-and-decoded-credentials', 'log-decoded-user-pass-for-debugging'],
  adoption: ['narrow-controlled-use-only', 'default-choice-for-browser-sso-and-mfa'],
});

export class Lesson05SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson05SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson05SubmissionError(reasonCode, message);
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

export function validateLesson05Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '05') {
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

export function evaluateLesson05Submission(submissionInput, runtime) {
  const submission = validateLesson05Submission(submissionInput);
  if (runtime?.schemaVersion !== 1 || runtime.lessonId !== '05'
      || runtime.runtimeEvidence !== true || runtime.wireEvidence !== true) {
    throw new TypeError('lesson 05 runtime observation is invalid');
  }
  const c1Runtime = runtime.challenge?.absentStatus === 401
    && runtime.challenge.wrongStatus === 401
    && runtime.challenge.header === 'Basic realm="lesson-05", charset="UTF-8"'
    && runtime.challenge.allFailureHeadersEqual === true
    && runtime.challenge.allFailureBodiesEqual === true
    && runtime.success?.status === 200
    && runtime.success.code === 'BASIC_AUTHENTICATED'
    && runtime.success.principalId === 'user-500'
    && runtime.success.challengeAbsent === true
    && runtime.success.setCookieAbsent === true
    && runtime.success.nextRequestWithoutHeaderStatus === 401
    && runtime.protocol?.scheme === 'Basic'
    && runtime.protocol.challengeMatchesRfc7617ExampleShape === true
    && runtime.protocol.credentialEncoding === 'canonical-base64-of-utf8-nfc-user-pass'
    && runtime.protocol.authenticatesEveryRequest === true
    && runtime.protocol.sessionIssuance === false;
  const c2Runtime = runtime.safety?.transportContext === 'loopback-http-training-deviation'
    && runtime.safety.productionRequirement === 'tls-required'
    && runtime.safety.authorizationHeaderOmitted === true
    && runtime.safety.decodedCredentialsOmitted === true
    && runtime.safety.redacted === true
    && runtime.safety.requestCount === 4
    && runtime.safety.successCount === 1
    && runtime.safety.challengeCount === 3;

  const checks = [
    {
      checkId: 'AA05-C1',
      runtimePassed: c1Runtime,
      submissionPassed: answersMatch(submission.answers['AA05-C1'], EXPECTED['AA05-C1']),
      data: {
        absentStatus: runtime.challenge?.absentStatus,
        wrongStatus: runtime.challenge?.wrongStatus,
        challengePresent: runtime.challenge?.header
          === 'Basic realm="lesson-05", charset="UTF-8"',
        failureSurfacesEqual: runtime.challenge?.allFailureHeadersEqual === true
          && runtime.challenge?.allFailureBodiesEqual === true,
        successStatus: runtime.success?.status,
        setCookieAbsent: runtime.success?.setCookieAbsent,
        nextWithoutHeaderStatus: runtime.success?.nextRequestWithoutHeaderStatus,
        credentialEncoding: runtime.protocol?.credentialEncoding,
      },
    },
    {
      checkId: 'AA05-C2',
      runtimePassed: c2Runtime,
      submissionPassed: answersMatch(submission.answers['AA05-C2'], EXPECTED['AA05-C2']),
      data: {
        transportContext: runtime.safety?.transportContext,
        productionRequirement: runtime.safety?.productionRequirement,
        authorizationHeaderOmitted: runtime.safety?.authorizationHeaderOmitted,
        decodedCredentialsOmitted: runtime.safety?.decodedCredentialsOmitted,
        requestCount: runtime.safety?.requestCount,
        challengeCount: runtime.safety?.challengeCount,
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

export function lesson05AnswerKey() {
  return structuredClone({ schemaVersion: 1, lessonId: '05', answers: EXPECTED });
}
