import { createHash, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(value).digest();
}

export class PasskeyStore {
  constructor() {
    this.challenges = new Map();
    this.credentials = new Map();
  }

  startRegistration(userId) {
    const challenge = randomBytes(32).toString('base64url');
    this.challenges.set(`register:${userId}`, challenge);
    return challenge;
  }

  finishRegistration({ userId, credentialId, publicKeyPem, challenge }) {
    const expected = this.challenges.get(`register:${userId}`);
    if (expected !== challenge) return false;
    this.credentials.set(credentialId, { userId, publicKeyPem });
    this.challenges.delete(`register:${userId}`);
    return true;
  }

  startAuthentication(userId) {
    const challenge = randomBytes(32).toString('base64url');
    this.challenges.set(`auth:${userId}`, challenge);
    return challenge;
  }

  finishAuthentication({ userId, credentialId, challenge, signature }) {
    const expected = this.challenges.get(`auth:${userId}`);
    const credential = this.credentials.get(credentialId);
    if (expected !== challenge || credential?.userId !== userId) return false;

    const ok = verify('sha256', digest(challenge), credential.publicKeyPem, signature);
    if (ok) this.challenges.delete(`auth:${userId}`);
    return ok;
  }
}

export function createDemoAuthenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    signChallenge(challenge) {
      return sign('sha256', digest(challenge), privateKey);
    },
  };
}
