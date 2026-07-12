const EXPECTED = Object.freeze({
  'AA12-C1': Object.freeze({
    enrollmentGate: 'password-before-secret-provisioning',
    provisioning: 'otpauth-ecosystem-uri-with-rfc6238-parameters',
    confirmation: 'current-code-required-and-counter-consumed',
    applicationSession: 'issued-only-after-second-factor',
  }),
  'AA12-C2': Object.freeze({
    replay: 'accepted-counter-rejected-on-reuse',
    invalidSurface: 'wrong-expired-and-replayed-are-generic',
    throttling: 'account-level-rate-limit-with-retry-after',
    evidence: 'passwords-secrets-codes-and-tokens-omitted',
  }),
  'AA12-C3': Object.freeze({
    factorClassification: 'totp-is-possession-of-a-shared-secret',
    phishingResistance: 'totp-is-not-phishing-resistant',
    recoveryCode: 'single-display-high-entropy-hash-and-single-use',
    strongerChoice: 'prefer-webauthn-when-phishing-resistance-is-required',
  }),
});

const ALLOWED = Object.freeze({
  enrollmentGate: [
    'password-before-secret-provisioning',
    'anonymous-secret-provisioning',
  ],
  provisioning: [
    'otpauth-ecosystem-uri-with-rfc6238-parameters',
    'rfc6238-standardized-qr-uri',
  ],
  confirmation: [
    'current-code-required-and-counter-consumed',
    'secret-is-active-without-confirmation',
  ],
  applicationSession: [
    'issued-only-after-second-factor',
    'issued-after-password-before-second-factor',
  ],
  replay: [
    'accepted-counter-rejected-on-reuse',
    'same-code-may-be-reused-until-period-ends',
  ],
  invalidSurface: [
    'wrong-expired-and-replayed-are-generic',
    'replay-and-expiry-are-revealed-to-the-client',
  ],
  throttling: [
    'account-level-rate-limit-with-retry-after',
    'unlimited-six-digit-guesses',
  ],
  evidence: [
    'passwords-secrets-codes-and-tokens-omitted',
    'save-provisioning-uri-and-codes-for-debugging',
  ],
  factorClassification: [
    'totp-is-possession-of-a-shared-secret',
    'totp-is-a-biometric-factor',
  ],
  phishingResistance: [
    'totp-is-not-phishing-resistant',
    'totp-is-phishing-resistant-because-it-expires',
  ],
  recoveryCode: [
    'single-display-high-entropy-hash-and-single-use',
    'store-short-recovery-codes-in-plaintext-for-reuse',
  ],
  strongerChoice: [
    'prefer-webauthn-when-phishing-resistance-is-required',
    'prefer-sms-or-totp-whenever-phishing-resistance-is-required',
  ],
});

export class Lesson12SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson12SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson12SubmissionError(reasonCode, message);
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

export function validateLesson12Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '12') {
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
  return Object.entries(expected).every(([field, value]) => actual[field] === value);
}

function allRedacted(redaction) {
  return [
    'passwords',
    'totpSecrets',
    'provisioningUris',
    'totpCodes',
    'recoveryCodes',
    'transactionTokens',
    'sessionTokens',
    'tokenDigests',
    'fullCounters',
  ].every((field) => redaction?.[field] === 'omitted');
}

