import { createHash, randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

const AUTH_CHALLENGE_TTL_MS = 300_000;
const REGISTRATION_CHALLENGE_TTL_MS = 60_000;

// A stable, opaque user handle (WebAuthn user.id) per account. Derived
// deterministically from the account id so the same account always maps to the
// same handle across registrations, without leaking the raw id.
function deriveUserHandle(userId) {
  return createHash('sha256').update(`webauthn-user:${userId}`).digest();
}

// Real WebAuthn (W3C Level 3) relying party. attestation is 'none' — the
// production standard for passkeys (Google/Apple RPs default to none); it is
// not "skipping verification". CBOR/attestation parsing is delegated to
// @simplewebauthn; only display-only decoding lives in webauthnInspect.js.
export class WebAuthnService {
  constructor({ rpID = 'localhost', rpName = 'Mini Project App' } = {}) {
    this.rpID = rpID;
    this.rpName = rpName;
    this.credentials = new Map(); // credentialId -> { userId, credential, deviceType, backedUp }
    this.registrationChallenges = new Map(); // userId -> { challenge, expiresAt }
    this.authChallenges = new Map(); // challengeId -> { challenge, expiresAt }
  }

  async startRegistration(user, { now = Date.now() } = {}) {
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: user.email,
      // Pin a stable opaque user handle so discoverable credentials can resolve
      // back to this account (W3C WebAuthn §5.4.3).
      userID: deriveUserHandle(user.id),
      attestationType: 'none',
      // Passkeys are user-verified in practice; require UV consistently on both
      // the options and the verification side.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    this.registrationChallenges.set(user.id, { challenge: options.challenge, expiresAt: now + REGISTRATION_CHALLENGE_TTL_MS });
    return options;
  }

  async finishRegistration(user, response, { expectedOrigin, now = Date.now() }) {
    const pending = this.registrationChallenges.get(user.id);
    if (!pending || pending.expiresAt <= now) return { verified: false };
    this.registrationChallenges.delete(user.id);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
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
    const options = await generateAuthenticationOptions({ rpID: this.rpID, userVerification: 'required' });
    const challengeId = randomUUID();
    this.authChallenges.set(challengeId, { challenge: options.challenge, expiresAt: now + AUTH_CHALLENGE_TTL_MS });
    return { options, challengeId };
  }

  async finishAuthentication(challengeId, response, { expectedOrigin, now = Date.now() }) {
    const pending = challengeId ? this.authChallenges.get(challengeId) : undefined;
    if (!pending || pending.expiresAt <= now) return { verified: false };
    this.authChallenges.delete(challengeId);

    // Discoverable login: the authenticator returns the user handle it stored at
    // registration. Resolve the account from the credential id, then require the
    // returned user handle to match that account (W3C WebAuthn §5.1.4.1 step 6).
    const userHandle = response.response?.userHandle;
    if (!userHandle) return { verified: false };

    const stored = this.credentials.get(response.id);
    if (!stored) return { verified: false };
    if (deriveUserHandle(stored.userId).toString('base64url') !== userHandle) return { verified: false };

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin,
        expectedRPID: this.rpID,
        credential: stored.credential,
        requireUserVerification: true,
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
