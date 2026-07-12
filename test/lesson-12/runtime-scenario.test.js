import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';
import { runLesson12Scenario } from '../../course/lessons/12/scenario.mjs';

test('fresh HTTP scenario proves enrollment, MFA gate, rejection, recovery, and redaction', async (t) => {
  const identity = Object.freeze({
    pid: process.pid,
    installId: randomBytes(16).toString('base64url'),
    runId: randomBytes(16).toString('base64url'),
    get instanceId() { return `${this.installId}.${this.runId}`; },
  });
  const server = createProjectAppServer({
    identity,
    shutdownToken: randomBytes(32).toString('base64url'),
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const runtime = await runLesson12Scenario({ origin: `http://127.0.0.1:${address.port}` });
  assert.equal(runtime.runtimeEvidence, true);
  assert.equal(runtime.wireEvidence, true);
  assert.equal(runtime.enrollment.confirmationStatus, 201);
  assert.equal(runtime.authentication.replayedConfirmationStatus, 422);
  assert.equal(runtime.authentication.applicationSessionStatus, 200);
  assert.equal(runtime.failureHandling.genericBodiesEqual, true);
  assert.equal(runtime.failureHandling.recoveryReplayStatus, 422);
  assert.equal(runtime.failureHandling.rateLimitStatus, 429);
  assert.equal(runtime.redaction.totpSecrets, 'omitted');
  assert.equal(runtime.limitations.phishingResistant, false);
});
