import { parseSessionToken } from './session-token.mjs';

export const DEFAULT_SESSION_COOKIE_NAME = 'course_session';

const COOKIE_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const COOKIE_VALUE_PATTERN = /^[\x21-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;
const MAX_COOKIE_HEADER_BYTES = 4096;
const MAX_COOKIE_AGE_SECONDS = 31_536_000;

export class SessionCookieError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'SessionCookieError';
    this.code = 'SESSION_COOKIE_INVALID';
  }
}

function validateCookieName(name) {
  if (typeof name !== 'string' || !COOKIE_NAME_PATTERN.test(name)) {
    throw new SessionCookieError('cookie name is invalid');
  }
  return name;
}

function rejectDomainOption(options) {
  if (Object.hasOwn(options, 'domain') || Object.hasOwn(options, 'Domain')) {
    throw new SessionCookieError('Domain is not supported for the host-only session cookie');
  }
}

function validateSecure(secure) {
  if (typeof secure !== 'boolean') {
    throw new SessionCookieError('secure must be a boolean');
  }
  return secure;
}

function validateMaxAge(maxAgeSeconds) {
  if (
    !Number.isSafeInteger(maxAgeSeconds)
    || maxAgeSeconds < 0
    || maxAgeSeconds > MAX_COOKIE_AGE_SECONDS
  ) {
    throw new SessionCookieError('maxAgeSeconds is outside the supported range');
  }
  return maxAgeSeconds;
}

function attributes({ secure, maxAgeSeconds }) {
  const values = [
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${validateMaxAge(maxAgeSeconds)}`,
  ];
  if (validateSecure(secure)) values.push('Secure');
  return values.join('; ');
}

function rejectHeaderControls(value) {
  if (/[\r\n]/u.test(value)) {
    throw new SessionCookieError('cookie input must not contain CR or LF');
  }
  if (/[^\x20-\x7e]/u.test(value)) {
    throw new SessionCookieError('cookie input must contain printable ASCII only');
  }
}

function parseCookiePairs(header) {
  if (typeof header !== 'string') {
    throw new SessionCookieError('Cookie header must be a string');
  }
  if (Buffer.byteLength(header, 'utf8') > MAX_COOKIE_HEADER_BYTES) {
    throw new SessionCookieError('Cookie header is too large');
  }
  rejectHeaderControls(header);
  if (header === '') return new Map();

  const values = new Map();
  for (const rawPair of header.split(';')) {
    const pair = rawPair.replace(/^ +| +$/gu, '');
    const separator = pair.indexOf('=');
    if (pair === '' || separator < 1) {
      throw new SessionCookieError('Cookie header contains an ambiguous pair');
    }
    const name = validateCookieName(pair.slice(0, separator));
    const value = pair.slice(separator + 1);
    if (!COOKIE_VALUE_PATTERN.test(value)) {
      throw new SessionCookieError('Cookie value is invalid or ambiguous');
    }
    if (values.has(name)) {
      throw new SessionCookieError('Cookie header contains a duplicate cookie name');
    }
    values.set(name, value);
  }
  return values;
}

export function parseSessionCookie(header, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new SessionCookieError('options must be an object');
  }
  rejectDomainOption(options);
  const name = validateCookieName(options.name ?? DEFAULT_SESSION_COOKIE_NAME);
  const value = parseCookiePairs(header).get(name);
  if (value === undefined) return null;
  try {
    return parseSessionToken(value);
  } catch {
    throw new SessionCookieError('session cookie value is not a canonical session token');
  }
}

export function serializeSessionCookie(token, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new SessionCookieError('options must be an object');
  }
  rejectDomainOption(options);
  const name = validateCookieName(options.name ?? DEFAULT_SESSION_COOKIE_NAME);
  const value = parseSessionToken(token);
  return `${name}=${value}; ${attributes({
    secure: options.secure ?? true,
    maxAgeSeconds: options.maxAgeSeconds ?? 1800,
  })}`;
}

export function serializeClearedSessionCookie(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new SessionCookieError('options must be an object');
  }
  rejectDomainOption(options);
  const name = validateCookieName(options.name ?? DEFAULT_SESSION_COOKIE_NAME);
  return `${name}=; ${attributes({ secure: options.secure ?? true, maxAgeSeconds: 0 })}`;
}

export function describeSessionCookieConfiguration(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new SessionCookieError('options must be an object');
  }
  rejectDomainOption(options);
  const secure = validateSecure(options.secure ?? true);
  return Object.freeze({
    name: validateCookieName(options.name ?? DEFAULT_SESSION_COOKIE_NAME),
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    domainAttribute: 'omitted',
    secure,
    transportContext: secure ? 'https-required' : 'loopback-http-training-deviation',
    productionPosture: secure ? 'requires-complete-deployment-review' : 'not-approved',
    deviation: secure
      ? null
      : 'Secure is disabled only for the loopback HTTP lesson; deploy behind HTTPS and enable Secure.',
  });
}
