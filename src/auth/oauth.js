import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function sign(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function includesAll(grantedScopes, requiredScopes) {
  return requiredScopes.every((scope) => grantedScopes.includes(scope));
}

export class AuthorizationServer {
  constructor({ secret = 'dev-oauth-secret' } = {}) {
    this.secret = secret;
    this.codes = new Map();
    this.clients = new Map();
  }

  registerClient(client) {
    this.clients.set(client.clientId, client);
  }

  issueAuthorizationCode({ clientId, userId, redirectUri, scopes }) {
    const client = this.clients.get(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) return null;
    if (!includesAll(client.allowedScopes, scopes)) return null;

    const code = randomBytes(24).toString('base64url');
    this.codes.set(code, { clientId, userId, redirectUri, scopes, used: false });
    return code;
  }

  exchangeCode({ clientId, clientSecret, code, redirectUri }) {
    const client = this.clients.get(clientId);
    const grant = this.codes.get(code);
    if (!client || client.clientSecret !== clientSecret || !grant || grant.used) return null;
    if (grant.clientId !== clientId || grant.redirectUri !== redirectUri) return null;

    grant.used = true;
    return this.issueAccessToken({
      subject: grant.userId,
      clientId,
      scopes: grant.scopes,
      tokenType: 'user_delegated',
    });
  }

  issueClientCredentialsToken({ clientId, clientSecret, scopes }) {
    const client = this.clients.get(clientId);
    if (!client || client.clientSecret !== clientSecret) return null;
    if (!includesAll(client.allowedScopes, scopes)) return null;
    return this.issueAccessToken({ subject: clientId, clientId, scopes, tokenType: 'client' });
  }

  issueAccessToken(payload) {
    const body = encode({ ...payload, expiresAt: Date.now() + 600_000 });
    return `${body}.${sign(this.secret, body)}`;
  }

  introspect(token, requiredScopes = []) {
    const [body, actual] = token.split('.');
    if (!body || !actual) return null;

    const expected = sign(this.secret, body);
    if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return null;

    const payload = decode(body);
    if (payload.expiresAt <= Date.now()) return null;
    if (!includesAll(payload.scopes, requiredScopes)) return null;
    return payload;
  }
}
