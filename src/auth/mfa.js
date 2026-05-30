import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from './password.js';

export class MfaStore {
  constructor({ now = () => Date.now(), codeGenerator = () => String(Math.floor(100000 + Math.random() * 900000)) } = {}) {
    this.now = now;
    this.codeGenerator = codeGenerator;
    this.factors = new Map();
    this.challenges = new Map();
  }

  enrollCodeFactor({ userId, factorId, label }) {
    this.factors.set(factorId, { factorId, userId, label, type: 'verification_code' });
    return this.factors.get(factorId);
  }

  startChallenge(userId, factorId, ttlMs = 300_000) {
    const factor = this.factors.get(factorId);
    if (!factor || factor.userId !== userId) return null;

    const challenge = {
      challengeId: randomUUID(),
      userId,
      factorId,
      code: this.codeGenerator(),
      expiresAt: this.now() + ttlMs,
      used: false,
    };
    this.challenges.set(challenge.challengeId, challenge);
    return challenge;
  }

  verifyChallenge({ challengeId, code }) {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.used || challenge.expiresAt < this.now()) return false;
    if (challenge.code !== code) return false;

    challenge.used = true;
    return true;
  }
}

export function createDevicePinFactor({ userId, deviceId, pin }) {
  return {
    type: 'device_pin',
    userId,
    deviceId,
    pinHash: hashPassword(pin),
  };
}

export function verifyDevicePin(factor, { userId, deviceId, pin }) {
  return (
    factor.type === 'device_pin' &&
    factor.userId === userId &&
    factor.deviceId === deviceId &&
    verifyPassword(pin, factor.pinHash)
  );
}
