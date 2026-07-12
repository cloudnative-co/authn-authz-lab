import { getLesson01AssessmentReference, getLesson01Exercise } from './domain.mjs';

export class Lesson01SubmissionError extends Error {
  constructor(reasonCode, message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'Lesson01SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson01SubmissionError(reasonCode, message);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, keys, path) {
  if (!isPlainRecord(value)) fail('SUBMISSION_SCHEMA_INVALID', `${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('SUBMISSION_SCHEMA_INVALID', `${path} has missing or unknown fields`);
  }
}

function assertIdentifier(value, allowed, path) {
  if (typeof value !== 'string' || !allowed.has(value)) {
    fail('SUBMISSION_VALUE_INVALID', `${path} is not an allowed identifier`);
  }
}

export function validateLesson01Submission(submission) {
  assertExactKeys(submission, ['schemaVersion', 'lessonId', 'answers', 'verifiers'], 'submission');
  if (submission.schemaVersion !== 1 || submission.lessonId !== '01') {
    fail('SUBMISSION_VERSION_INVALID', 'submission schemaVersion or lessonId is unsupported');
  }

  const exercise = getLesson01Exercise();
  const traceIds = new Set(exercise.traces.map(({ id }) => id));
  const classifications = new Set(exercise.classifications.map(({ id }) => id));
  const boundaries = new Set(exercise.passCriteria.requiredVerifierBoundaries);
  const verifierIds = new Set(exercise.verifierOptions.map(({ id }) => id));

  if (!Array.isArray(submission.answers) || submission.answers.length !== traceIds.size) {
    fail('SUBMISSION_SCHEMA_INVALID', `answers must contain exactly ${traceIds.size} items`);
  }
  const seenTraces = new Set();
  for (const [index, answer] of submission.answers.entries()) {
    const path = `answers[${index}]`;
    assertExactKeys(answer, ['traceId', 'classification'], path);
    assertIdentifier(answer.traceId, traceIds, `${path}.traceId`);
    assertIdentifier(answer.classification, classifications, `${path}.classification`);
    if (seenTraces.has(answer.traceId)) fail('SUBMISSION_DUPLICATE_TRACE', `${path}.traceId is duplicated`);
    seenTraces.add(answer.traceId);
  }

  if (!Array.isArray(submission.verifiers) || submission.verifiers.length !== boundaries.size) {
    fail('SUBMISSION_SCHEMA_INVALID', `verifiers must contain exactly ${boundaries.size} items`);
  }
  const seenBoundaries = new Set();
  for (const [index, verifier] of submission.verifiers.entries()) {
    const path = `verifiers[${index}]`;
    assertExactKeys(verifier, ['boundary', 'verifier'], path);
    assertIdentifier(verifier.boundary, boundaries, `${path}.boundary`);
    assertIdentifier(verifier.verifier, verifierIds, `${path}.verifier`);
    if (seenBoundaries.has(verifier.boundary)) {
      fail('SUBMISSION_DUPLICATE_BOUNDARY', `${path}.boundary is duplicated`);
    }
    seenBoundaries.add(verifier.boundary);
  }

  return structuredClone(submission);
}

export function evaluateLesson01Submission(input) {
  const submission = validateLesson01Submission(input);
  const exercise = getLesson01Exercise();
  const reference = getLesson01AssessmentReference();
  const answersByTrace = new Map(
    submission.answers.map(({ traceId, classification }) => [traceId, classification]),
  );
  const verifiersByBoundary = new Map(
    submission.verifiers.map(({ boundary, verifier }) => [boundary, verifier]),
  );

  const traceResults = exercise.traces.map(({ id: traceId }) => ({
    traceId,
    correct: reference.traceClassifications[traceId] === answersByTrace.get(traceId),
  }));
  const correctTraces = traceResults.filter(({ correct }) => correct).length;
  const verifierResults = exercise.passCriteria.requiredVerifierBoundaries.map((boundary) => ({
    boundary,
    correct: reference.expectedVerifiers[boundary] === verifiersByBoundary.get(boundary),
  }));
  const allBoundariesVerified = verifierResults.every(({ correct }) => correct);
  const passed = correctTraces >= exercise.passCriteria.minimumCorrectTraces && allBoundariesVerified;

  return {
    schemaVersion: 1,
    lessonId: '01',
    evidenceBasis: 'provided-case-assessment',
    runtimeEvidence: false,
    status: passed ? 'pass' : 'fail',
    score: {
      correctTraces,
      totalTraces: exercise.traces.length,
    },
    criteria: {
      minimumCorrectTraces: exercise.passCriteria.minimumCorrectTraces,
      traceThresholdMet: correctTraces >= exercise.passCriteria.minimumCorrectTraces,
      allBoundariesVerified,
    },
    traceResults,
    verifierResults,
  };
}
