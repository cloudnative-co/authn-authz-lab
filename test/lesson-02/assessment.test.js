import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  evaluateLesson02Submission,
  lesson02AnswerKey,
  validateLesson02Submission,
} from '../../course/lessons/02/assessment.mjs';

function runtime() {
  return {
    schemaVersion: 1,
    lessonId: '02',
    runtimeEvidence: true,
    storage: {
      format: 'course-scrypt', passwordNormalization: 'NFC', algorithm: 'scrypt',
      workFactor: { N: 32768, r: 8, p: 3 }, saltBytes: 16,
      samePasswordSaltsDiffer: true, plaintextRetained: false,
      encodedCredentialsExposed: false, derivedKeysExposed: false,
      passwordPolicyIsSeparate: true,
    },
    authentication: {
      successStatus: 200, successCode: 'AUTHENTICATED', sessionIssued: false,
      wrongStatus: 422, unknownStatus: 422, genericFailuresEqual: true,
      unknownUserVerification: 'dummy-scrypt',
    },
    rateLimit: {
      failureThreshold: 3, maxTrackedIdentifiers: 8,
      thresholdStatus: 429, thresholdCode: 'RATE_LIMITED',
      retryAfterSeconds: 30, blockedCorrectStatus: 429, scope: 'per-identifier',
      otherIdentifierStatus: 422, trackedIdentifiersAtCapacity: 8,
      capacityStatus: 503, capacityCode: 'AUTHENTICATION_CAPACITY_EXCEEDED',
      capacityRetryAfterSeconds: 1,
      capacityBehavior: 'reject-new-identifier-with-503-before-kdf',
      globalKdfConcurrencyDefense: false, recoveredStatus: 200,
    },
  };
}

test('Lesson 02 exact answer passes all required checks', () => {
  const evaluated = evaluateLesson02Submission(lesson02AnswerKey(), runtime());
  assert.equal(evaluated.status, 'pass');
  assert.deepEqual(evaluated.checks.map(({ checkId, passed }) => [checkId, passed]), [
    ['AA02-C1', true], ['AA02-C2', true], ['AA02-C3', true],
  ]);
});

test('Lesson 02 rejects TODO, unknown fields, and unknown values', async () => {
  const template = JSON.parse(await readFile(
    new URL('../../course/lessons/02/workspace-template.json', import.meta.url),
    'utf8',
  ));
  assert.throws(() => validateLesson02Submission(template), /not allowed/u);
  assert.throws(() => validateLesson02Submission({ ...lesson02AnswerKey(), extra: true }), /unknown fields/u);
  const invalid = lesson02AnswerKey();
  invalid.answers['AA02-C1'].storedFormat = 'unknown';
  assert.throws(() => validateLesson02Submission(invalid), /not allowed/u);
});

test('Lesson 02 allowed misconception fails only its mapped check', () => {
  const answer = lesson02AnswerKey();
  answer.answers['AA02-C3'].rateLimitScope = 'global-kdf-concurrency-defense';
  const evaluated = evaluateLesson02Submission(answer, runtime());
  assert.equal(evaluated.status, 'fail');
  assert.deepEqual(evaluated.checks.map(({ passed }) => passed), [true, true, false]);
});
