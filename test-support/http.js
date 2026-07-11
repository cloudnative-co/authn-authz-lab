import { createHash, randomBytes } from 'node:crypto';
import { base64UrlDecode } from '../src/auth/jwt.js';
import { createApp } from '../src/server.js';

export const WEB_APP_REDIRECT_URI = 'http://localhost:4000/callback';

export async function startTestServer() {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  // Configure the issuer once the ephemeral port is known (static, not derived
  // from request Host).
  server.setIssuer(baseUrl);
  return { server, baseUrl };
}

export function form(fields) {
  return new URLSearchParams(fields).toString();
}

export function decodeJwtPart(token, index) {
  return JSON.parse(base64UrlDecode(token.split('.')[index]).toString('utf8'));
}

export async function login(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export async function authorizeForCode(baseUrl, cookie, { challenge, scope, state, nonce }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'web-app',
    redirect_uri: WEB_APP_REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope,
  });
  if (state !== undefined) params.set('state', state);
  if (nonce !== undefined) params.set('nonce', nonce);
  return fetch(`${baseUrl}/oauth/authorize?${params}`, { headers: { cookie }, redirect: 'manual' });
}

export async function codeFromAuthorize(baseUrl, cookie, options) {
  const res = await authorizeForCode(baseUrl, cookie, options);
  if (res.status !== 302) throw new Error(`authorize did not redirect: ${res.status}`);
  return new URL(res.headers.get('location')).searchParams.get('code');
}

export async function exchangeAuthorizationCode(baseUrl, { code, verifier }) {
  return fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'authorization_code',
      code,
      redirect_uri: WEB_APP_REDIRECT_URI,
      client_id: 'web-app',
      client_secret: 'web-app-secret',
      code_verifier: verifier,
    }),
  });
}
