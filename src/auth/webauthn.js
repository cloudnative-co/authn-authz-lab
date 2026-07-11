import { randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

const CHALLENGE_TTL_MS = 300_000;

// Real WebAuthn (W3C Level 3) relying party. attestation is 'none' — the
// production standard for passkeys (Google/Apple RPs default to none); it is
// not "skipping verification". CBOR/attestation parsing is delegated to
// @simplewebauthn; only display-only decoding lives in webauthnInspect.js.
export class WebAuthnService {
  constructor({ rpID = 'localhost', rpName = 'Mini Project App' } = {}) {
    this.rpID = rpID;
    this.rpName = rpName;
    this.credentials = new Map(); // credentialId -> { userId, credential, deviceType, backedUp }
    this.registrationChallenges = new Map(); // userId -> challenge
    this.authChallenges = new Map(); // challengeId -> { challenge, expiresAt }
  }

  async startRegistration(user) {
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: user.email,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    this.registrationChallenges.set(user.id, options.challenge);
    return options;
  }

  async finishRegistration(user, response, { expectedOrigin }) {
    const expectedChallenge = this.registrationChallenges.get(user.id);
    if (!expectedChallenge) return { verified: false };
    this.registrationChallenges.delete(user.id);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: this.rpID,
      });
    } catch {
      // A mismatched challenge/origin/RP ID makes the verifier throw; treat it
      // as a failed (not crashed) registration.
      return { verified: false };
    }
    if (!verification.verified) return { verified: false };

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    this.credentials.set(credential.id, {
      userId: user.id,
      credential,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    });
    return { verified: true, credentialId: credential.id };
  }

  async startAuthentication({ now = Date.now() } = {}) {
    // No allowCredentials => the client asks the authenticator for a
    // discoverable (resident) credential: this is passwordless login.
    const options = await generateAuthenticationOptions({ rpID: this.rpID, userVerification: 'preferred' });
    const challengeId = randomUUID();
    this.authChallenges.set(challengeId, { challenge: options.challenge, expiresAt: now + CHALLENGE_TTL_MS });
    return { options, challengeId };
  }

  async finishAuthentication(challengeId, response, { expectedOrigin, now = Date.now() }) {
    const pending = challengeId ? this.authChallenges.get(challengeId) : undefined;
    if (!pending || pending.expiresAt <= now) return { verified: false };
    this.authChallenges.delete(challengeId);

    const stored = this.credentials.get(response.id);
    if (!stored) return { verified: false };

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin,
        expectedRPID: this.rpID,
        credential: stored.credential,
      });
    } catch {
      // A tampered challenge/origin or a bad signature makes the verifier throw;
      // treat it as a failed (not crashed) authentication.
      return { verified: false };
    }
    if (!verification.verified) return { verified: false };

    // Persist the authenticator's monotonic signature counter (clone detection).
    stored.credential.counter = verification.authenticationInfo.newCounter;
    return { verified: true, userId: stored.userId, signCount: verification.authenticationInfo.newCounter };
  }
}
