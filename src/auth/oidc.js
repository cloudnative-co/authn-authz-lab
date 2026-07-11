import { publicKeyToJwk, signJwt } from './jwt.js';

const ID_TOKEN_TTL_SECONDS = 300;

export function buildDiscoveryDocument(
  issuer,
  {
    scopesSupported = ['openid', 'project:read'],
    grantTypesSupported = ['authorization_code', 'client_credentials'],
  } = {},
) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    jwks_uri: `${issuer}/oauth/jwks`,
    introspection_endpoint: `${issuer}/oauth/introspect`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: scopesSupported,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    grant_types_supported: grantTypesSupported,
    code_challenge_methods_supported: ['S256'],
  };
}

export function buildJwks(keyPair) {
  return { keys: [publicKeyToJwk(keyPair.publicKey, keyPair.kid)] };
}

export function issueIdToken({ user, clientId, nonce, issuer, keyPair, now = Date.now() }) {
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    iss: issuer,
    sub: user.id,
    aud: clientId,
    iat: issuedAt,
    exp: issuedAt + ID_TOKEN_TTL_SECONDS,
    name: user.name,
    email: user.email,
  };
  if (nonce !== undefined && nonce !== null) {
    payload.nonce = nonce;
  }
  return signJwt(payload, keyPair.privateKey, { kid: keyPair.kid, typ: 'JWT' });
}
