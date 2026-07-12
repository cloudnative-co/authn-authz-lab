import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';
import { createScenarioRegistry } from '../../apps/project-app/scenario-registry.mjs';
import { runLesson05Scenario } from '../../course/lessons/05/scenario.mjs';

test('Lesson 05 runtime projection is repeatable and redacts Basic credentials', async () => {
  let sequence = 0;
  const server = createProjectAppServer({
    identity: {
      pid: process.pid,
      installId: 'lesson05-runtime',
      runId: 'runtime-test',
      instanceId: 'lesson05-runtime.runtime-test',
    },
    shutdownToken: 'A'.repeat(43),
    scenarioRegistry: createScenarioRegistry({
      randomId: () => `${String(++sequence).padStart(22, 'E')}`,
    }),
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await runLesson05Scenario({ origin });
    const second = await runLesson05Scenario({ origin });
    assert.deepEqual(second, first);
    assert.equal(first.challenge.header, 'Basic realm="lesson-05", charset="UTF-8"');
    assert.equal(first.safety.redacted, true);
    const serialized = JSON.stringify(first);
    for (const forbidden of [
      'basic.alice@example.test',
      'basic-password-for-lesson-05',
      'YmFzaWMuYWxpY2VAZXhhbXBsZS50ZXN0OmJhc2ljLXBhc3N3b3JkLWZvci1sZXNzb24tMDU=',
      'EEEEEEEEEEEEEEEEEEEEE1',
    ]) assert.equal(serialized.includes(forbidden), false);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});
