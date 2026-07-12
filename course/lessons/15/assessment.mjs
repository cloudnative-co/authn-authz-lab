const EXPECTED = Object.freeze({
  'AA15-C1': Object.freeze({
    accessTokenProfile: 'rfc9068-signed-rs256-at+jwt',
    resourceIndicator: 'rfc8707-exact-resource-to-audience',
    clientTreatment: 'opaque-forward-only',
    validation: 'jwks-signature-typ-iss-aud-exp-sub-client-id-iat-jti-scope',
  }),
  'AA15-C2': Object.freeze({
    invalidToken: '401-bearer-invalid-token-before-policy',
    insufficientScope: '403-bearer-insufficient-scope-before-policy',
    idTokenConfusion: 'rejected-by-explicit-type',
    validationOrder: 'token-then-scope-then-project-policy',
  }),
  'AA15-C3': Object.freeze({
    policyDecisionPoint: 'project-core-after-token-and-scope',
    sameTenantViewer: '403-policy-forbidden',
    crossTenant: '404-resource-concealed',
    unknownObject: '404-resource-concealed',
    owner: '204-delete',
  }),
});

const ALLOWED = Object.freeze({
  accessTokenProfile: ['rfc9068-signed-rs256-at+jwt', 'unsigned-decodable-jwt'],
  resourceIndicator: ['rfc8707-exact-resource-to-audience', 'client-selected-audience-without-validation'],
  clientTreatment: ['opaque-forward-only', 'decode-and-authorize-in-client'],
  validation: ['jwks-signature-typ-iss-aud-exp-sub-client-id-iat-jti-scope', 'decode-exp-and-scope-only'],
  invalidToken: ['401-bearer-invalid-token-before-policy', '403-policy-result'],
  insufficientScope: ['403-bearer-insufficient-scope-before-policy', '401-invalid-token'],
  idTokenConfusion: ['rejected-by-explicit-type', 'accepted-when-signature-matches'],
  validationOrder: ['token-then-scope-then-project-policy', 'scope-and-policy-before-signature'],
  policyDecisionPoint: ['project-core-after-token-and-scope', 'jwt-scope-is-the-only-policy'],
  sameTenantViewer: ['403-policy-forbidden', '204-because-scope-present'],
  crossTenant: ['404-resource-concealed', '403-with-resource-detail'],
  unknownObject: ['404-resource-concealed', '200-empty-object'],
  owner: ['204-delete', '403-policy-forbidden'],
});

export function lesson15LearnerChoices() {
  return structuredClone(ALLOWED);
}

export class Lesson15SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson15SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson15SubmissionError(reasonCode, message);
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

export function validateLesson15Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '15') {
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

export function evaluateLesson15Submission(input, runtime) {
  const submission = validateLesson15Submission(input);
  if (runtime?.schemaVersion !== 1 || runtime.lessonId !== '15'
      || runtime.runtimeEvidence !== true || runtime.wireEvidence !== true) {
    throw new TypeError('Lesson 15 runtime evidence is invalid');
  }
  const invalidChallenge = 'Bearer realm="lesson-15-api", error="invalid_token"';
  const c1Runtime = runtime.topology?.originsSeparated === true
    && runtime.topology.resourceIndicator === 'http://127.0.0.1:4102/projects'
    && runtime.topology.jwtValidation === 'rs256-remote-jwks-rfc9068-profile'
    && runtime.topology.policyDecisionPoint === 'project-core'
    && runtime.success?.authorizationStatus === 302
    && runtime.success.callbackStatus === 200
    && runtime.success.resourceStatus === 204
    && runtime.success.outcomeConfirmed === true
    && runtime.success.clientTreatment === 'opaque-forward-only'
    && runtime.success.requiredClaims.join(' ') === 'iss exp aud sub client_id iat jti scope'
    && runtime.resourceIndicator?.status === 302
    && runtime.resourceIndicator.trustedRedirect === true
    && runtime.resourceIndicator.error === 'invalid_target';
  const c2Runtime = runtime.bearer?.missingStatus === 401
    && runtime.bearer.missingChallenge === 'Bearer realm="lesson-15-api"'
    && Array.isArray(runtime.bearer.invalidStatuses)
    && runtime.bearer.invalidStatuses.length === 13
    && runtime.bearer.invalidStatuses.every((value) => value === 401)
    && runtime.bearer.invalidChallenges.length === 13
    && runtime.bearer.invalidChallenges.every((value) => value === invalidChallenge)
    && runtime.bearer.wrongTypeStatus === 401
    && runtime.bearer.idTokenConfusionStatus === 401
    && runtime.bearer.missingClaimsRejected === true
    && runtime.authorization?.insufficientScopeStatus === 403
    && runtime.authorization.insufficientScopeChallenge
      === 'Bearer realm="lesson-15-api", error="insufficient_scope", scope="project:delete"'
    && runtime.authorization.insufficientScopeOutcome === true
    && runtime.authorization.tokenChecksBeforePolicy === true;
  const c3Runtime = runtime.authorization?.viewerStatus === 403
    && runtime.authorization.viewerOutcome === true
    && runtime.authorization.crossTenantStatus === 404
    && runtime.authorization.crossTenantConcealed === true
    && runtime.authorization.unknownProjectStatus === 404
    && runtime.authorization.unknownProjectConcealed === true
    && runtime.safety?.faultInjectionScope === 'runner-owned-fresh-scenario-only'
    && runtime.safety.transportContext === 'loopback-http-training-deviation'
    && runtime.safety.productionRequirement === 'https-required'
    && runtime.safety.secretsOmitted === true
    && tracesAreAllowlisted(runtime.safety.traces);
  const checks = [
    { checkId: 'AA15-C1', runtimePassed: c1Runtime, submissionPassed: matches(submission.answers['AA15-C1'], EXPECTED['AA15-C1']) },
    { checkId: 'AA15-C2', runtimePassed: c2Runtime, submissionPassed: matches(submission.answers['AA15-C2'], EXPECTED['AA15-C2']) },
    { checkId: 'AA15-C3', runtimePassed: c3Runtime, submissionPassed: matches(submission.answers['AA15-C3'], EXPECTED['AA15-C3']) },
  ].map((item) => Object.freeze({ ...item, passed: item.runtimePassed && item.submissionPassed }));
  return Object.freeze({ status: checks.every(({ passed }) => passed) ? 'pass' : 'fail', checks: Object.freeze(checks) });
}

export function lesson15AnswerKey() {
  return structuredClone({ schemaVersion: 1, lessonId: '15', answers: EXPECTED });
}
