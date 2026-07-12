import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { CAPSTONE_CHECK_IDS } from '../../course/lessons/capstone/assessment.mjs';

test('capstone assessment implements the seven required checks and both grading lanes', async () => {
  const assessment = JSON.parse(await readFile(
    new URL('../../course/lessons/capstone/assessment.yaml', import.meta.url),
    'utf8',
  ));
  assert.equal(assessment.assessment.artifactStatus, 'implemented');
  assert.deepEqual(
    assessment.assessment.requiredChecks.map(({ id }) => id),
    CAPSTONE_CHECK_IDS,
  );
  assert.match(assessment.assessment.passCriteria, /80%/u);
  assert.match(assessment.assessment.passCriteria, /skip 0/u);
  assert.match(assessment.assessment.passCriteria, /未解決Critical 0/u);
  assert.match(assessment.assessment.evidence, /自由記述/u);
  assert.match(assessment.assessment.evidence, /講師rubric/u);
});

test('capstone materials contain track choice, four-hour pacing, recovery, calibration, and resubmission', async () => {
  const files = await Promise.all([
    'README.md', 'answer-key.md', 'instructor-guide.md', 'technical-design.md',
  ].map((name) => readFile(new URL(`../../course/lessons/capstone/${name}`, import.meta.url), 'utf8')));
  const combined = files.join('\n');
  for (const marker of [
    'developer', 'iam-operations', '4時間', 'doctor', 'setup', 'demo', 'observe', 'check',
    'stop', 'reset', 'diagnose', 'purge', 'token→scope→tenant→object', 'JML',
    '緊急失効', 'Passkey', 'calibration', '再提出', '自由記述', '機械判定',
  ]) assert.match(combined, new RegExp(marker, 'u'), marker);
});
