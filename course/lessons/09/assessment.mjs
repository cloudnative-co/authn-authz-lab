const EXPECTED = Object.freeze({
  'AA09-C1': Object.freeze({
    flow: 'sp-authnrequest-idp-login-post-response-acs-session',
    bindings: 'redirect-request-and-post-response',
    trust: 'metadata-certificate-pins-idp-signature-trust',
    session: 'created-only-after-complete-validation',
    userAgentScope: 'scripted-http-agent-not-gui-browser-proof',
  }),
  'AA09-C2': Object.freeze({
    signatures: 'response-and-assertion-both-required',
    semanticChecks: 'issuer-audience-conditions-destination-inresponseto',
    subjectConfirmation: 'single-bearer-recipient-expiry-inresponseto',
    replay: 'request-response-assertion-one-time',
    evidence: 'omit-xml-nameid-cookie-private-key',
  }),
});

const EXPECTED_DIAGNOSIS = Object.freeze({
  D1: 'metadata-and-authnrequest-do-not-prove-sso-completed',
  D2: 'valid-signature-does-not-replace-recipient-and-audience-checks',
  D3: 'relaystate-and-inresponseto-bind-different-parts-of-the-flow',
  D4: 'app-session-is-local-and-created-after-saml-validation',
  D5: 'keycloak-success-does-not-generalize-to-every-idp-or-browser',
});

const ALLOWED = Object.freeze({
  flow: ['sp-authnrequest-idp-login-post-response-acs-session', 'metadata-download-only'],
  bindings: ['redirect-request-and-post-response', 'json-api-for-both-messages'],
  trust: ['metadata-certificate-pins-idp-signature-trust', 'issuer-text-alone-establishes-trust'],
  session: ['created-only-after-complete-validation', 'created-before-signature-validation'],
  userAgentScope: ['scripted-http-agent-not-gui-browser-proof', 'all-browser-js-and-csp-proven'],
  signatures: ['response-and-assertion-both-required', 'unsigned-assertion-is-safe-inside-response'],
  semanticChecks: [
    'issuer-audience-conditions-destination-inresponseto',
    'signature-only-without-protocol-semantics',
  ],
  subjectConfirmation: [
    'single-bearer-recipient-expiry-inresponseto',
    'accept-any-subject-confirmation-method',
  ],
  replay: ['request-response-assertion-one-time', 'same-signed-response-remains-valid-until-expiry'],
  evidence: ['omit-xml-nameid-cookie-private-key', 'retain-raw-assertion-for-scoring'],
  D1: ['metadata-and-authnrequest-do-not-prove-sso-completed', 'metadata-proves-acs-session-success'],
  D2: [
    'valid-signature-does-not-replace-recipient-and-audience-checks',
    'signature-makes-destination-and-audience-irrelevant',
  ],
  D3: [
    'relaystate-and-inresponseto-bind-different-parts-of-the-flow',
    'relaystate-is-the-signed-assertion-recipient',
  ],
  D4: [
    'app-session-is-local-and-created-after-saml-validation',
    'saml-response-is-the-application-session-cookie',
  ],
  D5: [
    'keycloak-success-does-not-generalize-to-every-idp-or-browser',
    'one-keycloak-script-proves-all-saml-products-and-browsers',
  ],
});

export function lesson09LearnerChoices() {
  return structuredClone(ALLOWED);
}

export class Lesson09SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson09SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson09SubmissionError(reasonCode, message);
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

export function validateLesson09Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers', 'diagnosis'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '09') {
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
  exactKeys(value.diagnosis, Object.keys(EXPECTED_DIAGNOSIS), 'diagnosis');
  for (const [field, answer] of Object.entries(value.diagnosis)) {
    if (!ALLOWED[field]?.includes(answer)) fail('SUBMISSION_VALUE_INVALID', `diagnosis.${field} is not allowed`);
  }
  return structuredClone(value);
}

function answersMatch(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function validRuntime(runtime) {
  const stages = runtime?.actual?.trace?.map(({ stage }) => stage) ?? [];
  const cases = runtime?.conformance?.cases ?? [];
  return runtime?.schemaVersion === 1
    && runtime.lessonId === '09'
    && runtime.runtimeEvidence === true
    && runtime.actual?.completed === true
    && runtime.actual.idpImplementation === 'Keycloak-26.7.0'
    && runtime.actual.userAgentScope === 'scripted-http-form-cookie-agent-not-gui-browser'
    && ['authn-request', 'saml-response-form', 'acs', 'authenticated-page']
      .every((stage) => stages.includes(stage))
    && runtime.conformance?.caseCount === 11
    && cases.every((entry) => entry.rejected === true
      && entry.reason === entry.expectedReason
      && entry.sessionCreated === false
      && entry.oneFault === true)
    && runtime.strictValidation?.responseAndAssertionSignatures === true
    && runtime.strictValidation.appSessionAfterValidationOnly === true
    && runtime.evidenceRedaction?.rawSamlResponse === 'omitted'
    && runtime.evidenceRedaction?.assertionXml === 'omitted'
    && runtime.evidenceRedaction?.nameId === 'omitted'
    && runtime.evidenceRedaction?.sessionCookie === 'omitted'
    && runtime.evidenceRedaction?.privateKey === 'omitted';
}

export function evaluateLesson09Submission(submissionInput, runtime) {
  const submission = validateLesson09Submission(submissionInput);
  if (!validRuntime(runtime)) throw new TypeError('lesson 09 runtime observation is invalid');
  const diagnosisScore = Object.entries(EXPECTED_DIAGNOSIS)
    .filter(([key, value]) => submission.diagnosis[key] === value).length;
  const checks = [
    {
      checkId: 'AA09-C1',
      runtimePassed: runtime.actual.completed === true,
      submissionPassed: answersMatch(submission.answers['AA09-C1'], EXPECTED['AA09-C1']),
      data: {
        actualKeycloakFlow: true,
        appSessionCreated: true,
        scriptedUserAgentScope: true,
      },
    },
    {
      checkId: 'AA09-C2',
      runtimePassed: runtime.conformance.allRejected === true
        && runtime.conformance.reasonsMatched === true
        && runtime.conformance.rejectedBeforeSession === true,
      submissionPassed: answersMatch(submission.answers['AA09-C2'], EXPECTED['AA09-C2'])
        && diagnosisScore >= 4,
      data: {
        rejectionCaseCount: runtime.conformance.caseCount,
        oneFaultCases: true,
        replayRejected: runtime.conformance.cases.some(({ case: name }) => name === 'replay'),
        diagnosisScore,
        diagnosisRequired: 4,
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

export function lesson09AnswerKey() {
  return structuredClone({
    schemaVersion: 1,
    lessonId: '09',
    answers: EXPECTED,
    diagnosis: EXPECTED_DIAGNOSIS,
  });
}
