import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  AssessmentContractError,
  bindImplementedAssessmentChecks,
} from '../../course/runner/assessment-contract.mjs';

const implemented = ['AA-SETUP-C1', 'AA-SETUP-C2', 'AA-SETUP-C3'];

async function contract() {
  return JSON.parse(await readFile(resolve(import.meta.dirname, '../../curriculum/course-contract.json'), 'utf8'));
}

test('runner check inventory must exactly match the generated assessment contract', async () => {
  const current = await contract();
  assert.deepEqual(bindImplementedAssessmentChecks({
    courseContract: current,
    lessonId: 'setup',
    implementedCheckIds: implemented,
  }), implemented);

  const changed = structuredClone(current);
  changed.lessons.find(({ id }) => id === 'setup').assessments[0].requiredCheckIds.push('AA-SETUP-C4');
  assert.throws(
    () => bindImplementedAssessmentChecks({
      courseContract: changed,
      lessonId: 'setup',
      implementedCheckIds: implemented,
    }),
    (error) => error instanceof AssessmentContractError
      && error.reasonCode === 'COURSE_ASSESSMENT_CONTRACT',
  );
});
