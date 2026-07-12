import { ScenarioClientError, scenarioRequest, withFreshScenario } from '../../runner/scenario-client.mjs';
import {
  authenticatorCredentials,
  browserMethod,
  launchWebAuthnBrowser,
} from '../webauthn/browser-lab.mjs';

const IDENTIFIER = 'alice@example.com';
const PASSWORD = 'alice-password-for-lesson-02';

function expect(condition, message) {
  if (!condition) throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', message);
}

function genericFailure(result) {
  return result.status === 422
    && result.body?.code === 'WEBAUTHN_VERIFICATION_FAILED'
    && !Object.hasOwn(result.body, 'reason');
}

async function passwordLogin(page) {
  const result = await browserMethod(page, 'login', IDENTIFIER, PASSWORD);
  expect(result.status === 200 && result.body?.code === 'PASSWORD_AUTHENTICATED', 'password gate failed');
}

async function register(page) {
  const started = await browserMethod(page, 'registrationOptions');
  expect(started.status === 200 && started.body?.options, 'registration options were not issued');
  const response = await browserMethod(page, 'createCredential', started.body.options);
  const finished = await browserMethod(
    page,
    'finishRegistration',
    started.body.transactionId,
    response,
  );
  expect(finished.status === 201 && finished.body?.credentialReference, 'registration failed');
  return finished.body;
}

async function discoverableAuthentication(page) {
  const started = await browserMethod(page, 'authenticationOptions', {
    identifier: null,
    discoverable: true,
  });
  expect(started.status === 200 && started.body?.options, 'discoverable options were not issued');
  expect(
    !started.body.options.allowCredentials || started.body.options.allowCredentials.length === 0,
    'discoverable authentication unexpectedly constrained allowCredentials',
  );
  const response = await browserMethod(page, 'getAssertion', started.body.options);
  const finished = await browserMethod(
    page,
    'finishAuthentication',
    started.body.transactionId,
    response,
  );
  return { started: started.body, response, finished };
}

