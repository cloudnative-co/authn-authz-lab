import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  evaluateLesson04Submission,
  lesson04AnswerKey,
  validateLesson04Submission,
} from '../../course/lessons/04/assessment.mjs';

function runtime() {
  return {
    schemaVersion: 1,
    lessonId: '04',
    evidenceBasis: 'project-app-runtime-http-cookie-project-core',
    runtimeEvidence: true,
    wireEvidence: true,
    enforcement: {
      anonymousStatus: 403,
      anonymousCode: 'SESSION_UNAVAILABLE',
      wwwAuthenticateAbsent: true,
      unauthenticatedAuditCount: 0,
      principalSource: 'cookie-session',
      roleAndTenantSource: 'project-core-source-of-record',
      callerRoleHeadersAccepted: false,
    },
    owner: {
      status: 204,
      projectPresentAfter: false,
      auditDecision: 'allow',
      auditStatus: 204,
    },
    viewer: {
      status: 403,
      code: 'PROJECT_DELETE_FORBIDDEN',
      projectPresentAfter: true,
      auditDecision: 'deny',
      auditStatus: 403,
    },
    concealment: {
      outsiderStatus: 404,
      crossTenantStatus: 404,
      missingStatus: 404,
      repeatedDeleteStatus: 404,
      responsesEqual: true,
    },
    audit: {
      retainedEntryCount: 6,
      statuses: [403, 404, 404, 404, 204, 404],
      exactPolicyFields: true,
      redacted: true,
      bounded: true,
    },
  };
}

test('Lesson 04 exact answer passes all four runtime-backed checks', () => {
  const evaluated = evaluateLesson04Submission(lesson04AnswerKey(), runtime());
  assert.equal(evaluated.status, 'pass');
  assert.deepEqual(evaluated.checks.map(({ checkId, passed }) => [checkId, passed]), [
    ['AA04-C1', true],
    ['AA04-C2', true],
    ['AA04-C3', true],
    ['AA04-C4', true],
  ]);
  for (const check of evaluated.checks) {
    assert.deepEqual(check.allowlist, Object.keys(check.data));
  }
});

test('Lesson 04 rejects TODO, missing or unknown fields, and unknown values', async () => {
  const template = JSON.parse(await readFile(
    new URL('../../course/lessons/04/workspace-template.json', import.meta.url),
    'utf8',
  ));
  assert.throws(() => validateLesson04Submission(template), /not allowed/u);
  assert.throws(
    () => validateLesson04Submission({ ...lesson04AnswerKey(), extra: true }),
    /unknown fields/u,
  );
  const missing = lesson04AnswerKey();
  delete missing.answers['AA04-C1'].principalSource;
  assert.throws(() => validateLesson04Submission(missing), /missing or unknown fields/u);
  const invalid = lesson04AnswerKey();
  invalid.answers['AA04-C4'].retention = 'forever';
  assert.throws(() => validateLesson04Submission(invalid), /not allowed/u);
});

test('Lesson 04 allowed misconceptions fail only their mapped check', () => {
  const misconceptions = [
    ['AA04-C1', 'callerClaims', 'trusted-for-authorization'],
    ['AA04-C2', 'viewerDelete', 'allowed-by-viewer-role'],
    ['AA04-C3', 'concealmentPolicy', 'different-response-by-resource-existence'],
    ['AA04-C4', 'auditSecrets', 'session-and-password-retained'],
  ];
  for (const [checkId, field, value] of misconceptions) {
    const answer = lesson04AnswerKey();
    answer.answers[checkId][field] = value;
    const evaluated = evaluateLesson04Submission(answer, runtime());
    assert.equal(evaluated.status, 'fail');
    assert.deepEqual(
      evaluated.checks.filter(({ passed }) => !passed).map(({ checkId: id }) => id),
      [checkId],
    );
  }
});

test('Lesson 04 runtime tampering fails the corresponding check', () => {
  const mutations = [
    ['AA04-C1', (value) => { value.enforcement.wwwAuthenticateAbsent = false; }],
    ['AA04-C2', (value) => { value.viewer.projectPresentAfter = false; }],
    ['AA04-C3', (value) => { value.concealment.responsesEqual = false; }],
    ['AA04-C4', (value) => { value.audit.statuses = [204]; }],
  ];
  for (const [checkId, mutate] of mutations) {
    const observed = runtime();
    mutate(observed);
    const evaluated = evaluateLesson04Submission(lesson04AnswerKey(), observed);
    assert.deepEqual(
      evaluated.checks.filter(({ passed }) => !passed).map(({ checkId: id }) => id),
      [checkId],
    );
  }
});

test('Lesson 04 refuses synthetic objects without the exact runtime evidence basis', () => {
  for (const mutate of [
    (value) => { value.runtimeEvidence = false; },
    (value) => { value.wireEvidence = false; },
    (value) => { value.evidenceBasis = 'unit-test-only'; },
  ]) {
    const observed = runtime();
    mutate(observed);
    assert.throws(
      () => evaluateLesson04Submission(lesson04AnswerKey(), observed),
      /runtime observation is invalid/u,
    );
  }
});
