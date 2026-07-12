import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  evaluateLesson12Submission,
  lesson12AnswerKey,
  Lesson12SubmissionError,
  validateLesson12Submission,
} from '../../course/lessons/12/assessment.mjs';

const runtime = Object.freeze({
  schemaVersion: 1,
  lessonId: '12',
  runtimeEvidence: true,
  wireEvidence: true,
  enrollment: {
    passwordGateStatus: 201,
    passwordGateSessionIssued: false,
    provisioningUri: {
      scheme: 'otpauth:',
      type: 'totp',
      issuerPresent: true,
      secretPresentOnEnrollmentResponse: true,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    },
    confirmationStatus: 201,
  },
  authentication: {
    passwordStepStatus: 200,
    passwordStepSessionIssued: false,
    replayedConfirmationStatus: 422,
    secondFactorStatus: 200,
    applicationSessionStatus: 200,
  },
  failureHandling: {
    expiredStatus: 422,
    wrongStatus: 422,
    genericBodiesEqual: true,
    recoveryFirstStatus: 200,
    recoveryReplayStatus: 422,
    rateLimitStatus: 429,
    retryAfterSeconds: 30,
  },
  implementation: {
    applicationSessionIssuedAfterSecondFactorOnly: true,
    totpAlgorithm: 'rfc6238',
    provisioning: 'otpauth-uri-ecosystem-convention',
  },
  configuration: { verificationWindow: 1 },
  state: { replayStateStored: true, recoveryCodesUsed: 1 },
  redaction: {
    passwords: 'omitted',
    totpSecrets: 'omitted',
    provisioningUris: 'omitted',
    totpCodes: 'omitted',
    recoveryCodes: 'omitted',
    transactionTokens: 'omitted',
    sessionTokens: 'omitted',
    tokenDigests: 'omitted',
    fullCounters: 'omitted',
  },
  limitations: {
    phishingResistant: false,
    sharedSecretAtRest: 'in-memory-training-only',
    provisioningUriStandard: 'ecosystem-convention-not-rfc6238',
  },
});

test('answer key and runtime pass all required checks', () => {
  const result = evaluateLesson12Submission(lesson12AnswerKey(), runtime);
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.checks.map(({ checkId, passed }) => [checkId, passed]), [
    ['AA12-C1', true],
    ['AA12-C2', true],
    ['AA12-C3', true],
  ]);
});

test('TODO and unknown fields are rejected', async () => {
  const template = JSON.parse(await readFile(
    new URL('../../course/lessons/12/workspace-template.json', import.meta.url),
    'utf8',
  ));
  assert.throws(
    () => validateLesson12Submission(template),
    (error) => error instanceof Lesson12SubmissionError
      && error.reasonCode === 'SUBMISSION_VALUE_INVALID',
  );
  const key = lesson12AnswerKey();
  key.answers['AA12-C1'].unknown = 'value';
  assert.throws(
    () => validateLesson12Submission(key),
    (error) => error.reasonCode === 'SUBMISSION_SCHEMA_INVALID',
  );
});

test('a conceptually wrong choice fails only its mapped check', () => {
  const submission = lesson12AnswerKey();
  submission.answers['AA12-C3'].phishingResistance = 'totp-is-phishing-resistant-because-it-expires';
  const result = evaluateLesson12Submission(submission, runtime);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.checks.map(({ passed }) => passed), [true, true, false]);
});
