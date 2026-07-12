import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  evaluateLesson05Submission,
  lesson05AnswerKey,
  validateLesson05Submission,
} from '../../course/lessons/05/assessment.mjs';

function runtime() {
  return {
    schemaVersion: 1,
    lessonId: '05',
    runtimeEvidence: true,
    wireEvidence: true,
    challenge: {
      absentStatus: 401,
      wrongStatus: 401,
      header: 'Basic realm="lesson-05", charset="UTF-8"',
      allFailureHeadersEqual: true,
      allFailureBodiesEqual: true,
    },
    success: {
      status: 200,
      code: 'BASIC_AUTHENTICATED',
      principalId: 'user-500',
      challengeAbsent: true,
      setCookieAbsent: true,
      nextRequestWithoutHeaderStatus: 401,
    },
    protocol: {
      scheme: 'Basic',
      challengeMatchesRfc7617ExampleShape: true,
      credentialEncoding: 'canonical-base64-of-utf8-nfc-user-pass',
      authenticatesEveryRequest: true,
      sessionIssuance: false,
    },
    safety: {
      transportContext: 'loopback-http-training-deviation',
      productionRequirement: 'tls-required',
      authorizationHeaderOmitted: true,
      decodedCredentialsOmitted: true,
      redacted: true,
      requestCount: 4,
      successCount: 1,
      challengeCount: 3,
    },
  };
}

test('Lesson 05 exact answer passes both required checks', () => {
  const evaluated = evaluateLesson05Submission(lesson05AnswerKey(), runtime());
  assert.equal(evaluated.status, 'pass');
  assert.deepEqual(evaluated.checks.map(({ checkId, passed }) => [checkId, passed]), [
    ['AA05-C1', true], ['AA05-C2', true],
  ]);
});

test('Lesson 05 rejects TODO, unknown fields, and unknown values', async () => {
  const template = JSON.parse(await readFile(
    new URL('../../course/lessons/05/workspace-template.json', import.meta.url),
    'utf8',
  ));
  assert.throws(() => validateLesson05Submission(template), /not allowed/u);
  assert.throws(() => validateLesson05Submission({ ...lesson05AnswerKey(), extra: true }), /unknown fields/u);
  const invalid = lesson05AnswerKey();
  invalid.answers['AA05-C1'].challenge = 'unknown';
  assert.throws(() => validateLesson05Submission(invalid), /not allowed/u);
});

test('a permitted misconception fails only its mapped check', () => {
  const answer = lesson05AnswerKey();
  answer.answers['AA05-C2'].base64Security = 'encryption-protects-the-password';
  const evaluated = evaluateLesson05Submission(answer, runtime());
  assert.equal(evaluated.status, 'fail');
  assert.deepEqual(evaluated.checks.map(({ passed }) => passed), [true, false]);
});
