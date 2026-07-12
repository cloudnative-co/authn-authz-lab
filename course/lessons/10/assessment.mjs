const EXPECTED = Object.freeze({
  'AA10-C1': Object.freeze({
    flow: 'authorization-code-with-pkce-s256',
    client: 'public-client-without-secret',
    state: 'one-time-server-side-transaction',
    code: 'opaque-digest-only-bound-one-time',
    accessToken: 'opaque-with-authenticated-introspection',
  }),
  'AA10-C2': Object.freeze({
    bearerFailure: '401-with-bearer-challenge',
    scopeFailure: '403-with-insufficient-scope',
    passwordBoundary: 'authorization-server-only',
    transport: 'https-required-loopback-http-training-only',
  }),
});

const ALLOWED = Object.freeze({
  flow: ['authorization-code-with-pkce-s256', 'implicit-token-in-browser'],
  client: ['public-client-without-secret', 'browser-keeps-client-secret'],
  state: ['one-time-server-side-transaction', 'static-state-reused'],
  code: ['opaque-digest-only-bound-one-time', 'reusable-unbound-code'],
  accessToken: ['opaque-with-authenticated-introspection', 'decode-without-validation'],
  bearerFailure: ['401-with-bearer-challenge', '403-without-challenge'],
  scopeFailure: ['403-with-insufficient-scope', '401-invalid-token'],
  passwordBoundary: ['authorization-server-only', 'client-collects-password'],
  transport: ['https-required-loopback-http-training-only', 'plain-http-approved-for-production'],
});

export function lesson10LearnerChoices() {
  return structuredClone(ALLOWED);
}

export class Lesson10SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson10SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson10SubmissionError(reasonCode, message);
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, path) {
  if (!record(value)) fail('SUBMISSION_SCHEMA_INVALID', `${path} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('SUBMISSION_SCHEMA_INVALID', `${path} has missing or unknown fields`);
  }
}

export function validateLesson10Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '10') {
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

function tracesAreAllowlisted(traces) {
  return Array.isArray(traces) && traces.length > 0 && traces.every((trace) => {
    const keys = Object.keys(trace).sort().join(',');
    return keys === 'checks,method,origin,path,reason,role,status'
      && !new URL(trace.path, trace.origin).search
      && Object.values(trace.checks).every((value) => typeof value === 'boolean');
  });
}

export function evaluateLesson10Submission(input, runtime) {
  const submission = validateLesson10Submission(input);
  if (runtime?.schemaVersion !== 1 || runtime.lessonId !== '10'
      || runtime.runtimeEvidence !== true || runtime.wireEvidence !== true) {
    throw new TypeError('Lesson 10 runtime evidence is invalid');
  }
  const c1Runtime = runtime.topology?.originsSeparated === true
    && runtime.success?.startStatus === 302
    && runtime.success.authorizationStatus === 302
    && runtime.success.callbackStatus === 200
    && runtime.success.resourceAuthorized === true
    && runtime.success.clientSecretAbsent === true
    && runtime.success.stateSentToTokenEndpoint === false
    && runtime.success.accessTokenFormat === 'opaque-256-bit'
    && runtime.success.resourceValidation === 'authenticated-rfc7662-introspection'
    && runtime.rejections?.stateMismatchStatus === 400
    && runtime.rejections.pkceMismatchStatus === 400
    && runtime.rejections.codeReplayRejected === true
    && runtime.rejections.unregisteredRedirectStatus === 400
    && runtime.rejections.unregisteredRedirectLocationAbsent === true;
  const c2Runtime = runtime.bearer?.missingStatus === 401
    && runtime.bearer.missingChallenge === 'Bearer realm="lesson-10-api"'
    && runtime.bearer.invalidStatus === 401
    && runtime.bearer.invalidChallenge.includes('error="invalid_token"')
    && runtime.bearer.insufficientScopeStatus === 403
    && runtime.bearer.insufficientScopeRejected === true
    && runtime.introspection?.unauthenticatedStatus === 401
    && runtime.introspection.challenge === 'Basic realm="lesson-10-introspection"'
    && runtime.introspection.serverSurvived === true
    && runtime.safety?.transportContext === 'loopback-http-training-deviation'
    && runtime.safety.productionRequirement === 'https-required'
    && runtime.safety.secretsOmitted === true
    && tracesAreAllowlisted(runtime.safety.traces);
  const checks = [
    { checkId: 'AA10-C1', runtimePassed: c1Runtime, submissionPassed: matches(submission.answers['AA10-C1'], EXPECTED['AA10-C1']) },
    { checkId: 'AA10-C2', runtimePassed: c2Runtime, submissionPassed: matches(submission.answers['AA10-C2'], EXPECTED['AA10-C2']) },
  ].map((item) => Object.freeze({ ...item, passed: item.runtimePassed && item.submissionPassed }));
  return Object.freeze({ status: checks.every(({ passed }) => passed) ? 'pass' : 'fail', checks: Object.freeze(checks) });
}

export function lesson10AnswerKey() {
  return structuredClone({ schemaVersion: 1, lessonId: '10', answers: EXPECTED });
}