export async function runLesson14Scenario({ origin, signal } = {}) {
  return withFreshScenario({ origin, lessonId: '14', signal }, async (scenarioId) => {
    const browserLab = await launchWebAuthnBrowser({ runtimeOrigin: origin, signal });
    try {
      const firstAuthenticator = await browserLab.newAuthenticator({
        lessonId: '14',
        scenarioId,
        backupEligibility: false,
        backupState: false,
      });
      await passwordLogin(firstAuthenticator.page);
      const firstRegistration = await register(firstAuthenticator.page);
      const firstBefore = await authenticatorCredentials(firstAuthenticator);
      expect(firstBefore.length === 1, 'first authenticator did not retain its credential');

      const firstPasswordless = await discoverableAuthentication(firstAuthenticator.page);
      expect(
        firstPasswordless.finished.status === 200
          && firstPasswordless.finished.body?.mode === 'discoverable',
        'username-less authentication failed',
      );
      const firstSession = await browserMethod(firstAuthenticator.page, 'me');
      expect(firstSession.status === 200, 'passwordless authentication did not issue a session');

      const recoveryAuthenticator = await browserLab.newAuthenticator({
        lessonId: '14',
        scenarioId,
        backupEligibility: true,
        backupState: true,
      });
      await passwordLogin(recoveryAuthenticator.page);
      const recoveryRegistration = await register(recoveryAuthenticator.page);
      const recoveryStored = await authenticatorCredentials(recoveryAuthenticator);
      expect(recoveryStored.length === 1, 'recovery authenticator did not retain its credential');
      expect(
        recoveryRegistration.deviceType === 'multiDevice'
          && recoveryRegistration.backedUp === true,
        'BE/BS flags were not observed on the virtual recovery credential',
      );

      const revoked = await browserMethod(
        firstAuthenticator.page,
        'revokeCredential',
        firstRegistration.credentialReference,
      );
      expect(revoked.status === 200 && revoked.body?.code === 'CREDENTIAL_REVOKED', 'RP revocation failed');
      const firstAfterRevocation = await authenticatorCredentials(firstAuthenticator);
      expect(
        firstAfterRevocation.length === firstBefore.length,
        'RP revocation incorrectly removed the authenticator private credential',
      );

      const revokedAssertion = await discoverableAuthentication(firstAuthenticator.page);
      expect(genericFailure(revokedAssertion.finished), 'revoked credential assertion was accepted or disclosed');

      const recovered = await discoverableAuthentication(recoveryAuthenticator.page);
      expect(
        recovered.finished.status === 200
          && recovered.finished.body?.deviceType === 'multiDevice'
          && recovered.finished.body?.backedUp === true,
        'second credential did not recover access',
      );
      const recoverySessionBeforeDisable = await browserMethod(recoveryAuthenticator.page, 'me');
      expect(recoverySessionBeforeDisable.status === 200, 'recovery session was unavailable');

      const beforeDisable = await scenarioRequest(origin, '/__course/lessons/14/observe', {
        scenarioId,
        signal,
      });
      const disabled = await scenarioRequest(origin, '/__course/lessons/14/disable-account', {
        method: 'POST',
        scenarioId,
        json: { accountId: 'user-alice' },
        signal,
      });
      expect(disabled.status === 200 && disabled.body?.changed === true, 'account disable failed');
      const invalidatedSession = await browserMethod(recoveryAuthenticator.page, 'me');
      expect(invalidatedSession.status === 401, 'existing session survived account disable');

      const disabledAssertion = await discoverableAuthentication(recoveryAuthenticator.page);
      expect(genericFailure(disabledAssertion.finished), 'disabled account accepted a new assertion');

      const observed = await scenarioRequest(origin, '/__course/lessons/14/observe', {
        scenarioId,
        signal,
      });
      expect(observed.status === 200 && observed.body?.lessonId === '14', 'observation failed');
      const eventReasons = observed.body.state.events
        .filter(({ type }) => type.endsWith('-rejected'))
        .map(({ reason }) => reason)
        .filter(Boolean);
      expect(eventReasons.includes('CREDENTIAL_UNAVAILABLE'), 'revoked credential rejection was not observed');
      expect(eventReasons.includes('ACCOUNT_DISABLED'), 'disabled account rejection was not observed');

      return {
        schemaVersion: 1,
        lessonId: '14',
        evidenceBasis: 'playwright-chromium-two-cdp-virtual-authenticators-and-project-app-rp',
        runtimeEvidence: true,
        browserAPI: {
          registration: 'navigator.credentials.create',
          authentication: 'navigator.credentials.get',
          trustedOrigin: browserLab.origin,
        },
        discoverableLogin: {
          allowCredentialsOmitted: !firstPasswordless.started.options.allowCredentials
            || firstPasswordless.started.options.allowCredentials.length === 0,
          usernameSupplied: false,
          authenticationStatus: firstPasswordless.finished.status,
          sessionStatus: firstSession.status,
          returnedUserHandleVerified: true,
        },
        revocation: {
          rpStatus: revoked.status,
          rpActiveCredentialsAfter: beforeDisable.body.state.activeCredentialCount,
          authenticatorCredentialCountBefore: firstBefore.length,
          authenticatorCredentialCountAfter: firstAfterRevocation.length,
          privateCredentialRemovedByRP: false,
          revokedAssertionStatus: revokedAssertion.finished.status,
        },
        recovery: {
          secondCredentialRegistered: recoveryRegistration.credentialReference !== undefined,
          authenticationStatus: recovered.finished.status,
          sessionStatus: recoverySessionBeforeDisable.status,
          deviceType: recovered.finished.body.deviceType,
          backupEligibleFlagObserved: recoveryStored[0]?.backupEligibility === true,
          backupStateFlagObserved: recoveryStored[0]?.backupState === true,
          cloudSyncProven: false,
        },
        accountLifecycle: {
          disableStatus: disabled.status,
          existingSessionAfterDisableStatus: invalidatedSession.status,
          newAssertionAfterDisableStatus: disabledAssertion.finished.status,
          sessionsRemaining: observed.body.state.sessionCount,
        },
        userHandle: observed.body.account.userHandle,
        semantics: observed.body.semantics,
        implementation: observed.body.implementation,
        redaction: observed.body.redaction,
        eventReasons,
        rawCredentialsOmitted: true,
        virtualAuthenticatorLimitations: [
          'not-hardware-authenticator-proof',
          'not-os-authenticator-proof',
          'not-real-user-gesture-proof',
          'backup-flags-do-not-prove-cloud-sync',
        ],
      };
    } finally {
      await browserLab.close();
    }
  });
}

