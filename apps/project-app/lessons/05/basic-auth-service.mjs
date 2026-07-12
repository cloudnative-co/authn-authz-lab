const BASIC_CHALLENGE = 'Basic realm="lesson-05", charset="UTF-8"';
const MAX_AUTHORIZATION_BYTES = 4096;
const MAX_USER_ID_BYTES = 254;
const MAX_PASSWORD_BYTES = 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

const CHALLENGED = Object.freeze({
  ok: false,
  status: 401,
  code: 'BASIC_AUTH_REQUIRED',
  message: 'Authentication required.',
  headers: Object.freeze({ 'www-authenticate': BASIC_CHALLENGE }),
});

function decodeCanonicalBase64(token) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(token)
    || token.length === 0
  ) return null;
  const bytes = Buffer.from(token, 'base64');
  if (bytes.toString('base64') !== token) return null;
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

export function parseBasicAuthorization(header) {
  if (
    typeof header !== 'string'
    || Buffer.byteLength(header, 'utf8') > MAX_AUTHORIZATION_BYTES
    || /[\r\n]/u.test(header)
  ) return null;
  const match = /^Basic ([A-Za-z0-9+/=]+)$/iu.exec(header);
  if (!match) return null;
  const userPass = decodeCanonicalBase64(match[1]);
  if (userPass === null || /[\u0000-\u001f\u007f]/u.test(userPass)) return null;
  const separator = userPass.indexOf(':');
  if (separator < 1) return null;
  const userId = userPass.slice(0, separator).normalize('NFC');
  const password = userPass.slice(separator + 1).normalize('NFC');
  if (
    userId.includes(':')
    || Buffer.byteLength(userId, 'utf8') > MAX_USER_ID_BYTES
    || Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES
  ) return null;
  return Object.freeze({ userId, password });
}

function validateAuthenticator(authenticator) {
  const method = typeof authenticator === 'function' ? authenticator : authenticator?.authenticate;
  if (typeof method !== 'function') throw new TypeError('authenticator must be callable');
  return (identifier, password) => method.call(authenticator, identifier, password);
}

function publicTransient(result) {
  const valid = (
    result.status === 429 && result.code === 'RATE_LIMITED'
  ) || (
    result.status === 503 && result.code === 'AUTHENTICATION_CAPACITY_EXCEEDED'
  );
  if (!valid) return null;
  if (!Number.isSafeInteger(result.retryAfterSeconds) || result.retryAfterSeconds < 1) {
    throw new TypeError('authenticator transient failure must include Retry-After');
  }
  return Object.freeze({
    ok: false,
    status: result.status,
    code: result.code,
    message: 'Authentication temporarily unavailable.',
    retryAfterSeconds: result.retryAfterSeconds,
    headers: Object.freeze({ 'retry-after': String(result.retryAfterSeconds) }),
  });
}

export function createLesson05BasicAuthService({ authenticator } = {}) {
  const authenticate = validateAuthenticator(authenticator);
  const counters = { requests: 0, successes: 0, challenges: 0, transientFailures: 0 };

  async function authenticateAuthorization(header) {
    counters.requests += 1;
    const credentials = parseBasicAuthorization(header);
    const result = await authenticate(
      credentials?.userId ?? null,
      credentials?.password ?? 'invalid-basic-credential',
    );
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      throw new TypeError('authenticator returned an invalid result');
    }
    if (result.ok) {
      counters.successes += 1;
      return Object.freeze({
        ok: true,
        status: 200,
        code: 'BASIC_AUTHENTICATED',
        principal: Object.freeze({ id: result.principal.id }),
      });
    }
    const transient = publicTransient(result);
    if (transient) {
      counters.transientFailures += 1;
      return transient;
    }
    counters.challenges += 1;
    return CHALLENGED;
  }

  function observe() {
    return structuredClone({
      schemaVersion: 1,
      lessonId: '05',
      implementation: {
        scheme: 'Basic',
        challenge: BASIC_CHALLENGE,
        credentialEncoding: 'canonical-base64-of-utf8-nfc-user-pass',
        authenticatesEveryRequest: true,
        sessionIssuance: false,
        transportContext: 'loopback-http-training-deviation',
        productionRequirement: 'tls-required',
      },
      counters,
      redaction: {
        authorizationHeader: 'omitted',
        userId: 'omitted',
        password: 'omitted',
        decodedUserPass: 'omitted',
      },
    });
  }

  return Object.freeze({ authenticateAuthorization, observe });
}

export const LESSON_05_BASIC_CHALLENGE = BASIC_CHALLENGE;
