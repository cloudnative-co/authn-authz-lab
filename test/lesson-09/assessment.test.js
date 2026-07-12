import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateLesson09Submission,
  lesson09AnswerKey,
  validateLesson09Submission,
} from '../../course/lessons/09/assessment.mjs';

const reasonByCase = Object.freeze({
  signature: 'SIGNATURE_INVALID',
  'response-issuer': 'RESPONSE_ISSUER_INVALID',
  'assertion-issuer': 'ASSERTION_ISSUER_INVALID',
  audience: 'AUDIENCE_INVALID',
  destination: 'DESTINATION_INVALID',
  'response-in-response-to': 'IN_RESPONSE_TO_INVALID',
  'subject-method': 'SUBJECT_CONFIRMATION_METHOD_INVALID',
  'subject-recipient': 'SUBJECT_CONFIRMATION_RECIPIENT_INVALID',
  'subject-in-response-to': 'SUBJECT_CONFIRMATION_IN_RESPONSE_TO_INVALID',
  expiry: 'SUBJECT_CONFIRMATION_EXPIRED',
  replay: 'REPLAY_DETECTED',
});

function runtime() {
  return {
    schemaVersion: 1,
    lessonId: '09',
    runtimeEvidence: true,
    actual: {
      completed: true,
      idpImplementation: 'Keycloak-26.7.0',
      userAgentScope: 'scripted-http-form-cookie-agent-not-gui-browser',
      trace: ['authn-request', 'saml-response-form', 'acs', 'authenticated-page']
        .map((stage) => ({ stage })),
    },
    conformance: {
      caseCount: 11,
      allRejected: true,
      reasonsMatched: true,
      rejectedBeforeSession: true,
      cases: Object.entries(reasonByCase).map(([caseName, reason]) => ({
        case: caseName,
        rejected: true,
        reason,
        expectedReason: reason,
        sessionCreated: false,
        oneFault: true,
      })),
    },
    strictValidation: {
      responseAndAssertionSignatures: true,
      appSessionAfterValidationOnly: true,
    },
    evidenceRedaction: {
      rawSamlResponse: 'omitted',
      assertionXml: 'omitted',
      nameId: 'omitted',
      sessionCookie: 'omitted',
      privateKey: 'omitted',
    },
  };
}

test('Lesson 09 answer key passes only with actual and conformance runtime evidence', () => {
  const result = evaluateLesson09Submission(lesson09AnswerKey(), runtime());
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.checks.map(({ checkId }) => checkId), ['AA09-C1', 'AA09-C2']);
});

test('Lesson 09 rejects unknown submission fields', () => {
  const answer = lesson09AnswerKey();
  answer.answers['AA09-C1'].unknown = 'value';
  assert.throws(() => validateLesson09Submission(answer), { reasonCode: 'SUBMISSION_SCHEMA_INVALID' });
});

test('Lesson 09 fails when a rejection creates a session', () => {
  const observed = runtime();
  observed.conformance.cases[0].sessionCreated = true;
  assert.throws(
    () => evaluateLesson09Submission(lesson09AnswerKey(), observed),
    /runtime observation is invalid/u,
  );
});
