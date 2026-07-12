import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  evaluateLesson03Submission,
  lesson03AnswerKey,
  validateLesson03Submission,
} from '../../course/lessons/03/assessment.mjs';

function runtime() {
  return {
    schemaVersion: 1, lessonId: '03', runtimeEvidence: true, wireEvidence: true,
    transport: {
      tokenBytes: 32, opaqueToken: true, httpOnly: true, sameSite: 'Lax', path: '/',
      domainOmitted: true, secure: false,
      transportContext: 'loopback-http-training-deviation', browserEnforcementTested: false,
    },
    storage: { mode: 'sha-256-token-digest-only', rawValuesExposed: false, fullDigestsExposed: false },
    rotation: { observed: true, priorHandleStatus: 403, currentHandleStatus: 200 },
    expiration: { mode: 'absolute-not-sliding', postBoundaryStatus: 403 },
    logout: { status: 204, cleared: true, postLogoutStatus: 403 },
    revocation: { firstCount: 1, postRevocationStatus: 403, repeatedCount: 0 },
  };
}

test('Lesson 03 exact answer passes all required checks', () => {
  const evaluated = evaluateLesson03Submission(lesson03AnswerKey(), runtime());
  assert.equal(evaluated.status, 'pass');
  assert.deepEqual(evaluated.checks.map(({ checkId, passed }) => [checkId, passed]), [
    ['AA03-C1', true], ['AA03-C2', true], ['AA03-C3', true], ['AA03-C4', true],
  ]);
});

test('Lesson 03 rejects TODO, unknown fields, and unknown values', async () => {
  const template = JSON.parse(await readFile(
    new URL('../../course/lessons/03/workspace-template.json', import.meta.url),
    'utf8',
  ));
  assert.throws(() => validateLesson03Submission(template), /not allowed/u);
  assert.throws(() => validateLesson03Submission({ ...lesson03AnswerKey(), extra: true }), /unknown fields/u);
  const invalid = lesson03AnswerKey();
  invalid.answers['AA03-C1'].cookiePath = '/unknown';
  assert.throws(() => validateLesson03Submission(invalid), /not allowed/u);
});

test('Lesson 03 allowed misconception fails only its mapped check', () => {
  const answer = lesson03AnswerKey();
  answer.answers['AA03-C2'].loginRotation = 'reuse-pre-auth-token';
  const evaluated = evaluateLesson03Submission(answer, runtime());
  assert.equal(evaluated.status, 'fail');
  assert.deepEqual(evaluated.checks.map(({ passed }) => passed), [true, false, true, true]);
});

test('Lesson 03 never treats Node header observation as browser enforcement evidence', () => {
  const claimedBrowserEvidence = runtime();
  claimedBrowserEvidence.transport.browserEnforcementTested = true;
  const evaluated = evaluateLesson03Submission(lesson03AnswerKey(), claimedBrowserEvidence);
  assert.equal(evaluated.status, 'fail');
  assert.deepEqual(evaluated.checks.map(({ passed }) => passed), [false, true, true, true]);
});
