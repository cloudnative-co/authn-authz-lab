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

export function issueIdToken(profile, secret, now = Date.now()) {
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    iss: 'https://idp.example.test/oidc',
    aud: 'mini-project-app',
    sub: profile.subject,
    email: profile.email,
    groups: profile.groups,
    exp: Math.floor((now + 300_000) / 1000),
  });
  const body = `${header}.${payload}`;
  return `${body}.${signature(secret, body)}`;
}

export function verifyIdToken(idToken, secret, now = Date.now()) {
  const [header, payload, actual] = idToken.split('.');
  if (!header || !payload || !actual) return null;
  const body = `${header}.${payload}`;
  const expected = signature(secret, body);
  if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return null;

  const claims = decodeJson(payload);
  if (claims.aud !== 'mini-project-app' || claims.exp <= Math.floor(now / 1000)) return null;
  return claims;
}
