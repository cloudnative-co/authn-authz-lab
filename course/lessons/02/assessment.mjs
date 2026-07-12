const EXPECTED = Object.freeze({
  'AA02-C1': Object.freeze({
    storedFormat: 'application-defined-not-phc',
    passwordNormalization: 'NFC',
    scryptProfile: 'N=32768,r=8,p=3',
    plaintextStorage: 'absent',
    samePasswordSalts: 'different',
  }),
  'AA02-C2': Object.freeze({
    successfulResult: 'authenticated-without-session',
    wrongAndUnknownFailure: 'same-generic-422',
    sessionIssuance: 'not-implemented',
  }),
  'AA02-C3': Object.freeze({
    thresholdResponse: 'third-failure-429-with-retry-after',
    offlineGuessingControl: 'scrypt-work-factor-and-salt',
    onlineGuessingControl: 'per-identifier-rate-limit',
    rateLimitScope: 'per-identifier-not-global-kdf-defense',
  }),
});

const ALLOWED = Object.freeze({
  storedFormat: ['application-defined-not-phc', 'phc-string-format'],
  passwordNormalization: ['NFC', 'none'],
  scryptProfile: ['N=32768,r=8,p=3', 'N=16384,r=8,p=1'],
  plaintextStorage: ['absent', 'present'],
  samePasswordSalts: ['different', 'same'],
  successfulResult: ['authenticated-without-session', 'authenticated-with-session'],
  wrongAndUnknownFailure: ['same-generic-422', 'different-by-identifier-existence'],
  sessionIssuance: ['not-implemented', 'implemented'],
  thresholdResponse: ['third-failure-429-with-retry-after', 'unlimited-422'],
  offlineGuessingControl: ['scrypt-work-factor-and-salt', 'per-identifier-rate-limit'],
  onlineGuessingControl: ['per-identifier-rate-limit', 'stored-salt-only'],
  rateLimitScope: ['per-identifier-not-global-kdf-defense', 'global-kdf-concurrency-defense'],
});

export class Lesson02SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson02SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson02SubmissionError(reasonCode, message);
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

export function validateLesson02Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '02') {
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

export function evaluateLesson02Submission(submissionInput, runtime) {
  const submission = validateLesson02Submission(submissionInput);
  if (runtime?.schemaVersion !== 1 || runtime.lessonId !== '02' || runtime.runtimeEvidence !== true) {
    throw new TypeError('lesson 02 runtime observation is invalid');
  }
  const c1Runtime = runtime.storage?.format === 'course-scrypt'
    && runtime.storage.passwordNormalization === 'NFC'
    && runtime.storage.algorithm === 'scrypt'
    && runtime.storage.workFactor?.N === 32768
    && runtime.storage.workFactor?.r === 8
    && runtime.storage.workFactor?.p === 3
    && runtime.storage.saltBytes === 16
    && runtime.storage.samePasswordSaltsDiffer === true
    && runtime.storage.plaintextRetained === false
    && runtime.storage.encodedCredentialsExposed === false
    && runtime.storage.derivedKeysExposed === false
    && runtime.storage.passwordPolicyIsSeparate === true;
  const c2Runtime = runtime.authentication?.successStatus === 200
    && runtime.authentication.successCode === 'AUTHENTICATED'
    && runtime.authentication.sessionIssued === false
    && runtime.authentication.wrongStatus === 422
    && runtime.authentication.unknownStatus === 422
    && runtime.authentication.genericFailuresEqual === true
    && runtime.authentication.unknownUserVerification === 'dummy-scrypt';
  const c3Runtime = runtime.rateLimit?.failureThreshold === 3
    && runtime.rateLimit.maxTrackedIdentifiers === 8
    && runtime.rateLimit.thresholdStatus === 429
    && runtime.rateLimit.thresholdCode === 'RATE_LIMITED'
    && runtime.rateLimit.retryAfterSeconds === 30
    && runtime.rateLimit.blockedCorrectStatus === 429
    && runtime.rateLimit.otherIdentifierStatus === 422
    && runtime.rateLimit.trackedIdentifiersAtCapacity === 8
    && runtime.rateLimit.capacityStatus === 503
    && runtime.rateLimit.capacityCode === 'AUTHENTICATION_CAPACITY_EXCEEDED'
    && runtime.rateLimit.capacityRetryAfterSeconds === 1
    && runtime.rateLimit.capacityBehavior === 'reject-new-identifier-with-503-before-kdf'
    && runtime.rateLimit.scope === 'per-identifier'
    && runtime.rateLimit.globalKdfConcurrencyDefense === false
    && runtime.rateLimit.recoveredStatus === 200;

  const checks = [
    {
      checkId: 'AA02-C1',
      runtimePassed: c1Runtime,
      submissionPassed: answersMatch(submission.answers['AA02-C1'], EXPECTED['AA02-C1']),
      data: {
        format: runtime.storage?.format,
        normalization: runtime.storage?.passwordNormalization,
        algorithm: runtime.storage?.algorithm,
        workFactorN: runtime.storage?.workFactor?.N,
        workFactorR: runtime.storage?.workFactor?.r,
        workFactorP: runtime.storage?.workFactor?.p,
        saltBytes: runtime.storage?.saltBytes,
        saltsDiffer: runtime.storage?.samePasswordSaltsDiffer,
        inputValueRetained: runtime.storage?.plaintextRetained,
        encodedRecordExposed: runtime.storage?.encodedCredentialsExposed,
        derivedOutputExposed: runtime.storage?.derivedKeysExposed,
        policySeparate: runtime.storage?.passwordPolicyIsSeparate,
      },
    },
    {
      checkId: 'AA02-C2',
      runtimePassed: c2Runtime,
      submissionPassed: answersMatch(submission.answers['AA02-C2'], EXPECTED['AA02-C2']),
      data: {
        successStatus: runtime.authentication?.successStatus,
        sessionIssued: runtime.authentication?.sessionIssued,
        wrongStatus: runtime.authentication?.wrongStatus,
        unknownStatus: runtime.authentication?.unknownStatus,
        genericFailuresEqual: runtime.authentication?.genericFailuresEqual,
        dummyVerification: runtime.authentication?.unknownUserVerification === 'dummy-scrypt',
      },
    },
    {
      checkId: 'AA02-C3',
      runtimePassed: c3Runtime,
      submissionPassed: answersMatch(submission.answers['AA02-C3'], EXPECTED['AA02-C3']),
      data: {
        failureThreshold: runtime.rateLimit?.failureThreshold,
        maxTrackedIdentifiers: runtime.rateLimit?.maxTrackedIdentifiers,
        thresholdStatus: runtime.rateLimit?.thresholdStatus,
        retryAfterSeconds: runtime.rateLimit?.retryAfterSeconds,
        blockedCorrectStatus: runtime.rateLimit?.blockedCorrectStatus,
        otherIdentifierStatus: runtime.rateLimit?.otherIdentifierStatus,
        trackedIdentifiersAtCapacity: runtime.rateLimit?.trackedIdentifiersAtCapacity,
        capacityStatus: runtime.rateLimit?.capacityStatus,
        capacityRetryAfterSeconds: runtime.rateLimit?.capacityRetryAfterSeconds,
        capacityBehavior: runtime.rateLimit?.capacityBehavior,
        scope: runtime.rateLimit?.scope,
        globalCapacityDefense: runtime.rateLimit?.globalKdfConcurrencyDefense,
        recoveredStatus: runtime.rateLimit?.recoveredStatus,
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

export function lesson02AnswerKey() {
  return structuredClone({ schemaVersion: 1, lessonId: '02', answers: EXPECTED });
}
