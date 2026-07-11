import { createHmac, timingSafeEqual } from 'node:crypto';

function signature(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

export function issueSamlAssertion(profile, secret, now = Date.now()) {
  const payload = encodeJson({
    issuer: 'https://idp.example.test/saml',
    audience: 'mini-project-app',
    subject: profile.subject,
    email: profile.email,
    groups: profile.groups,
    expiresAt: now + 300_000,
  });
  return `${payload}.${signature(secret, payload)}`;
}

export function verifySamlAssertion(assertion, secret, now = Date.now()) {
  const [payload, actual] = assertion.split('.');
  if (!payload || !actual) return null;
  const expected = signature(secret, payload);
  if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return null;

  const profile = decodeJson(payload);
  if (profile.audience !== 'mini-project-app' || profile.expiresAt <= now) return null;
  return profile;
}

// The OIDC ID Token helpers that used to live here were replaced by the
// RFC-compliant RS256 implementation in oidc.js / jwt.js. The SAML helpers
// above stay until Phase B swaps them for a real SP + Keycloak IdP.
