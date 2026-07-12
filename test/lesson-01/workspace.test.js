import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';
import { Lesson01SubmissionError } from '../../course/lessons/01/assessment.mjs';
import { getLesson01AssessmentReference } from '../../course/lessons/01/domain.mjs';
import {
  buildLesson01SubmissionTemplate,
  checkLesson01ThroughApp,
  fetchLesson01Exercise,
  initializeLesson01Workspace,
  readLesson01Submission,
} from '../../course/lessons/01/workspace.mjs';
import { createStateRoot, writeStateAtomically } from '../../course/runner/state.mjs';
import { loadAndValidateManifest } from '../../course/runner/manifest.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const roots = [];

after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function stateRoot() {
  const root = await mkdtemp(resolve(repositoryRoot, '.lesson-01-workspace-'));
  roots.push(root);
  const manifest = await loadAndValidateManifest({ repoRoot: repositoryRoot });
  const context = await createStateRoot({
    repoRoot: repositoryRoot,
    stateRoot: root,
    courseId: manifest.manifest.courseId,
    sourceRevision: null,
    sourceDigest: manifest.sourceDigest,
  });
  await writeStateAtomically({
    stateRoot: root,
    repoRoot: repositoryRoot,
    state: {
      $schema: 'curriculum/schemas/state.schema.json',
      schemaVersion: 1,
      courseId: context.marker.courseId,
      installId: context.marker.installId,
      markerDigest: context.markerDigest,
      epoch: 1,
      lifecycle: 'stopped',
      lessons: manifest.manifest.lessons.map(({ id }) => ({ id, lifecycle: 'not-started', lastRunId: null, evidenceIds: [] })),
      resources: manifest.manifest.resources.map(({ id }) => ({ id, status: 'absent', ownershipDigest: null })),
      updatedAt: '2026-07-11T00:00:00.000Z',
    },
  });
  return root;
}

function correctSubmission() {
  const reference = getLesson01AssessmentReference();
  return {
    schemaVersion: 1,
    lessonId: '01',
    answers: Object.entries(reference.traceClassifications).map(([traceId, classification]) => ({ traceId, classification })),
    verifiers: Object.entries(reference.expectedVerifiers).map(([boundary, verifier]) => ({ boundary, verifier })),
  };
}

test('workspace preserves learner answers until an explicit reset', async () => {
  const root = await stateRoot();
  const server = createProjectAppServer({
    identity: { pid: process.pid, installId: 'install-test', runId: 'run-test', instanceId: 'install-test.run-test' },
    shutdownToken: 'A'.repeat(43),
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const exercise = await fetchLesson01Exercise({ origin });
    const initialized = await initializeLesson01Workspace({ stateRoot: root, repoRoot: repositoryRoot, exercise });
    assert.equal(initialized.submissionCreated, true);
    assert.deepEqual(await readLesson01Submission({ stateRoot: root, repoRoot: repositoryRoot }), buildLesson01SubmissionTemplate());
    await assert.rejects(
      checkLesson01ThroughApp({ origin, submission: buildLesson01SubmissionTemplate() }),
      (error) => error instanceof Lesson01SubmissionError
        && error.reasonCode === 'SUBMISSION_VALUE_INVALID',
    );

    await writeFile(initialized.submissionPath, `${JSON.stringify(correctSubmission())}\n`);
    const preserved = await initializeLesson01Workspace({ stateRoot: root, repoRoot: repositoryRoot, exercise });
    assert.equal(preserved.submissionCreated, false);
    assert.deepEqual(await readLesson01Submission({ stateRoot: root, repoRoot: repositoryRoot }), correctSubmission());
    assert.equal((await checkLesson01ThroughApp({ origin, submission: correctSubmission() })).status, 'pass');

    await writeFile(initialized.submissionPath, '{not-json\n');
    await assert.rejects(
      readLesson01Submission({ stateRoot: root, repoRoot: repositoryRoot }),
      (error) => error instanceof Lesson01SubmissionError
        && error.reasonCode === 'SUBMISSION_JSON_INVALID',
    );
    await rm(initialized.submissionPath);
    await assert.rejects(
      readLesson01Submission({ stateRoot: root, repoRoot: repositoryRoot }),
      (error) => error instanceof Lesson01SubmissionError
        && error.reasonCode === 'SUBMISSION_MISSING',
    );

    const reset = await initializeLesson01Workspace({ stateRoot: root, repoRoot: repositoryRoot, exercise, reset: true });
    assert.equal(reset.submissionCreated, true);
    assert.deepEqual(JSON.parse(await readFile(reset.submissionPath, 'utf8')), buildLesson01SubmissionTemplate());
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});
