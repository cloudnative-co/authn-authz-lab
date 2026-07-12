const DEFAULT_MAX_HEADER_BYTES = 12 * 1024;
const BASE64_TOKEN = /^[A-Za-z0-9+/]+={0,2}$/;

function canonicalBase64(value) {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64_TOKEN.test(value)) return false;
  const firstPadding = value.indexOf('=');
  if (firstPadding !== -1 && firstPadding < value.length - 2) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length > 0 && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}

export function parseNegotiateAuthorization(value, { maxHeaderBytes = DEFAULT_MAX_HEADER_BYTES } = {}) {
  if (value === undefined || value === null) {
    return Object.freeze({ kind: 'absent', reason: 'NEGOTIATE_REQUIRED' });
  }
  if (!Number.isSafeInteger(maxHeaderBytes) || maxHeaderBytes < 256) {
    throw new TypeError('maxHeaderBytes must be an integer of at least 256');
  }
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxHeaderBytes) {
    return Object.freeze({ kind: 'invalid', reason: 'NEGOTIATE_HEADER_INVALID' });
  }

  const match = /^Negotiate[ \t]+([^ \t]+)$/i.exec(value);
  if (!match || !canonicalBase64(match[1])) {
    return Object.freeze({ kind: 'invalid', reason: 'NEGOTIATE_HEADER_INVALID' });
  }
  return Object.freeze({ kind: 'token', token: match[1] });
}

export function formatNegotiateChallenge(token) {
  if (token === undefined || token === null || token === '') return 'Negotiate';
  const parsed = parseNegotiateAuthorization(`Negotiate ${token}`);
  if (parsed.kind !== 'token') throw new TypeError('server token must be canonical Base64');
  return `Negotiate ${token}`;
}

export const negotiateHeaderLimits = Object.freeze({
  maxHeaderBytes: DEFAULT_MAX_HEADER_BYTES,
  tokenEncoding: 'canonical-base64',
});

