const EXPECTED = Object.freeze({
  'AA07-C1': Object.freeze({
    tgt: 'present-after-kinit-before-http-service-ticket',
    serviceTicket: 'obtained-from-tgs-for-http-service',
    challenge: '401-with-www-authenticate-negotiate',
    acceptor: 'gssapi-validates-service-ticket-with-read-only-keytab',
    scope: 'kerberos-mechanism-not-general-spnego-or-browser',
  }),
  'AA07-C2': Object.freeze({
    wrongSpn: 'tgs-rejects-unknown-service-before-http',
    clockSkew: 'ap-rejects-offset-client-process-with-host-clock-unchanged',
    staleKeytab: 'acceptor-rejects-kvno-mismatch-with-generic-401',
    transport: 'tls-required-private-http-training-only',
    evidence: 'omit-password-tokens-keytab-native-error',
  }),
});

const EXPECTED_DIAGNOSIS = Object.freeze({
  D1: 'tgt-does-not-authorize-the-http-service',
  D2: 'wrong-spn-fails-at-tgs-before-http',
  D3: 'clock-skew-is-ap-time-validation-not-password-failure',
  D4: 'keytab-kvno-mismatch-fails-at-the-acceptor',
  D5: 'negotiate-challenge-does-not-prove-browser-sent-kerberos',
});

const ALLOWED = Object.freeze({
  tgt: ['present-after-kinit-before-http-service-ticket', 'same-ticket-as-http-service-ticket'],
  serviceTicket: ['obtained-from-tgs-for-http-service', 'embedded-in-the-user-password'],
  challenge: ['401-with-www-authenticate-negotiate', '403-without-challenge'],
  acceptor: [
    'gssapi-validates-service-ticket-with-read-only-keytab',
    'application-decodes-a-json-ticket-with-a-shared-hmac',
  ],
  scope: [
    'kerberos-mechanism-not-general-spnego-or-browser',
    'all-spnego-mechanisms-and-browsers-proven',
  ],
  wrongSpn: ['tgs-rejects-unknown-service-before-http', 'application-rejects-a-password-after-http'],
  clockSkew: [
    'ap-rejects-offset-client-process-with-host-clock-unchanged',
    'host-clock-is-changed-and-password-is-rejected',
  ],
  staleKeytab: [
    'acceptor-rejects-kvno-mismatch-with-generic-401',
    'client-reuses-the-tgt-as-the-acceptor-key',
  ],
  transport: ['tls-required-private-http-training-only', 'plain-http-approved-for-production'],
  evidence: ['omit-password-tokens-keytab-native-error', 'retain-authorization-token-for-debugging'],
  D1: ['tgt-does-not-authorize-the-http-service', 'tgt-is-the-http-service-ticket'],
  D2: ['wrong-spn-fails-at-tgs-before-http', 'wrong-spn-reaches-the-http-handler'],
  D3: [
    'clock-skew-is-ap-time-validation-not-password-failure',
    'clock-skew-means-the-password-hash-did-not-match',
  ],
  D4: ['keytab-kvno-mismatch-fails-at-the-acceptor', 'keytab-kvno-is-ignored-by-the-acceptor'],
  D5: [
    'negotiate-challenge-does-not-prove-browser-sent-kerberos',
    'negotiate-challenge-proves-every-browser-sent-kerberos',
  ],
});

export class Lesson07SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson07SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson07SubmissionError(reasonCode, message);
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

export function validateLesson07Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers', 'diagnosis'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '07') {
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

function diagnosisScore(actual) {
  return Object.entries(EXPECTED_DIAGNOSIS)
    .filter(([key, expected]) => actual[key] === expected).length;
}

function validRuntime(runtime) {
  return runtime?.schemaVersion === 1
    && runtime.lessonId === '07'
    && runtime.evidenceBasis === 'mit-kerberos-v5-kdc-kinit-klist-tgs-gssapi-http-negotiate'
    && runtime.runtimeEvidence === true
    && runtime.wireEvidence === true;
}