export function evaluateLesson12Submission(submissionInput, runtime) {
  const submission = validateLesson12Submission(submissionInput);
  if (runtime?.schemaVersion !== 1
      || runtime.lessonId !== '12'
      || runtime.runtimeEvidence !== true
      || runtime.wireEvidence !== true) {
    throw new TypeError('lesson 12 runtime observation is invalid');
  }
  const c1Runtime = runtime.enrollment?.passwordGateStatus === 201
    && runtime.enrollment.passwordGateSessionIssued === false
    && runtime.enrollment.provisioningUri?.scheme === 'otpauth:'
    && runtime.enrollment.provisioningUri.type === 'totp'
    && runtime.enrollment.provisioningUri.issuerPresent === true
    && runtime.enrollment.provisioningUri.secretPresentOnEnrollmentResponse === true
    && runtime.enrollment.provisioningUri.algorithm === 'SHA1'
    && runtime.enrollment.provisioningUri.digits === 6
    && runtime.enrollment.provisioningUri.period === 30
    && runtime.enrollment.confirmationStatus === 201
    && runtime.authentication?.passwordStepStatus === 200
    && runtime.authentication.passwordStepSessionIssued === false
    && runtime.authentication.replayedConfirmationStatus === 422
    && runtime.authentication.secondFactorStatus === 200
    && runtime.authentication.applicationSessionStatus === 200
    && runtime.implementation?.applicationSessionIssuedAfterSecondFactorOnly === true;
  const c2Runtime = runtime.failureHandling?.expiredStatus === 422
    && runtime.failureHandling.wrongStatus === 422
    && runtime.failureHandling.genericBodiesEqual === true
    && runtime.failureHandling.recoveryFirstStatus === 200
    && runtime.failureHandling.recoveryReplayStatus === 422
    && runtime.failureHandling.rateLimitStatus === 429
    && runtime.failureHandling.retryAfterSeconds === 30
    && runtime.state?.replayStateStored === true
    && allRedacted(runtime.redaction);
  const c3Runtime = runtime.implementation?.totpAlgorithm === 'rfc6238'
    && runtime.implementation?.provisioning === 'otpauth-uri-ecosystem-convention'
    && runtime.configuration?.verificationWindow === 1
    && runtime.state?.recoveryCodesUsed === 1
    && runtime.limitations?.phishingResistant === false
    && runtime.limitations?.sharedSecretAtRest === 'in-memory-training-only'
    && runtime.limitations?.provisioningUriStandard === 'ecosystem-convention-not-rfc6238';

  const checks = [
    {
      checkId: 'AA12-C1',
      runtimePassed: c1Runtime,
      data: {
        enrollmentPasswordGateStatus: runtime.enrollment?.passwordGateStatus,
        provisioningScheme: runtime.enrollment?.provisioningUri?.scheme,
        confirmationStatus: runtime.enrollment?.confirmationStatus,
        passwordStepSessionIssued: runtime.authentication?.passwordStepSessionIssued,
        replayStatus: runtime.authentication?.replayedConfirmationStatus,
        applicationSessionStatus: runtime.authentication?.applicationSessionStatus,
      },
    },
    {
      checkId: 'AA12-C2',
      runtimePassed: c2Runtime,
      data: {
        expiredStatus: runtime.failureHandling?.expiredStatus,
        wrongStatus: runtime.failureHandling?.wrongStatus,
        genericBodiesEqual: runtime.failureHandling?.genericBodiesEqual,
        recoveryReplayStatus: runtime.failureHandling?.recoveryReplayStatus,
        rateLimitStatus: runtime.failureHandling?.rateLimitStatus,
        evidenceRedacted: allRedacted(runtime.redaction),
      },
    },
    {
      checkId: 'AA12-C3',
      runtimePassed: c3Runtime,
      data: {
        implementation: runtime.implementation?.totpAlgorithm,
        verificationWindow: runtime.configuration?.verificationWindow,
        recoveryCodesUsed: runtime.state?.recoveryCodesUsed,
        phishingResistant: runtime.limitations?.phishingResistant,
        provisioningUriStandard: runtime.limitations?.provisioningUriStandard,
      },
    },
  ].map((check) => Object.freeze({
    ...check,
    submissionPassed: answersMatch(submission.answers[check.checkId], EXPECTED[check.checkId]),
    passed: check.runtimePassed
      && answersMatch(submission.answers[check.checkId], EXPECTED[check.checkId]),
    allowlist: Object.freeze(Object.keys(check.data)),
  }));
  return Object.freeze({
    status: checks.every(({ passed }) => passed) ? 'pass' : 'fail',
    checks: Object.freeze(checks),
  });
}

export function lesson12AnswerKey() {
  return structuredClone({ schemaVersion: 1, lessonId: '12', answers: EXPECTED });
}
