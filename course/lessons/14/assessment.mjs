const EXPECTED = Object.freeze({
  'AA14-C1': Object.freeze({
    discoverableCredential: 'empty-allowcredentials-and-returned-userhandle',
    usernameTiming: 'not-required-before-credential-selection',
    rpRevocation: 'disable-rp-record-private-credential-remains',
    recovery: 'second-independent-credential-restores-access',
  }),
  'AA14-C2': Object.freeze({
    backupFlags: 'be-is-eligibility-bs-is-current-backup-state',
    cloudSyncEvidence: 'virtual-flags-do-not-prove-real-sync',
    accountDisable: 'invalidate-sessions-and-reject-new-assertions',
    signCount: 'risk-signal-not-clone-proof',
  }),
});

const ALLOWED = Object.freeze({
  discoverableCredential: [
    'empty-allowcredentials-and-returned-userhandle',
    'username-is-embedded-in-rp-id',
  ],
  usernameTiming: [
    'not-required-before-credential-selection',
    'always-required-before-navigator-credentials-get',
  ],
  rpRevocation: [
    'disable-rp-record-private-credential-remains',
    'rp-deletes-private-key-from-every-authenticator',
  ],
  recovery: [
    'second-independent-credential-restores-access',
    'one-credential-is-enough-without-recovery',
  ],
  backupFlags: [
    'be-is-eligibility-bs-is-current-backup-state',
    'be-and-bs-prove-which-cloud-provider-synced-it',
  ],
  cloudSyncEvidence: [
    'virtual-flags-do-not-prove-real-sync',
    'cdp-backup-flags-prove-end-to-end-cloud-sync',
  ],
  accountDisable: [
    'invalidate-sessions-and-reject-new-assertions',
    'existing-sessions-remain-valid-after-account-disable',
  ],
  signCount: ['risk-signal-not-clone-proof', 'zero-counter-means-cloned-passkey'],
});

export class Lesson14SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson14SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson14SubmissionError(reasonCode, message);
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

export function validateLesson14Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '14') {
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

export function evaluateLesson14Submission(input, runtime) {
  const submission = validateLesson14Submission(input);
  if (runtime?.schemaVersion !== 1 || runtime.lessonId !== '14' || runtime.runtimeEvidence !== true) {
    throw new TypeError('lesson 14 runtime observation is invalid');
  }
  const c1Runtime = runtime.browserAPI?.registration === 'navigator.credentials.create'
    && runtime.browserAPI.authentication === 'navigator.credentials.get'
    && runtime.discoverableLogin?.allowCredentialsOmitted === true
    && runtime.discoverableLogin.usernameSupplied === false
    && runtime.discoverableLogin.authenticationStatus === 200
    && runtime.discoverableLogin.sessionStatus === 200
    && runtime.discoverableLogin.returnedUserHandleVerified === true
    && runtime.revocation?.rpStatus === 200
    && runtime.revocation.privateCredentialRemovedByRP === false
    && runtime.revocation.authenticatorCredentialCountBefore === runtime.revocation.authenticatorCredentialCountAfter
    && runtime.revocation.revokedAssertionStatus === 422
    && runtime.recovery?.secondCredentialRegistered === true
    && runtime.recovery.authenticationStatus === 200
    && runtime.recovery.sessionStatus === 200;
  const c2Runtime = runtime.recovery?.deviceType === 'multiDevice'
    && runtime.recovery.backupEligibleFlagObserved === true
    && runtime.recovery.backupStateFlagObserved === true
    && runtime.recovery.cloudSyncProven === false
    && runtime.accountLifecycle?.disableStatus === 200
    && runtime.accountLifecycle.existingSessionAfterDisableStatus === 401
    && runtime.accountLifecycle.newAssertionAfterDisableStatus === 422
    && runtime.accountLifecycle.sessionsRemaining === 0
    && runtime.semantics?.signCount === 'risk-signal-not-clone-proof'
    && runtime.semantics.virtualBackupFlagsProveCloudSync === false
    && runtime.virtualAuthenticatorLimitations?.includes('backup-flags-do-not-prove-cloud-sync')
    && redacted(runtime);
  const runtimeByCheck = { 'AA14-C1': c1Runtime, 'AA14-C2': c2Runtime };
  const checks = Object.entries(EXPECTED).map(([checkId, expected]) => {
    const runtimePassed = runtimeByCheck[checkId];
    const submissionPassed = answersMatch(submission.answers[checkId], expected);
    const data = {
      browserAPI: runtime.browserAPI,
      discoverableLogin: runtime.discoverableLogin,
      revocation: runtime.revocation,
      recovery: runtime.recovery,
      accountLifecycle: runtime.accountLifecycle,
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

export function lesson14AnswerKey() {
  return structuredClone({ schemaVersion: 1, lessonId: '14', answers: EXPECTED });
}
