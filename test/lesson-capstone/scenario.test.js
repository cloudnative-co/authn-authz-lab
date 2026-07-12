import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capstoneAnswerKey } from '../../course/lessons/capstone/assessment.mjs';
import { runCapstoneScenario } from '../../course/lessons/capstone/scenario.mjs';

test('capstone demo observes the fixed case without live protocol or sensitive evidence', async () => {
  const runtime = await runCapstoneScenario();
  assert.equal(runtime.mode, 'case-baseline');
  assert.equal(runtime.caseId, 'aster-labs-identity-modernization-v1');
  assert.equal(runtime.runtimeEvidence, true);
  assert.equal(runtime.liveProtocolEvidence, false);
  assert.equal(runtime.criticalRejections.length, 5);
  assert.equal(runtime.criticalRejections.every(({ executed, skipped }) => executed && !skipped), true);
  assert.equal(runtime.metrics.criticalFailureCount, 5);
  assert.equal(runtime.metrics.unresolvedCritical, 3);
  assert.equal(runtime.humanReview.machineInterpretsFreeText, false);

  const serialized = JSON.stringify(runtime);
  for (const forbidden of ['@', '/Users/', 'C:\\', 'Bearer ', 'eyJ', 'password=', 'private-key']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(runtime.redaction, {
    rawCredentials: 'omitted',
    rawTokens: 'omitted',
    personalIdentifiers: 'omitted',
    filesystemPaths: 'omitted',
  });
});

test('developer and IAM operations submissions produce the same allow, deny, and lifecycle outcomes', async () => {
  for (const track of ['developer', 'iam-operations']) {
    const runtime = await runCapstoneScenario({ submission: capstoneAnswerKey(track) });
    assert.equal(runtime.mode, 'submission-check');
    assert.equal(runtime.track, track);
    assert.equal(runtime.decisions.every(({ passed }) => passed), true);
    assert.equal(runtime.lifecycle.every(({ passed }) => passed), true);
    assert.equal(runtime.criticalRejections.every(({ passed }) => passed), true);
  }
});

test('an aborted capstone scenario performs no simulation', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(runCapstoneScenario({ signal: controller.signal }), /cancelled/u);
});
