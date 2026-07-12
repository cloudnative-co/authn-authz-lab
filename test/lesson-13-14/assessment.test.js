import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateLesson13Submission, lesson13AnswerKey } from '../../course/lessons/13/assessment.mjs';
import { evaluateLesson14Submission, lesson14AnswerKey } from '../../course/lessons/14/assessment.mjs';

const REDACTION = Object.freeze(Object.fromEntries([
  'passwords', 'sessionTokens', 'csrfTokens', 'challenges', 'userHandles', 'credentialIds',
  'publicKeys', 'attestationObjects', 'assertions', 'signatures', 'fullCounters',
].map((field) => [field, 'omitted'])));

function lesson13Runtime() {
  return {
    schemaVersion: 1,
    lessonId: '13',
    runtimeEvidence: true,
    browserAPI: {
      registration: 'navigator.credentials.create',
      authentication: 'navigator.credentials.get',
      registrationClientDataType: 'webauthn.create',
      authenticationClientDataType: 'webauthn.get',
    },
    registration: {
      invalidChallengeStatus: 422,
      rpCredentialCountAfterRejectedCeremony: 0,
      validStatus: 201,
      rpCredentialCountAfterValidCeremony: 1,
      attestationFormat: 'none',
      deviceAttestationSignatureExpected: false,
    },
    authentication: {
      mode: 'username-bound',
      allowCredentialsCount: 1,
      successStatus: 200,
      sessionStatus: 200,
      signatureVerifiedByRP: true,
      userVerificationRequired: true,
    },
    negative: {
      challengeStatus: 422,
      originStatus: 422,
      rpIdBoundary: 'browser-rejected-before-assertion',
      signatureStatus: 422,
      replayStatus: 422,
      userHandleStatus: 422,
      genericExternalFailure: true,
    },
    userHandle: {
      byteLength: 64,
      generation: 'cryptographically-random-per-account',
      containsPII: false,
    },
    semantics: {
      signCount: 'risk-signal-not-clone-proof',
      authenticationSignature: 'verified-with-registered-public-key',
      registrationAttestationSignature: 'none-format-has-no-device-attestation-signature',
    },
    virtualAuthenticatorLimitations: [
      'not-hardware-authenticator-proof',
      'not-real-user-gesture-proof',
    ],
    redaction: REDACTION,
    rawCredentialsOmitted: true,
  };
}

function lesson14Runtime() {
  return {
    schemaVersion: 1,
    lessonId: '14',
    runtimeEvidence: true,
    browserAPI: {
      registration: 'navigator.credentials.create',
      authentication: 'navigator.credentials.get',
    },
    discoverableLogin: {
      allowCredentialsOmitted: true,
      usernameSupplied: false,
      authenticationStatus: 200,
      sessionStatus: 200,
      returnedUserHandleVerified: true,
    },
    revocation: {
      rpStatus: 200,
      privateCredentialRemovedByRP: false,
      authenticatorCredentialCountBefore: 1,
      authenticatorCredentialCountAfter: 1,
      revokedAssertionStatus: 422,
    },
    recovery: {
      secondCredentialRegistered: true,
      authenticationStatus: 200,
      sessionStatus: 200,
      deviceType: 'multiDevice',
      backupEligibleFlagObserved: true,
      backupStateFlagObserved: true,
      cloudSyncProven: false,
    },
    accountLifecycle: {
      disableStatus: 200,
      existingSessionAfterDisableStatus: 401,
      newAssertionAfterDisableStatus: 422,
      sessionsRemaining: 0,
    },
    semantics: {
      signCount: 'risk-signal-not-clone-proof',
      virtualBackupFlagsProveCloudSync: false,
    },
    virtualAuthenticatorLimitations: ['backup-flags-do-not-prove-cloud-sync'],
    redaction: REDACTION,
    rawCredentialsOmitted: true,
  };
}

test('Lesson 13 answer key passes only with all browser and interpretation checks', () => {
  assert.equal(evaluateLesson13Submission(lesson13AnswerKey(), lesson13Runtime()).status, 'pass');
  const misconception = lesson13AnswerKey();
  misconception.answers['AA13-C3'].signCount = 'definitive-proof-of-cloning';
  const result = evaluateLesson13Submission(misconception, lesson13Runtime());
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.checks.filter(({ passed }) => !passed).map(({ checkId }) => checkId), ['AA13-C3']);
});

test('Lesson 14 answer key rejects cloud-sync and remote-private-key misconceptions', () => {
  assert.equal(evaluateLesson14Submission(lesson14AnswerKey(), lesson14Runtime()).status, 'pass');
  const misconception = lesson14AnswerKey();
  misconception.answers['AA14-C1'].rpRevocation = 'rp-deletes-private-key-from-every-authenticator';
  misconception.answers['AA14-C2'].cloudSyncEvidence = 'cdp-backup-flags-prove-end-to-end-cloud-sync';
  const result = evaluateLesson14Submission(misconception, lesson14Runtime());
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.checks.filter(({ passed }) => !passed).map(({ checkId }) => checkId), [
    'AA14-C1',
    'AA14-C2',
  ]);
});

