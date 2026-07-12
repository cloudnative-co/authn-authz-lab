import { ScenarioClientError, scenarioRequest, withFreshScenario } from '../../runner/scenario-client.mjs';
import {
  authenticatorCredentials,
  browserMethod,
  browserRejectsForeignRPID,
  getAssertionDirect,
  launchWebAuthnBrowser,
  mutateBase64urlByte,
  withAlternateLocalhostPage,
} from '../webauthn/browser-lab.mjs';

const IDENTIFIER = 'alice@example.com';
const PASSWORD = 'alice-password-for-lesson-02';

function expect(condition, message) {
  if (!condition) throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', message);
}

function clientData(response) {
  return JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'));
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

async function registrationOptions(page) {
  const result = await browserMethod(page, 'registrationOptions');
  expect(result.status === 200 && result.body?.options, 'registration options were not issued');
  return result.body;
}

async function authenticationOptions(page) {
  const result = await browserMethod(page, 'authenticationOptions', {
    identifier: IDENTIFIER,
    discoverable: false,
  });
  expect(result.status === 200 && result.body?.options, 'authentication options were not issued');
  return result.body;
}

export async function runLesson13Scenario({ origin, signal } = {}) {
  return withFreshScenario({ origin, lessonId: '13', signal }, async (scenarioId) => {
    const browserLab = await launchWebAuthnBrowser({ runtimeOrigin: origin, signal });
    try {
      const authenticator = await browserLab.newAuthenticator({ lessonId: '13', scenarioId });
      const { page } = authenticator;
      await passwordLogin(page);

      const beforeInvalid = await authenticatorCredentials(authenticator);
      const invalidRegistrationOptions = await registrationOptions(page);
      const invalidOptions = {
        ...invalidRegistrationOptions.options,
        challenge: mutateBase64urlByte(invalidRegistrationOptions.options.challenge),
      };
      const invalidCredential = await browserMethod(page, 'createCredential', invalidOptions);
      const invalidRegistration = await browserMethod(
        page,
        'finishRegistration',
        invalidRegistrationOptions.transactionId,
        invalidCredential,
      );
      expect(genericFailure(invalidRegistration), 'invalid registration challenge was accepted or disclosed');
      const afterInvalid = await authenticatorCredentials(authenticator);
      const afterInvalidObservation = await scenarioRequest(
        origin,
        '/__course/lessons/13/observe',
        { scenarioId, signal },
      );
      expect(
        afterInvalidObservation.body?.state?.credentialCount === 0,
        'RP stored a credential after failed registration verification',
      );

      const validRegistrationOptions = await registrationOptions(page);
      const validCredential = await browserMethod(
        page,
        'createCredential',
        validRegistrationOptions.options,
      );
      const registrationClientData = clientData(validCredential);
      const validRegistration = await browserMethod(
        page,
        'finishRegistration',
        validRegistrationOptions.transactionId,
        validCredential,
      );
      expect(
        validRegistration.status === 201
          && validRegistration.body?.code === 'CREDENTIAL_REGISTERED',
        'valid WebAuthn registration failed',
      );
      const afterValid = await authenticatorCredentials(authenticator);

      const successOptions = await authenticationOptions(page);
      expect(
        successOptions.options.allowCredentials?.length === 1,
        'username-bound authentication did not bind an active credential',
      );
      const successAssertion = await browserMethod(page, 'getAssertion', successOptions.options);
      const authenticationClientData = clientData(successAssertion);
      const success = await browserMethod(
        page,
        'finishAuthentication',
        successOptions.transactionId,
        successAssertion,
      );
      expect(
        success.status === 200
          && success.body?.code === 'WEBAUTHN_AUTHENTICATED'
          && success.body?.mode === 'username-bound',
        'valid username-bound assertion failed',
      );
      const me = await browserMethod(page, 'me');
      expect(me.status === 200 && me.body?.user?.identifier === IDENTIFIER, 'session was not issued');

      const replay = await browserMethod(
        page,
        'finishAuthentication',
        successOptions.transactionId,
        successAssertion,
      );
      expect(genericFailure(replay), 'authentication transaction replay was accepted or disclosed');

      const challengeOptions = await authenticationOptions(page);
      const wrongChallengeAssertion = await browserMethod(page, 'getAssertion', {
        ...challengeOptions.options,
        challenge: mutateBase64urlByte(challengeOptions.options.challenge),
      });
      const challengeRejected = await browserMethod(
        page,
        'finishAuthentication',
        challengeOptions.transactionId,
        wrongChallengeAssertion,
      );
      expect(genericFailure(challengeRejected), 'challenge mismatch was accepted or disclosed');

      const signatureOptions = await authenticationOptions(page);
      const badSignatureAssertion = await browserMethod(page, 'getAssertion', signatureOptions.options);
      badSignatureAssertion.response.signature = mutateBase64urlByte(
        badSignatureAssertion.response.signature,
      );
      const signatureRejected = await browserMethod(
        page,
        'finishAuthentication',
        signatureOptions.transactionId,
        badSignatureAssertion,
      );
      expect(genericFailure(signatureRejected), 'signature mutation was accepted or disclosed');

      const handleOptions = await authenticationOptions(page);
      const badHandleAssertion = await browserMethod(page, 'getAssertion', handleOptions.options);
      badHandleAssertion.response.userHandle = mutateBase64urlByte(
        badHandleAssertion.response.userHandle,
      );
      const userHandleRejected = await browserMethod(
        page,
        'finishAuthentication',
        handleOptions.transactionId,
        badHandleAssertion,
      );
      expect(genericFailure(userHandleRejected), 'userHandle mismatch was accepted or disclosed');

      const rpIdOptions = await authenticationOptions(page);
      const rpIdBoundary = await browserRejectsForeignRPID(page, rpIdOptions.options);
      expect(rpIdBoundary.rejected, 'browser accepted an invalid RP ID for the localhost origin');
      await scenarioRequest(origin, '/api/lessons/13/authentication/verify', {
        method: 'POST',
        scenarioId,
        json: { transactionId: rpIdOptions.transactionId, response: {} },
        signal,
      });

      const originOptions = await authenticationOptions(page);
      const alternateOriginAssertion = await withAlternateLocalhostPage(
        page,
        () => getAssertionDirect(page, originOptions.options),
      );
      const alternateClientData = clientData(alternateOriginAssertion);
      expect(
        alternateClientData.origin !== browserLab.origin,
        'alternate-origin fixture did not change clientData.origin',
      );
      const originRejected = await scenarioRequest(
        origin,
        '/api/lessons/13/authentication/verify',
        {
          method: 'POST',
          scenarioId,
          json: {
            transactionId: originOptions.transactionId,
            response: alternateOriginAssertion,
          },
          signal,
        },
      );
      expect(genericFailure(originRejected), 'valid assertion from an untrusted origin was accepted');

      const observed = await scenarioRequest(origin, '/__course/lessons/13/observe', {
        scenarioId,
        signal,
      });
      expect(observed.status === 200 && observed.body?.lessonId === '13', 'observation failed');
      const rejectionReasons = observed.body.state.events
        .filter(({ type }) => type.endsWith('-rejected'))
        .map(({ reason }) => reason)
        .filter(Boolean);
      for (const reason of [
        'CHALLENGE_MISMATCH',
        'SIGNATURE_INVALID',
        'USER_HANDLE_MISMATCH',
        'ORIGIN_MISMATCH',
        'TRANSACTION_REPLAY_OR_EXPIRED',
      ]) expect(rejectionReasons.includes(reason), `${reason} was not observed`);

      return {
        schemaVersion: 1,
        lessonId: '13',
        evidenceBasis: 'playwright-chromium-cdp-virtual-webauthn-and-project-app-rp',
        runtimeEvidence: true,
        browserAPI: {
          registration: 'navigator.credentials.create',
          authentication: 'navigator.credentials.get',
          registrationClientDataType: registrationClientData.type,
          authenticationClientDataType: authenticationClientData.type,
          trustedOrigin: browserLab.origin,
        },
        registration: {
          invalidChallengeStatus: invalidRegistration.status,
          authenticatorCredentialCountBefore: beforeInvalid.length,
          authenticatorCredentialCountAfterRejectedCeremony: afterInvalid.length,
          rpCredentialCountAfterRejectedCeremony: afterInvalidObservation.body.state.credentialCount,
          validStatus: validRegistration.status,
          authenticatorCredentialCountAfterValidCeremony: afterValid.length,
          rpCredentialCountAfterValidCeremony: observed.body.state.credentialCount,
          attestationFormat: 'none',
          deviceAttestationSignatureExpected: false,
        },
        authentication: {
          mode: success.body.mode,
          allowCredentialsCount: successOptions.options.allowCredentials.length,
          successStatus: success.status,
          sessionStatus: me.status,
          signatureVerifiedByRP: true,
          userVerificationRequired: true,
        },
        negative: {
          challengeStatus: challengeRejected.status,
          originStatus: originRejected.status,
          rpIdBoundary: 'browser-rejected-before-assertion',
          rpIdBrowserErrorName: rpIdBoundary.errorName,
          signatureStatus: signatureRejected.status,
          replayStatus: replay.status,
          userHandleStatus: userHandleRejected.status,
          genericExternalFailure: [
            challengeRejected,
            originRejected,
            signatureRejected,
            replay,
            userHandleRejected,
          ].every(genericFailure),
        },
        userHandle: observed.body.account.userHandle,
        semantics: observed.body.semantics,
        implementation: observed.body.implementation,
        redaction: observed.body.redaction,
        eventReasons: rejectionReasons,
        rawCredentialsOmitted: true,
        virtualAuthenticatorLimitations: [
          'not-hardware-authenticator-proof',
          'not-os-authenticator-proof',
          'not-real-user-gesture-proof',
          'not-synced-passkey-proof',
        ],
      };
    } finally {
      await browserLab.close();
    }
  });
}

