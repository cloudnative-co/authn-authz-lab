import { authenticateWithPassword } from './password.js';

export function parseBasicAuthorization(header = '') {
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Basic' || !token) return null;

  const decoded = Buffer.from(token, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;

  return {
    email: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

export function authenticateBasicAuth(store, header) {
  const credentials = parseBasicAuthorization(header);
  if (!credentials) return null;
  return authenticateWithPassword(store, credentials.email, credentials.password);
}
