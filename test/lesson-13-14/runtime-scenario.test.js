import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';
import { runLesson13Scenario } from '../../course/lessons/13/scenario.mjs';
import { runLesson14Scenario } from '../../course/lessons/14/scenario.mjs';

async function withProjectApp(callback) {
  const installId = randomBytes(16).toString('base64url');
  const runId = randomBytes(16).toString('base64url');
  const identity = Object.freeze({
    pid: process.pid,
    installId,
    runId,
    instanceId: `${installId}.${runId}`,
  });
  const server = createProjectAppServer({
    identity,
    shutdownToken: randomBytes(32).toString('base64url'),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

test('Lesson 13 runs actual browser registration, authentication, and isolated rejection cases', async () => {
  const runtime = await withProjectApp((origin) => runLesson13Scenario({ origin }));
  assert.equal(runtime.browserAPI.registration, 'navigator.credentials.create');
  assert.equal(runtime.browserAPI.authentication, 'navigator.credentials.get');
  assert.equal(runtime.registration.rpCredentialCountAfterRejectedCeremony, 0);
  assert.equal(runtime.registration.validStatus, 201);
  assert.equal(runtime.authentication.successStatus, 200);
  assert.equal(runtime.negative.challengeStatus, 422);
  assert.equal(runtime.negative.originStatus, 422);
  assert.equal(runtime.negative.rpIdBoundary, 'browser-rejected-before-assertion');
  assert.equal(runtime.negative.signatureStatus, 422);
  assert.equal(runtime.negative.replayStatus, 422);
  assert.equal(runtime.negative.userHandleStatus, 422);
  assert.equal(runtime.negative.genericExternalFailure, true);
  assert.equal(runtime.userHandle.byteLength, 64);
  assert.equal(runtime.semantics.signCount, 'risk-signal-not-clone-proof');
  assert.equal(runtime.redaction.assertions, 'omitted');
});

test('Lesson 14 proves discoverable login, RP revocation, recovery, and account invalidation', async () => {
  const runtime = await withProjectApp((origin) => runLesson14Scenario({ origin }));
  assert.equal(runtime.discoverableLogin.usernameSupplied, false);
  assert.equal(runtime.discoverableLogin.authenticationStatus, 200);
  assert.equal(runtime.revocation.privateCredentialRemovedByRP, false);
  assert.equal(runtime.revocation.revokedAssertionStatus, 422);
  assert.equal(runtime.recovery.authenticationStatus, 200);
  assert.equal(runtime.recovery.backupEligibleFlagObserved, true);
  assert.equal(runtime.recovery.backupStateFlagObserved, true);
  assert.equal(runtime.recovery.cloudSyncProven, false);
  assert.equal(runtime.accountLifecycle.existingSessionAfterDisableStatus, 401);
  assert.equal(runtime.accountLifecycle.newAssertionAfterDisableStatus, 422);
  assert.equal(runtime.accountLifecycle.sessionsRemaining, 0);
  assert.equal(runtime.semantics.virtualBackupFlagsProveCloudSync, false);
  assert.equal(runtime.redaction.credentialIds, 'omitted');
});

