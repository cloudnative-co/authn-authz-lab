import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { recoverManagedProcess, startManagedNode } from '../../course/runner/managed-process.mjs';
import { retryManagedStartupStop } from '../../course/runner/managed-startup-recovery.mjs';
import { stopOwnedProcess } from '../../course/runner/process.mjs';
import {
  ALLOWLIST, RESOURCE_ID, fixtureRepository, killWorker, liveProcesses,
  readCurrentPair, spawnManagedWorker, startOptions, waitForCondition, waitUntilGone,
} from './managed-process-fixture.js';

test('recovery waits for a committed bootstrap to open its listener without releasing its ownership lock', async () => {
  const fixture = await fixtureRepository();
  const gate = resolve(fixture.repoRoot, 'allow-listen');
  const serverSource = await readFile(fixture.scriptPath, 'utf8');
  await writeFile(fixture.scriptPath, `
import { access as probeGate } from 'node:fs/promises';
while (!await probeGate(${JSON.stringify(gate)}).then(() => true, () => false)) {
  await new Promise(resolve => setTimeout(resolve, 5));
}
${serverSource}`);
  const session = await spawnManagedWorker({
    fixture, options: await startOptions(fixture, 'delayed-listen'), pauseAfterPointer: true,
  });
  await waitForCondition(
    () => readFile(session.readyPath).then(() => true, () => false),
    'committed pointer before target listener',
  );
  const pair = await readCurrentPair(fixture);
  liveProcesses.set(pair.record.pid, pair.record);
  await killWorker(session.worker);
  let attempts = 0;
  const recovered = await recoverManagedProcess({
    stateRoot: fixture.context.stateRoot, repoRoot: fixture.repoRoot,
    resourceId: RESOURCE_ID, allowedResourceIds: ALLOWLIST,
    dependencies: {
      async stopOwnedProcess(options) {
        attempts += 1;
        const result = await stopOwnedProcess(options);
        if (attempts === 1) {
          assert.equal(result.reasonCode, 'HEALTH_UNREACHABLE');
          await writeFile(gate, 'ready');
        } else {
          await assert.rejects(startManagedNode({
            stateRoot: fixture.context.stateRoot, repoRoot: fixture.repoRoot,
            resourceId: RESOURCE_ID, allowedResourceIds: ALLOWLIST,
            startOptions: await startOptions(fixture, 'concurrent-start'),
          }), (error) => error.reasonCode === 'PROCESS_OPERATION_LOCKED');
        }
        return result;
      },
    },
  });
  assert.equal(recovered.status, 'stopped', JSON.stringify(recovered));
  assert.ok(attempts >= 2);
  await waitUntilGone(pair.record.pid);
  liveProcesses.delete(pair.record.pid);
  const stopped = await readCurrentPair(fixture);
  assert.equal(stopped.record.status, 'stopped');
  assert.equal(stopped.control.status, 'retired');
  assert.equal(stopped.control.shutdownToken, null);
  const events = await readFile(fixture.eventPath, 'utf8');
  assert.equal((events.match(/authenticated-shutdown:/g) ?? []).length, 1);
  assert.doesNotMatch(events, /^sigterm:/mu);
});

test('startup recovery never retries a failed identity or unverified HTTP response', async () => {
  for (const reasonCode of [
    'PROCESS_FINGERPRINT_MISMATCH', 'PROCESS_FINGERPRINT_UNVERIFIABLE',
    'HEALTH_IDENTITY_MISMATCH', 'HEALTH_INVALID_RESPONSE', 'HEALTH_TIMEOUT',
  ]) {
    let attempts = 0;
    const expected = { status: 'blocked', reasonCode };
    assert.deepEqual(await retryManagedStartupStop({
      timeoutMs: 500,
      stop: async () => { attempts += 1; return expected; },
    }), expected);
    assert.equal(attempts, 1, reasonCode);
  }
});

test('startup recovery stops retrying at the original deadline', async () => {
  let attempts = 0;
  let previousBudget = Infinity;
  const startedAt = performance.now();
  const expected = { status: 'blocked', reasonCode: 'HEALTH_UNREACHABLE' };
  assert.deepEqual(await retryManagedStartupStop({
    timeoutMs: 70,
    stop: async (remaining) => {
      assert.ok(remaining > 0 && remaining <= previousBudget);
      previousBudget = remaining;
      attempts += 1;
      return expected;
    },
  }), expected);
  assert.ok(attempts >= 2);
  assert.ok(performance.now() - startedAt < 1_000);
});

test('startup recovery honors cancellation instead of sending another stop request', async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(retryManagedStartupStop({
    timeoutMs: 500, signal: controller.signal,
    stop: async () => {
      attempts += 1;
      controller.abort();
      return { status: 'blocked', reasonCode: 'HEALTH_UNREACHABLE' };
    },
  }));
  assert.equal(attempts, 1);
});
