import { lstat } from 'node:fs/promises';
import { canonicalJson } from '../../runner/canonical.mjs';
import {
  assertNoSymlinkComponents,
  ensureStateDirectory,
  loadStateContext,
  readSecureJson,
  resolveStatePath,
  StateSchemaError,
  writeJsonAtomically,
} from '../../runner/state.mjs';
import { evaluateLesson01Submission, Lesson01SubmissionError } from './assessment.mjs';
import { getLesson01Exercise } from './domain.mjs';

const MAX_RESPONSE_BYTES = 64 * 1024;

function exactLoopbackOrigin(origin) {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'http:'
      || !['127.0.0.1', '[::1]'].includes(parsed.hostname)
      || !parsed.port
      || parsed.origin !== origin) {
    throw new TypeError('origin must be an exact loopback HTTP origin');
  }
  return parsed.origin;
}

async function boundedJsonResponse(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error('lesson response exceeds the size limit');
  }
  const chunks = [];
  let length = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error('lesson response exceeds the size limit');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  } catch (error) {
    throw new Error('lesson response is not valid JSON', { cause: error });
  }
}

function assertExercise(exercise) {
  if (canonicalJson(exercise) !== canonicalJson(getLesson01Exercise())) {
    throw new Error('project-app exercise does not match the checked-in lesson source');
  }
  return exercise;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { redirect: 'error', ...options });
  const body = await boundedJsonResponse(response);
  if (!response.ok) throw new Error(`project-app returned HTTP ${response.status}`);
  return body;
}

export function buildLesson01SubmissionTemplate() {
  const exercise = getLesson01Exercise();
  return {
    schemaVersion: 1,
    lessonId: '01',
    answers: exercise.traces.map(({ id }) => ({ traceId: id, classification: 'TODO' })),
    verifiers: exercise.classifications.map(({ id }) => ({ boundary: id, verifier: 'TODO' })),
  };
}

export async function fetchLesson01Exercise({ origin, signal } = {}) {
  const safeOrigin = exactLoopbackOrigin(origin);
  return assertExercise(await requestJson(`${safeOrigin}/api/lessons/01/request-traces`, { signal }));
}

export async function initializeLesson01Workspace({ stateRoot, repoRoot, exercise, reset = false } = {}) {
  const context = await loadStateContext({ stateRoot, repoRoot });
  if (!context.state) throw new Error('course setup is required');
  assertExercise(exercise);
  await ensureStateDirectory(context, 'submissions', '01');
  const exercisePath = resolveStatePath(context, 'submissions', '01', 'exercise.json');
  const submissionPath = resolveStatePath(context, 'submissions', '01', 'submission.json');
  await writeJsonAtomically({
    anchor: context.stateRoot,
    path: exercisePath,
    value: exercise,
    label: 'lesson 01 exercise',
  });
  const existing = await lstat(submissionPath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing) {
    await assertNoSymlinkComponents({
      anchor: context.stateRoot,
      target: submissionPath,
      expectedLeaf: 'file',
      label: 'lesson 01 submission',
    });
  }
  if (!existing || reset) {
    await writeJsonAtomically({
      anchor: context.stateRoot,
      path: submissionPath,
      value: buildLesson01SubmissionTemplate(),
      exclusive: !existing,
      label: 'lesson 01 submission',
    });
  }
  return { exercisePath, submissionPath, submissionCreated: !existing || reset };
}

export async function readLesson01Submission({ stateRoot, repoRoot } = {}) {
  const context = await loadStateContext({ stateRoot, repoRoot });
  const path = resolveStatePath(context, 'submissions', '01', 'submission.json');
  try {
    return await readSecureJson({ anchor: context.stateRoot, path, label: 'lesson 01 submission' });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Lesson01SubmissionError(
        'SUBMISSION_MISSING',
        'submission.jsonがありません',
        { cause: error },
      );
    }
    if (!(error instanceof StateSchemaError)) throw error;
    throw new Lesson01SubmissionError(
      'SUBMISSION_JSON_INVALID',
      'submission.jsonは有効なJSONではありません',
      { cause: error },
    );
  }
}

export async function checkLesson01ThroughApp({ origin, submission, signal } = {}) {
  const safeOrigin = exactLoopbackOrigin(origin);
  const expected = evaluateLesson01Submission(submission);
  const actual = await requestJson(`${safeOrigin}/api/lessons/01/check`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(submission),
  });
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error('project-app assessment result does not match the checked-in evaluator');
  }
  return actual;
}
