const EXPECTED = Object.freeze({
  'AA13-C1': Object.freeze({
    userHandle: 'random-64-byte-account-opaque-value',
    registrationPersistence: 'store-only-after-verification',
    ceremonyAPI: 'create-for-registration-get-for-authentication',
    attestation: 'none-has-no-device-attestation-signature',
  }),
  'AA13-C2': Object.freeze({
    challengeOrigin: 'both-bound-and-server-verified',
    rpID: 'browser-scope-and-rp-hash-server-verification',
    assertionSignature: 'verify-with-stored-public-key',
    transactionReplay: 'single-use-and-expiring',
  }),
  'AA13-C3': Object.freeze({
    signCount: 'risk-signal-not-clone-proof',
    userHandleCheck: 'compare-to-credential-account',
    failureSurface: 'generic-client-fixed-internal-reason',
    virtualAuthenticator: 'protocol-test-not-hardware-or-user-gesture-proof',
  }),
});

const ALLOWED = Object.freeze({
  userHandle: ['random-64-byte-account-opaque-value', 'sha256-of-email-is-always-safe'],
  registrationPersistence: ['store-only-after-verification', 'store-before-verification-for-debugging'],
  ceremonyAPI: ['create-for-registration-get-for-authentication', 'get-for-registration-create-for-authentication'],
  attestation: ['none-has-no-device-attestation-signature', 'none-means-skip-all-registration-verification'],
  challengeOrigin: ['both-bound-and-server-verified', 'browser-only-no-server-check'],
  rpID: ['browser-scope-and-rp-hash-server-verification', 'rp-id-is-an-unverified-display-name'],
  assertionSignature: ['verify-with-stored-public-key', 'accept-if-credential-id-exists'],
  transactionReplay: ['single-use-and-expiring', 'reusable-until-browser-closes'],
  signCount: ['risk-signal-not-clone-proof', 'definitive-proof-of-cloning'],
  userHandleCheck: ['compare-to-credential-account', 'trust-returned-userhandle-without-mapping'],
  failureSurface: ['generic-client-fixed-internal-reason', 'return-cryptographic-reason-to-client'],
  virtualAuthenticator: [
    'protocol-test-not-hardware-or-user-gesture-proof',
    'proof-of-real-hardware-biometric-and-cloud-sync',
  ],
});

export class Lesson13SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson13SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson13SubmissionError(reasonCode, message);
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

export function validateLesson13Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '13') {
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

function redacted(runtime) {
  return [
    'passwords', 'sessionTokens', 'csrfTokens', 'challenges', 'userHandles', 'credentialIds',
    'publicKeys', 'attestationObjects', 'assertions', 'signatures', 'fullCounters',
  ].every((field) => runtime.redaction?.[field] === 'omitted');
}

export function evaluateLesson13Submission(input, runtime) {
  const submission = validateLesson13Submission(input);
  if (runtime?.schemaVersion !== 1 || runtime.lessonId !== '13' || runtime.runtimeEvidence !== true) {
    throw new TypeError('lesson 13 runtime observation is invalid');
  }
  const c1Runtime = runtime.browserAPI?.registration === 'navigator.credentials.create'
    && runtime.browserAPI.authentication === 'navigator.credentials.get'
    && runtime.browserAPI.registrationClientDataType === 'webauthn.create'
    && runtime.browserAPI.authenticationClientDataType === 'webauthn.get'
    && runtime.registration?.invalidChallengeStatus === 422
    && runtime.registration.rpCredentialCountAfterRejectedCeremony === 0
    && runtime.registration.validStatus === 201
    && runtime.registration.rpCredentialCountAfterValidCeremony === 1
    && runtime.registration.attestationFormat === 'none'
    && runtime.registration.deviceAttestationSignatureExpected === false
    && runtime.userHandle?.byteLength === 64
    && runtime.userHandle.generation === 'cryptographically-random-per-account'
    && runtime.userHandle.containsPII === false;
  const c2Runtime = runtime.authentication?.mode === 'username-bound'
    && runtime.authentication.allowCredentialsCount === 1
    && runtime.authentication.successStatus === 200
    && runtime.authentication.sessionStatus === 200
    && runtime.authentication.signatureVerifiedByRP === true
    && runtime.authentication.userVerificationRequired === true
    && runtime.negative?.challengeStatus === 422
    && runtime.negative.originStatus === 422
    && runtime.negative.rpIdBoundary === 'browser-rejected-before-assertion'
    && runtime.negative.signatureStatus === 422
    && runtime.negative.replayStatus === 422
    && runtime.negative.userHandleStatus === 422
    && runtime.negative.genericExternalFailure === true;
  const c3Runtime = runtime.semantics?.signCount === 'risk-signal-not-clone-proof'
    && runtime.semantics.authenticationSignature === 'verified-with-registered-public-key'
    && runtime.semantics.registrationAttestationSignature === 'none-format-has-no-device-attestation-signature'
    && runtime.virtualAuthenticatorLimitations?.includes('not-hardware-authenticator-proof')
    && runtime.virtualAuthenticatorLimitations?.includes('not-real-user-gesture-proof')
    && redacted(runtime);
  const runtimeByCheck = { 'AA13-C1': c1Runtime, 'AA13-C2': c2Runtime, 'AA13-C3': c3Runtime };
  const checks = Object.entries(EXPECTED).map(([checkId, expected]) => {
    const runtimePassed = runtimeByCheck[checkId];
    const submissionPassed = answersMatch(submission.answers[checkId], expected);
    const data = {
      browserAPI: runtime.browserAPI,
      registration: runtime.registration,
      authentication: runtime.authentication,
      negative: runtime.negative,
      semantics: runtime.semantics,
      rawCredentialsOmitted: runtime.rawCredentialsOmitted,
    };
    return {
      checkId,
      runtimePassed,
      submissionPassed,
      passed: runtimePassed && submissionPassed,
      data,
      allowlist: Object.freeze(Object.keys(data)),
    };
  });
  return Object.freeze({
    status: checks.every(({ passed }) => passed) ? 'pass' : 'fail',
    checks: Object.freeze(checks.map(Object.freeze)),
  });
}

export function lesson13AnswerKey() {
  return structuredClone({ schemaVersion: 1, lessonId: '13', answers: EXPECTED });
}
