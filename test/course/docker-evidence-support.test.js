import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { lesson06SupportEnvironment } from '../../course/lessons/06/runner.mjs';
import { lesson07SupportEnvironment } from '../../course/lessons/07/runner.mjs';
import { lesson08SupportEnvironment } from '../../course/lessons/08/runner.mjs';
import { lesson09SupportEnvironment } from '../../course/lessons/09/runner.mjs';
import { writeEvidence } from '../../course/runner/evidence.mjs';
import { loadAndValidateManifest } from '../../course/runner/manifest.mjs';
import { createRunnerResult } from '../../course/runner/result.mjs';
import { createStateRoot, writeStateAtomically } from '../../course/runner/state.mjs';
import { inspectSupport } from '../../course/runner/support.mjs';
import { copyPortableCourseReferences } from './portable-course-fixture.js';

const repositoryRoot = resolve(import.meta.dirname, '../..');

test('Docker lesson checks persist evidence for both supported host environments', async (t) => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'authn-authz-docker-evidence-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve(repositoryRoot, 'curriculum'), resolve(root, 'curriculum'), { recursive: true });
  await copyPortableCourseReferences(repositoryRoot, root);
  const { manifest, sourceDigest } = await loadAndValidateManifest({ repoRoot: root });
  const matrix = JSON.parse(await readFile(resolve(root, 'curriculum/support-matrix.json'), 'utf8'));
  const stateRoot = resolve(root, '.lab');
  const context = await createStateRoot({
    repoRoot: root, stateRoot, courseId: manifest.courseId, sourceRevision: null, sourceDigest,
  });
  await writeStateAtomically({
    stateRoot, repoRoot: root, sourceRevision: null, sourceDigest,
    state: {
      $schema: 'curriculum/schemas/state.schema.json',
      schemaVersion: 1,
      courseId: context.marker.courseId,
      installId: context.marker.installId,
      markerDigest: context.markerDigest,
      epoch: 1,
      lifecycle: 'stopped',
      lessons: manifest.lessons.map(({ id }) => ({
        id, lifecycle: 'not-started', lastRunId: null, evidenceIds: [],
      })),
      resources: manifest.resources.map(({ id }) => ({
        id, status: 'absent', ownershipDigest: null,
      })),
      updatedAt: '2026-10-15T00:00:00.000Z',
    },
  });

  for (const [lessonId, supportEnvironment] of [
    ['06', lesson06SupportEnvironment], ['07', lesson07SupportEnvironment],
    ['08', lesson08SupportEnvironment], ['09', lesson09SupportEnvironment],
  ]) {
    for (const [os, architecture, profileId] of [
      ['linux', 'x64', 'linux-x64-node24-docker-engine'],
      ['macos', 'arm64', 'macos-arm64-node24-docker-desktop'],
    ]) {
      await t.test(`Lesson ${lessonId} on ${os} retains the check evidence`, async () => {
        const environment = await supportEnvironment({ os, architecture, nodeMajor: 24, nodeVersion: '24.16.0' });
        const support = await inspectSupport({ matrix, environment });
        assert.equal(support.supported, true, JSON.stringify(support));
        assert.equal(support.profile?.id, profileId);
        const checkIds = [`AA${lessonId}-C1`, `AA${lessonId}-C2`];
        const written = await writeEvidence({
          stateRoot,
          result: createRunnerResult({
            runId: `run-${lessonId}-${os}`, courseId: manifest.courseId, scope: 'lesson',
            lessonId, command: 'check', status: 'pass', checkIds, durationMs: 1,
          }),
          context: {
            repoRoot: root,
            supportProfileId: support.profile.id,
            supportEnvironment: environment,
            observations: checkIds.map((checkId) => ({ checkId, outcome: 'pass' })),
          },
        });
        assert.match(written.result.evidenceId, /^evidence-/u);
        const persisted = JSON.parse(await readFile(written.path, 'utf8'));
        assert.equal(persisted.evidenceId, written.result.evidenceId);
        assert.equal(persisted.supportProfileId, profileId);
        assert.deepEqual(persisted.checkIds, checkIds);
      });
    }
  }
});
