import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  CAPSTONE_CHECK_IDS,
  capstoneAnswerKey,
  evaluateCapstoneSubmission,
  validateCapstoneSubmission,
} from '../../course/lessons/capstone/assessment.mjs';
import { runCapstoneScenario } from '../../course/lessons/capstone/scenario.mjs';

async function evaluate(submission) {
  const runtime = await runCapstoneScenario({ submission });
  return { runtime, evaluated: evaluateCapstoneSubmission(submission, runtime) };
}

test('both capstone tracks satisfy all seven checks and hard gates', async () => {
  for (const track of ['developer', 'iam-operations']) {
    const submission = capstoneAnswerKey(track);
    const { runtime, evaluated } = await evaluate(submission);
    assert.equal(evaluated.status, 'pass', track);
    assert.deepEqual(evaluated.checks.map(({ checkId }) => checkId), CAPSTONE_CHECK_IDS);
    assert.equal(evaluated.checks.every(({ passed }) => passed), true);
    assert.equal(runtime.metrics.scorePercent, 100);
    assert.equal(runtime.metrics.criticalSkipCount, 0);
    assert.equal(runtime.metrics.criticalFailureCount, 0);
    assert.equal(runtime.metrics.unresolvedCritical, 0);
  }
});

test('equivalent risk order, priority order, High disposition, and developer key order pass', async () => {
  const submission = capstoneAnswerKey('developer');
  submission.common.risks = [
    submission.common.risks[4],
    submission.common.risks[2],
    submission.common.risks[0],
    submission.common.risks[3],
    submission.common.risks[1],
  ];
  submission.common.risks
    .filter(({ severity }) => severity === 'high')
    .forEach((risk) => { risk.disposition = 'resolved'; });
  submission.common.priorityOrder = [
    'R-API-OBJECT',
    'R-LEAVER-ACCESS',
    'R-FEDERATION-SEMANTICS',
    'R-SHARED-ADMIN',
    'R-RECOVERY',
  ];
  submission.artifacts.developer = {
    negativeTests: {
      weakRecovery: 'run',
      leaverSession: 'run',
      crossTenant: 'run',
      samlReplay: 'run',
      invalidToken: 'run',
    },
    apiPolicy: 'token-scope-tenant-object',
    federationAdapter: 'strict-sp-initiated-acs',
    sessionRevocationHook: 'disable-event-revokes-local-sessions',
    policyMode: 'deny-by-default',
  };

  const { runtime, evaluated } = await evaluate(submission);
  assert.equal(runtime.controls.c6, true);
  assert.equal(runtime.controls.c7, true);
  assert.equal(evaluated.status, 'pass');
});

test('IAM runbooks accept safe partial-order alternatives', async () => {
  const submission = capstoneAnswerKey('iam-operations');
  submission.artifacts.iamOperations.jmlRunbook = [
    'validate-authoritative-event',
    'revoke-stale-sessions-and-tokens',
    'apply-directory-change',
    'recalculate-access',
    'verify-deny-or-required-access',
    'record-redacted-evidence',
  ];
  submission.artifacts.iamOperations.emergencyRunbook = [
    'block-federation-access',
    'revoke-authenticators',
    'disable-account',
    'revoke-sessions-and-tokens',
    'verify-deny',
    'preserve-redacted-audit',
  ];
  submission.artifacts.iamOperations.recoveryRunbook = [
    'verify-identity-with-strong-channel',
    'revoke-active-sessions',
    'revoke-lost-authenticator',
    'enroll-replacement',
    'notify-and-monitor',
  ];

  const { runtime, evaluated } = await evaluate(submission);
  assert.equal(runtime.controls.c7, true);
  assert.equal(evaluated.status, 'pass');
});

test('IAM runbooks fail when a dependency is reversed or a dangerous step is selected', async () => {
  const unsafeRunbooks = [
    {
      name: 'jml applies change before validating the source event',
      field: 'jmlRunbook',
      value: [
        'apply-directory-change',
        'validate-authoritative-event',
        'recalculate-access',
        'revoke-stale-sessions-and-tokens',
        'verify-deny-or-required-access',
        'record-redacted-evidence',
      ],
    },
    {
      name: 'emergency verifies deny before containment completes',
      field: 'emergencyRunbook',
      value: [
        'disable-account',
        'verify-deny',
        'revoke-sessions-and-tokens',
        'revoke-authenticators',
        'block-federation-access',
        'preserve-redacted-audit',
      ],
    },
    {
      name: 'recovery enrolls before revoking the lost authenticator',
      field: 'recoveryRunbook',
      value: [
        'verify-identity-with-strong-channel',
        'enroll-replacement',
        'revoke-lost-authenticator',
        'revoke-active-sessions',
        'notify-and-monitor',
      ],
    },
    {
      name: 'emergency waits for root cause instead of containing access',
      field: 'emergencyRunbook',
      value: [
        'wait-for-root-cause-before-revocation',
        'revoke-sessions-and-tokens',
        'revoke-authenticators',
        'block-federation-access',
        'verify-deny',
        'preserve-redacted-audit',
      ],
    },
    {
      name: 'jml provisions without an authoritative source event',
      field: 'jmlRunbook',
      value: [
        'provision-without-source-event',
        'apply-directory-change',
        'recalculate-access',
        'revoke-stale-sessions-and-tokens',
        'verify-deny-or-required-access',
        'record-redacted-evidence',
      ],
    },
    {
      name: 'jml retains stale access',
      field: 'jmlRunbook',
      value: [
        'validate-authoritative-event',
        'apply-directory-change',
        'recalculate-access',
        'retain-old-access',
        'verify-deny-or-required-access',
        'record-redacted-evidence',
      ],
    },
    {
      name: 'recovery relies on a knowledge question',
      field: 'recoveryRunbook',
      value: [
        'knowledge-question-only',
        'revoke-lost-authenticator',
        'enroll-replacement',
        'revoke-active-sessions',
        'notify-and-monitor',
      ],
    },
  ];

  for (const { name, field, value } of unsafeRunbooks) {
    const submission = capstoneAnswerKey('iam-operations');
    submission.artifacts.iamOperations[field] = value;
    assert.doesNotThrow(() => validateCapstoneSubmission(submission), name);
    const { runtime, evaluated } = await evaluate(submission);
    assert.equal(runtime.controls.c7, false, name);
    assert.equal(evaluated.status, 'fail', name);
  }
});

