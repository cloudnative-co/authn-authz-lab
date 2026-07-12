import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';
import { createScenarioRegistry } from '../../apps/project-app/scenario-registry.mjs';
import { runLesson04Scenario } from '../../course/lessons/04/scenario.mjs';

async function withServer(callback) {
  let sequence = 0;
  const registry = createScenarioRegistry({
    randomId: () => `${String(++sequence).padStart(22, 'D')}`,
  });
  const identity = {
    pid: process.pid,
    installId: 'lesson04-runtime',
    runId: 'runtime-test',
    instanceId: 'lesson04-runtime.runtime-test',
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

test('Lesson 04 runner projection is repeatable and retains no credential or session handle', async () => {
  await withServer(async (origin) => {
    const first = await runLesson04Scenario({ origin });
    const second = await runLesson04Scenario({ origin });
    assert.deepEqual(second, first);
    assert.equal(first.enforcement.callerRoleHeadersAccepted, false);
    assert.equal(first.audit.redacted, true);
    assert.equal(first.audit.bounded, true);
    const serialized = JSON.stringify(first);
    for (const forbidden of [
      'alice.04@example.test', 'bob.04@example.test', 'carol.04@example.test',
      'dave.04@example.test', 'password-for-lesson-04', 'course04_session=',
      'sessionToken', 'shutdownToken', 'tokenDigest', 'x-course-control-token',
      'DDDDDDDDDDDDDDDDDDDDD1', 'A'.repeat(43),
    ]) assert.equal(serialized.includes(forbidden), false);
    assert.doesNotMatch(serialized, /\b[a-f0-9]{64}\b/iu);
  });
});
