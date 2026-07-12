import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createScenarioRegistry,
  ScenarioRegistryError,
} from '../../apps/project-app/scenario-registry.mjs';

test('scenario capacity includes pending factories and expired entries release their slot', async () => {
  let now = 0;
  let releaseFactory;
  const registry = createScenarioRegistry({
    maxScenarios: 1,
    ttlMs: 100,
    clock: () => now,
    randomId: () => 'A'.repeat(22),
  });
  const pending = registry.create('02', () => new Promise((resolvePromise) => {
    releaseFactory = () => resolvePromise({ value: 'first' });
  }));
  await assert.rejects(
    registry.create('03', async () => ({ value: 'second' })),
    (error) => error instanceof ScenarioRegistryError
      && error.reasonCode === 'SCENARIO_CAPACITY_EXHAUSTED',
  );
  releaseFactory();
  const created = await pending;
  assert.equal(registry.get('02', created.id).value, 'first');
  assert.equal(registry.get('03', created.id), null);
  assert.deepEqual(registry.inspect(), { size: 1, pendingCreates: 0, counts: { '02': 1 } });

  now = 100;
  assert.equal(registry.get('02', created.id), null);
  const replacement = await registry.create('03', async () => ({ value: 'replacement' }));
  assert.equal(registry.get('03', replacement.id).value, 'replacement');
});

test('scenario ids must be canonical and uniqueness retries are bounded', async () => {
  const invalid = createScenarioRegistry({ randomId: () => 'not-canonical' });
  await assert.rejects(
    invalid.create('02', async () => ({})),
    (error) => error.reasonCode === 'SCENARIO_ID_UNAVAILABLE',
  );

  const duplicate = createScenarioRegistry({ maxScenarios: 2, randomId: () => 'B'.repeat(22) });
  await duplicate.create('02', async () => ({}));
  await assert.rejects(
    duplicate.create('02', async () => ({})),
    (error) => error.reasonCode === 'SCENARIO_ID_UNAVAILABLE',
  );
});
