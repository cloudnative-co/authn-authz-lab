import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';
import { createScenarioRegistry } from '../../apps/project-app/scenario-registry.mjs';
import { runLesson02Scenario } from '../../course/lessons/02/scenario.mjs';

async function withServer(callback) {
  let sequence = 0;
  const registry = createScenarioRegistry({
    randomId: () => `${String(++sequence).padStart(22, 'A')}`,
  });
  const identity = {
    pid: process.pid,
    installId: 'lesson02-runtime',
    runId: 'runtime-test',
    instanceId: 'lesson02-runtime.runtime-test',
  };
  const server = createProjectAppServer({
    identity,
    shutdownToken: 'A'.repeat(43),
    scenarioRegistry: registry,
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

test('Lesson 02 runner projection is repeatable and persists no sensitive request values', async () => {
  await withServer(async (origin) => {
    const first = await runLesson02Scenario({ origin });
    const second = await runLesson02Scenario({ origin });
    assert.equal(first.storage.saltFingerprints.length, 2);
    assert.notEqual(first.storage.saltFingerprints[0], first.storage.saltFingerprints[1]);
    const withoutFingerprints = (value) => ({
      ...value,
      storage: { ...value.storage, saltFingerprints: [] },
    });
    assert.deepEqual(withoutFingerprints(second), withoutFingerprints(first));
    const serialized = JSON.stringify(first);
    for (const forbidden of [
      'alice@example.com', 'unknown-user@example.com', 'alice-password-for-lesson-02',
      'separate-rate-key@example.com', 'incorrect-training-password', '$course-scrypt$',
      'AAAAAAAAAAAAAAAAAAAAA1',
    ]) assert.equal(serialized.includes(forbidden), false);
  });
});