export function evaluateLesson07Submission(submissionInput, runtime) {
  const submission = validateLesson07Submission(submissionInput);
  if (!validRuntime(runtime)) throw new TypeError('lesson 07 runtime observation is invalid');

  const c1Runtime = runtime.normal?.afterKinit?.canonicalPrincipal === true
    && runtime.normal.afterKinit.tgtPresent === true
    && runtime.normal.afterKinit.httpServiceTicketPresent === false
    && runtime.normal.afterKinit.ticketServicePrincipals?.length === 1
    && runtime.normal.afterKinit.ticketServicePrincipals[0] === 'krbtgt/EXAMPLE.TEST@EXAMPLE.TEST'
    && runtime.normal.challenge?.status === 401
    && runtime.normal.challenge.scheme === 'Negotiate'
    && runtime.normal.authenticated?.status === 200
    && runtime.normal.authenticated.code === 'KERBEROS_AUTHENTICATED'
    && runtime.normal.authenticated.principal === 'alice@EXAMPLE.TEST'
    && runtime.normal.afterServiceRequest?.tgtPresent === true
    && runtime.normal.afterServiceRequest.httpServiceTicketPresent === true
    && runtime.normal.afterServiceRequest.ticketServicePrincipals?.length === 2
    && runtime.normal.afterServiceRequest.ticketServicePrincipals[0] === 'krbtgt/EXAMPLE.TEST@EXAMPLE.TEST'
    && runtime.normal.afterServiceRequest.ticketServicePrincipals[1]
      === 'HTTP/app.example.test@EXAMPLE.TEST'
    && runtime.protocol?.implementation === 'MIT-Kerberos-V5-and-GSSAPI'
    && runtime.protocol.exchange === 'AS-TGS-AP-over-HTTP-Negotiate'
    && runtime.protocol.mechanismScope === 'Kerberos-v5-in-SPNEGO'
    && runtime.protocol.generalSpnegoContinuationSupported === false
    && runtime.protocol.incompleteContextCount === 0
    && runtime.protocol.finalAcceptorTokenObserved === true
    && runtime.protocol.browserBehaviorGeneralized === false
    && runtime.protocol.curlGssApi === true
    && runtime.protocol.curlSpnego === true;

  const c2Runtime = runtime.rejection?.wrongSpn?.rejected === true
    && runtime.rejection.wrongSpn.stage === 'TGS'
    && runtime.rejection.wrongSpn.reason === 'SERVICE_PRINCIPAL_UNKNOWN'
    && runtime.rejection.clockSkew?.stage === 'AP-GSSAPI'
    && runtime.rejection.clockSkew.processOffset === '+10-minutes'
    && runtime.rejection.clockSkew.status === 401
    && runtime.rejection.clockSkew.code === 'NEGOTIATE_REQUIRED'
    && runtime.rejection.clockSkew.reason === 'CLOCK_SKEW_REJECTED'
    && runtime.rejection.staleKeytab?.stage === 'AP-GSSAPI'
    && runtime.rejection.staleKeytab.status === 401
    && runtime.rejection.staleKeytab.code === 'NEGOTIATE_REQUIRED'
    && runtime.rejection.staleKeytab.reason === 'ACCEPTOR_KEY_MISMATCH'
    && runtime.rejection.staleKeytab.currentKvnoGreaterThanStale === true
    && runtime.rejection.staleKeytab.currentRestored === true
    && runtime.rejection.genericHttpSurface === true
    && runtime.safety?.transportContext === 'compose-private-http-training-deviation'
    && runtime.safety.productionRequirement === 'tls-required'
    && runtime.safety.authorizationTokenOmitted === true
    && runtime.safety.responseTokenOmitted === true
    && runtime.safety.keytabOmitted === true
    && runtime.safety.nativeErrorOmitted === true
    && runtime.safety.passwordOmitted === true
    && runtime.safety.keytabReadOnly === true
    && runtime.safety.hostClockChanged === false;

  const score = diagnosisScore(submission.diagnosis);
  const checks = [
    {
      checkId: 'AA07-C1',
      runtimePassed: c1Runtime,
      submissionPassed: answersMatch(submission.answers['AA07-C1'], EXPECTED['AA07-C1']),
      data: {
        tgtBeforeServiceTicket: runtime.normal?.afterKinit?.tgtPresent === true
          && runtime.normal?.afterKinit?.httpServiceTicketPresent === false,
        challengeStatus: runtime.normal?.challenge?.status,
        challengeScheme: runtime.normal?.challenge?.scheme,
        successStatus: runtime.normal?.authenticated?.status,
        serviceTicketAfterRequest: runtime.normal?.afterServiceRequest?.httpServiceTicketPresent,
        mechanismScope: runtime.protocol?.mechanismScope,
        continuationContexts: runtime.protocol?.incompleteContextCount,
        finalAcceptorTokenObserved: runtime.protocol?.finalAcceptorTokenObserved,
      },
    },
    {
      checkId: 'AA07-C2',
      runtimePassed: c2Runtime,
      submissionPassed: answersMatch(submission.answers['AA07-C2'], EXPECTED['AA07-C2']) && score >= 4,
      data: {
        wrongSpnReason: runtime.rejection?.wrongSpn?.reason,
        clockSkewReason: runtime.rejection?.clockSkew?.reason,
        staleKeytabReason: runtime.rejection?.staleKeytab?.reason,
        genericHttpSurface: runtime.rejection?.genericHttpSurface,
        currentRestored: runtime.rejection?.staleKeytab?.currentRestored,
        diagnosisScore: score,
        diagnosisRequired: 4,
        secretsOmitted: runtime.safety?.authorizationTokenOmitted === true
          && runtime.safety?.responseTokenOmitted === true
          && runtime.safety?.keytabOmitted === true
          && runtime.safety?.passwordOmitted === true,
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

export function lesson07AnswerKey() {
  return structuredClone({
    schemaVersion: 1,
    lessonId: '07',
    answers: EXPECTED,
    diagnosis: EXPECTED_DIAGNOSIS,
  });
}
