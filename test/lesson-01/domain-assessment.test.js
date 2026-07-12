import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateLesson01Submission,
  Lesson01SubmissionError,
  validateLesson01Submission,
} from '../../course/lessons/01/assessment.mjs';
import { getLesson01AssessmentReference, getLesson01Exercise } from '../../course/lessons/01/domain.mjs';

function correctSubmission() {
  const reference = getLesson01AssessmentReference();
  return {
    schemaVersion: 1,
    lessonId: '01',
    answers: Object.entries(reference.traceClassifications).map(([traceId, classification]) => ({
      traceId,
      classification,
    })),
    verifiers: Object.entries(reference.expectedVerifiers).map(([boundary, verifier]) => ({
      boundary,
      verifier,
    })),
  };
}

test('exercise is finite, deterministic, and does not expose its answer key', () => {
  const first = getLesson01Exercise();
  const second = getLesson01Exercise();
  assert.deepEqual(first, second);
  assert.equal(first.traces.length, 10);
  assert.equal(first.classifications.length, 5);
  assert.equal(first.verifierOptions.length, 5);
  assert.equal(first.passCriteria.minimumCorrectTraces, 9);
  assert.equal(first.evidenceBasis, 'provided-case');
  assert.equal(first.runtimeEvidence, false);
  assert.match(first.evidenceNotice, /SAML、OpenID Connect、OAuth/);
  assert.match(first.classificationQuestion, /1つのHTTP requestに他の境界も残る/);
  assert.deepEqual(first.illustratedProtocolStatus, {
    'saml-2.0': 'not-implemented',
    'openid-connect': 'not-implemented',
    'oauth-2.0': 'not-implemented',
  });
  assert.ok(first.traces.every((trace) => (
    trace.evidenceBasis === 'provided-case' && trace.runtimeEvidence === false
  )));
  assert.deepEqual(
    first.traces.slice(6).map(({ illustratedProtocol, protocolImplementation }) => ({
      illustratedProtocol,
      protocolImplementation,
    })),
    [
      { illustratedProtocol: 'saml-2.0', protocolImplementation: 'not-implemented' },
      { illustratedProtocol: 'openid-connect', protocolImplementation: 'not-implemented' },
      { illustratedProtocol: 'oauth-2.0', protocolImplementation: 'not-implemented' },
      { illustratedProtocol: 'oauth-2.0', protocolImplementation: 'not-implemented' },
    ],
  );
  assert.deepEqual(
    first.passCriteria.requiredVerifierBoundaries,
    ['authentication', 'session', 'authorization', 'federation', 'delegated-authorization'],
  );
  assert.ok(first.traces.every((trace) => !Object.hasOwn(trace, 'classification')));

  const reference = getLesson01AssessmentReference();
  const counts = Object.values(reference.traceClassifications).reduce((result, classification) => {
    result[classification] = (result[classification] ?? 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, {
    authentication: 2,
    session: 2,
    authorization: 2,
    federation: 2,
    'delegated-authorization': 2,
  });

  first.traces[0].title = 'mutated by caller';
  assert.notEqual(getLesson01Exercise().traces[0].title, 'mutated by caller');
});

test('nine correct traces and all five correct verifiers pass', () => {
  const perfect = evaluateLesson01Submission(correctSubmission());
  assert.equal(perfect.status, 'pass');
  assert.equal(perfect.evidenceBasis, 'provided-case-assessment');
  assert.equal(perfect.runtimeEvidence, false);
  assert.deepEqual(perfect.score, { correctTraces: 10, totalTraces: 10 });
  assert.equal(perfect.criteria.allBoundariesVerified, true);

  const oneWrong = correctSubmission();
  oneWrong.answers[0].classification = 'session';
  const threshold = evaluateLesson01Submission(oneWrong);
  assert.equal(threshold.status, 'pass');
  assert.equal(threshold.score.correctTraces, 9);
  assert.equal(threshold.criteria.traceThresholdMet, true);

  const reordered = correctSubmission();
  reordered.answers.reverse();
  reordered.verifiers.reverse();
  assert.deepEqual(evaluateLesson01Submission(reordered), perfect);
});

test('two wrong traces or an incorrect boundary verifier fail', () => {
  const twoWrong = correctSubmission();
  twoWrong.answers[0].classification = 'session';
  twoWrong.answers[1].classification = 'session';
  const belowThreshold = evaluateLesson01Submission(twoWrong);
  assert.equal(belowThreshold.status, 'fail');
  assert.equal(belowThreshold.score.correctTraces, 8);
  assert.equal(belowThreshold.criteria.traceThresholdMet, false);

  const wrongVerifier = correctSubmission();
  wrongVerifier.verifiers[0].verifier = 'session-middleware';
  const missingUnderstanding = evaluateLesson01Submission(wrongVerifier);
  assert.equal(missingUnderstanding.status, 'fail');
  assert.equal(missingUnderstanding.score.correctTraces, 10);
  assert.equal(missingUnderstanding.criteria.allBoundariesVerified, false);
});

test('submission validation fails closed for structural ambiguity', () => {
  const cases = [];

  const unknownTopLevel = { ...correctSubmission(), unexpected: true };
  cases.push([unknownTopLevel, 'SUBMISSION_SCHEMA_INVALID']);

  const missingAnswer = correctSubmission();
  missingAnswer.answers.pop();
  cases.push([missingAnswer, 'SUBMISSION_SCHEMA_INVALID']);

  const duplicateTrace = correctSubmission();
  duplicateTrace.answers[1].traceId = duplicateTrace.answers[0].traceId;
  cases.push([duplicateTrace, 'SUBMISSION_DUPLICATE_TRACE']);

  const unknownClassification = correctSubmission();
  unknownClassification.answers[0].classification = 'identification';
  cases.push([unknownClassification, 'SUBMISSION_VALUE_INVALID']);

  const duplicateBoundary = correctSubmission();
  duplicateBoundary.verifiers[1].boundary = duplicateBoundary.verifiers[0].boundary;
  cases.push([duplicateBoundary, 'SUBMISSION_DUPLICATE_BOUNDARY']);

  const wrongVersion = { ...correctSubmission(), schemaVersion: 2 };
  cases.push([wrongVersion, 'SUBMISSION_VERSION_INVALID']);

  for (const [submission, reasonCode] of cases) {
    assert.throws(
      () => validateLesson01Submission(submission),
      (error) => error instanceof Lesson01SubmissionError && error.reasonCode === reasonCode,
    );
  }
});
