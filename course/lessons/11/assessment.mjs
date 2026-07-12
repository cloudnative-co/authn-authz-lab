const EXPECTED = Object.freeze({
  'AA11-C1': Object.freeze({
    discovery: 'exact-issuer-and-http-fetched-jwks',
    idTokenDelivery: 'backchannel-token-response',
    validation: 'rs256-signature-iss-aud-time-nonce',
    session: 'digest-only-after-full-validation',
  }),
  'AA11-C2': Object.freeze({
    identityKey: 'issuer-subject-pair',
    email: 'optional-attribute-not-subject',
    accessToken: 'api-authorization-not-login-proof',
    negativeMatrix: 'one-fault-id-tokens-all-rejected',
  }),
});

const ALLOWED = Object.freeze({
  discovery: ['exact-issuer-and-http-fetched-jwks', 'trust-host-header-and-inline-key'],
  idTokenDelivery: ['backchannel-token-response', 'browser-fragment'],
  validation: ['rs256-signature-iss-aud-time-nonce', 'decode-payload-only'],
  session: ['digest-only-after-full-validation', 'session-before-token-validation'],
  identityKey: ['issuer-subject-pair', 'email-address'],
  email: ['optional-attribute-not-subject', 'permanent-primary-key'],
  accessToken: ['api-authorization-not-login-proof', 'login-proof-without-id-token'],
  negativeMatrix: ['one-fault-id-tokens-all-rejected', 'accept-valid-signature-only'],
});

export function lesson11LearnerChoices() {
  return structuredClone(ALLOWED);
}

export class Lesson11SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson11SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson11SubmissionError(reasonCode, message);
}

function exactKeys(value, expected, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('SUBMISSION_SCHEMA_INVALID', `${path} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('SUBMISSION_SCHEMA_INVALID', `${path} has missing or unknown fields`);
  }
}

export function validateLesson11Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '11') {
    fail('SUBMISSION_VERSION_INVALID', 'submission version or lesson is unsupported');
  }
  exactKeys(value.answers, Object.keys(EXPECTED), 'answers');
  for (const [checkId, expected] of Object.entries(EXPECTED)) {
    exactKeys(value.answers[checkId], Object.keys(expected), `answers.${checkId}`);
    for (const [field, answer] of Object.entries(value.answers[checkId])) {
      if (!ALLOWED[field]?.includes(answer)) fail('SUBMISSION_VALUE_INVALID', `${field} is not allowed`);
    }
  }
  return structuredClone(value);
}

function matches(actual, expected) {
  return Object.entries(expected).every(([name, value]) => actual[name] === value);
}

export function evaluateLesson11Submission(input, runtime) {
  const submission = validateLesson11Submission(input);
  if (runtime?.schemaVersion !== 1 || runtime.lessonId !== '11'
      || runtime.runtimeEvidence !== true || runtime.wireEvidence !== true) {
    throw new TypeError('Lesson 11 runtime evidence is invalid');
  }
  const rejectionCases = ['signature', 'issuer', 'audience', 'expiry', 'nonce', 'accessTokenAsIdToken'];
  const c1Runtime = runtime.topology?.originsSeparated === true
    && runtime.success?.authorizationStatus === 302
    && runtime.success.callbackStatus === 302
    && runtime.success.finalStatus === 200
    && runtime.success.callbackOutcome === 'oidc-authenticated'
    && runtime.success.authenticatedPage === true
    && runtime.success.discoveryFetched === true
    && runtime.success.jwksFetched === true
    && runtime.success.algorithmAllowlist === 'RS256-only'
    && runtime.success.idTokenDelivery === 'backchannel-token-response-only'
    && runtime.success.applicationSession === 'digest-only-cookie-after-validation';
  const c2Runtime = rejectionCases.every((name) => runtime.rejections?.[name]?.rejectedByNormalCallback === true)
    && runtime.identity?.subjectValidation === 'non-empty-max-255'
    && runtime.identity.issuerContract === 'locally-unique-never-reassigned-not-runtime-proven'
    && runtime.identity.accountKey === 'issuer-subject-pair'
    && runtime.identity.emailRole === 'optional-attribute-not-subject'
    && runtime.identity.accessTokenRole === 'api-authorization-not-login-proof'
    && runtime.cookieBoundary?.duplicateSessionCookieStatus === 403
    && runtime.cookieBoundary.duplicateSessionCookieRejected === true
    && runtime.safety?.transportContext === 'loopback-http-training-deviation'
    && runtime.safety.productionRequirement === 'https-required'
    && runtime.safety.secureCookieProductionRequirement === 'Secure-required-with-https'
    && runtime.safety.secretsOmitted === true;
  const checks = [
    { checkId: 'AA11-C1', runtimePassed: c1Runtime, submissionPassed: matches(submission.answers['AA11-C1'], EXPECTED['AA11-C1']) },
    { checkId: 'AA11-C2', runtimePassed: c2Runtime, submissionPassed: matches(submission.answers['AA11-C2'], EXPECTED['AA11-C2']) },
  ].map((item) => Object.freeze({ ...item, passed: item.runtimePassed && item.submissionPassed }));
  return Object.freeze({ status: checks.every(({ passed }) => passed) ? 'pass' : 'fail', checks: Object.freeze(checks) });
}

export function lesson11AnswerKey() {
  return structuredClone({ schemaVersion: 1, lessonId: '11', answers: EXPECTED });
}
