import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';
import { createScenarioRegistry } from '../../apps/project-app/scenario-registry.mjs';
import { runLesson03Scenario } from '../../course/lessons/03/scenario.mjs';

async function withServer(callback) {
  let sequence = 0;
  const registry = createScenarioRegistry({
    randomId: () => `${String(++sequence).padStart(22, 'B')}`,
  });
  const identity = {
    pid: process.pid,
    installId: 'lesson03-runtime',
    runId: 'runtime-test',
    instanceId: 'lesson03-runtime.runtime-test',
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

test('Lesson 03 runner projection is repeatable and persists no credential or control handle', async () => {
  await withServer(async (origin) => {
    const first = await runLesson03Scenario({ origin });
    const second = await runLesson03Scenario({ origin });
    assert.ok(first.trace.digestFingerprints.length > 0);
    const withoutFingerprints = (value) => ({
      ...value,
      trace: { ...value.trace, digestFingerprints: [] },
    });
    assert.deepEqual(withoutFingerprints(second), withoutFingerprints(first));
    const serialized = JSON.stringify(first);
    for (const forbidden of [
      'alice@example.com', 'user-alice', 'alice-password-for-lesson-02',
      'BBBBBBBBBBBBBBBBBBBBB1', 'course_session=', 'set-cookie',
    ]) assert.equal(serialized.includes(forbidden), false);
    assert.doesNotMatch(serialized, /[a-f0-9]{64}/u);
    assert.doesNotMatch(serialized, /[A-Za-z0-9_-]{43}/u);
  });
});
