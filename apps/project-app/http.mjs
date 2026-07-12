const MAX_JSON_BODY_BYTES = 32 * 1024;

export class HttpRequestError extends TypeError {
  constructor(reasonCode, message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'HttpRequestError';
    this.reasonCode = reasonCode;
  }
}

export function sendJson(response, statusCode, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  response.statusCode = statusCode;
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('content-length', payload.length);
  response.setHeader('x-content-type-options', 'nosniff');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(payload);
}

export function sendEmpty(response, statusCode, headers = {}) {
  response.statusCode = statusCode;
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-length', '0');
  response.setHeader('x-content-type-options', 'nosniff');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end();
}

export async function readJson(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers['content-type'] ?? '')) {
    throw new HttpRequestError('CONTENT_TYPE_INVALID', 'content-type must be application/json');
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new HttpRequestError('REQUEST_BODY_TOO_LARGE', 'request body is too large');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new HttpRequestError('REQUEST_BODY_TOO_LARGE', 'request body is too large');
    }
    chunks.push(chunk);
  }
  if (size === 0) throw new HttpRequestError('JSON_INVALID', 'request body must contain JSON');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new HttpRequestError('JSON_INVALID', 'request body is not valid JSON', { cause: error });
  }
}

export function requestPath(request) {
  if (typeof request.url !== 'string' || !request.url.startsWith('/')) return null;
  const parsed = new URL(request.url, 'http://course.invalid');
  if (parsed.search || parsed.hash) return null;
  return parsed.pathname;
}

export function sendRequestError(response, error) {
  const statusCode = error.reasonCode === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400;
  sendJson(response, statusCode, {
    error: { code: error.reasonCode ?? 'REQUEST_INVALID', message: error.message },
  });
}