test('duplicate IAM steps and duplicate risks are rejected before simulation', () => {
  const duplicateStep = capstoneAnswerKey('iam-operations');
  duplicateStep.artifacts.iamOperations.emergencyRunbook[1] = 'disable-account';
  assert.throws(
    () => validateCapstoneSubmission(duplicateStep),
    ({ reasonCode }) => reasonCode === 'SUBMISSION_VALUE_INVALID',
  );

  const duplicateRisk = capstoneAnswerKey('developer');
  duplicateRisk.common.risks[1] = structuredClone(duplicateRisk.common.risks[0]);
  assert.throws(
    () => validateCapstoneSubmission(duplicateRisk),
    ({ reasonCode }) => reasonCode === 'SUBMISSION_VALUE_INVALID',
  );
});

test('priority order fails when a High risk precedes any Critical risk', async () => {
  const submission = capstoneAnswerKey('developer');
  submission.common.priorityOrder = [
    'R-RECOVERY',
    'R-LEAVER-ACCESS',
    'R-FEDERATION-SEMANTICS',
    'R-API-OBJECT',
    'R-SHARED-ADMIN',
  ];
  const { runtime, evaluated } = await evaluate(submission);
  assert.equal(runtime.controls.c6, false);
  assert.equal(evaluated.status, 'fail');
});

test('80 percent alone cannot hide a missing critical federation control', async () => {
  const submission = capstoneAnswerKey('developer');
  submission.common.federation.replay = 'accept-until-expiry';
  const { runtime, evaluated } = await evaluate(submission);
  assert.equal(runtime.metrics.scorePercent, 86);
  assert.equal(runtime.metrics.criticalFailureCount, 1);
  assert.equal(evaluated.status, 'fail');
  assert.equal(evaluated.checks.find(({ checkId }) => checkId === 'AA-CAP-C3').passed, false);
  assert.equal(evaluated.checks.find(({ checkId }) => checkId === 'AA-CAP-C7').passed, false);
});

test('skipping one critical rejection fails the track artifact and global gate', async () => {
  const submission = capstoneAnswerKey('developer');
  submission.artifacts.developer.negativeTests.samlReplay = 'skip';
  const { runtime, evaluated } = await evaluate(submission);
  assert.equal(runtime.metrics.criticalSkipCount, 1);
  assert.equal(runtime.criticalRejections.find(({ id }) => id === 'CAP-NEG-SAML-REPLAY').skipped, true);
  assert.equal(evaluated.status, 'fail');
  assert.equal(evaluated.checks.find(({ checkId }) => checkId === 'AA-CAP-C7').passed, false);
});

test('an unresolved Critical risk fails even when the related control is otherwise present', async () => {
  const submission = capstoneAnswerKey('iam-operations');
  submission.common.risks[0].disposition = 'unresolved';
  const { runtime, evaluated } = await evaluate(submission);
  assert.equal(runtime.metrics.unresolvedCritical, 1);
  assert.equal(evaluated.status, 'fail');
  assert.equal(evaluated.checks.find(({ checkId }) => checkId === 'AA-CAP-C6').passed, false);
  assert.equal(evaluated.checks.find(({ checkId }) => checkId === 'AA-CAP-C7').passed, false);
});

test('capstone submission schema rejects TODO, mixed tracks, and unknown fields', async () => {
  const template = JSON.parse(await readFile(
    new URL('../../course/lessons/capstone/workspace-template.json', import.meta.url),
    'utf8',
  ));
  assert.throws(() => validateCapstoneSubmission(template), /not allowed/u);
  const mixed = capstoneAnswerKey('developer');
  mixed.artifacts.iamOperations = capstoneAnswerKey('iam-operations').artifacts.iamOperations;
  assert.throws(() => validateCapstoneSubmission(mixed), /not-selected/u);
  assert.throws(
    () => validateCapstoneSubmission({ ...capstoneAnswerKey('developer'), extra: true }),
    /unknown fields/u,
  );
});
