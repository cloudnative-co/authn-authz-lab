import { normalizePasswordForKdf } from './scrypt-password.mjs';

export const LESSON_02_PASSWORD_POLICY = Object.freeze({
  minimumCodePoints: 15,
  maximumCodePoints: 128,
});

export function assessPasswordPolicy(password, policy = LESSON_02_PASSWORD_POLICY) {
  const normalized = normalizePasswordForKdf(password);
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new TypeError('policy must be an object');
  }
  const { minimumCodePoints, maximumCodePoints } = policy;
  if (
    !Number.isSafeInteger(minimumCodePoints)
    || !Number.isSafeInteger(maximumCodePoints)
    || minimumCodePoints < 1
    || maximumCodePoints < minimumCodePoints
  ) {
    throw new TypeError('policy length bounds are invalid');
  }
  const codePoints = [...normalized].length;
  const reasons = [];
  if (codePoints < minimumCodePoints) reasons.push('too-short');
  if (codePoints > maximumCodePoints) reasons.push('too-long');
  return Object.freeze({ accepted: reasons.length === 0, codePoints, reasons: Object.freeze(reasons) });
}
