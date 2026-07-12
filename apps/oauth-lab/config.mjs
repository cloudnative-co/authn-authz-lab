const LOOPBACK_HOST = '127.0.0.1';

function port(value, fallback, name) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 65_535) {
    throw new TypeError(`${name} must be a TCP port`);
  }
  return result;
}

export function createLabConfig(options = {}) {
  const asPort = port(options.asPort, 4100, 'asPort');
  const clientPort = port(options.clientPort, 4101, 'clientPort');
  const apiPort = port(options.apiPort, 4102, 'apiPort');
  const issuer = `http://${LOOPBACK_HOST}:${asPort}`;
  const clientOrigin = `http://${LOOPBACK_HOST}:${clientPort}`;
  const apiOrigin = `http://${LOOPBACK_HOST}:${apiPort}`;
  return Object.freeze({
    host: LOOPBACK_HOST,
    asPort,
    clientPort,
    apiPort,
    issuer,
    clientOrigin,
    apiOrigin,
    clientId: 'course-browser-client',
    oauthRedirectUri: `${clientOrigin}/oauth/callback`,
    oidcRedirectUri: `${clientOrigin}/oidc/callback`,
    apiRedirectUri: `${clientOrigin}/api/callback`,
    audience: `${apiOrigin}/projects`,
    supportedScopes: Object.freeze([
      'openid', 'email', 'project:read', 'project:delete', 'profile:read',
    ]),
    resourceId: 'course-resource-api',
    transportContext: 'loopback-http-training-deviation',
    productionRequirement: 'https-required',
  });
}

export const DEFAULT_LAB_CONFIG = createLabConfig();
