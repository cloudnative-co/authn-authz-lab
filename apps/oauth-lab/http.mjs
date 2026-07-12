const MAX_FORM_BYTES = 16 * 1024;

export class LabHttpError extends TypeError {
  constructor(status, reasonCode, message) {
    super(message);
    this.name = 'LabHttpError';
    this.status = status;
    this.reasonCode = reasonCode;
  }
}

async function readBody(request) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_FORM_BYTES) {
    throw new LabHttpError(413, 'BODY_TOO_LARGE', 'request body is too large');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_FORM_BYTES) throw new LabHttpError(413, 'BODY_TOO_LARGE', 'request body is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readForm(request) {
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/iu.test(
    request.headers['content-type'] ?? '',
  )) {
    throw new LabHttpError(400, 'FORM_CONTENT_TYPE_REQUIRED', 'form content type is required');
  }
  return new URLSearchParams(await readBody(request));
}

function baseHeaders(response) {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('pragma', 'no-cache');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
}

export function sendJson(response, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  response.statusCode = status;
  baseHeaders(response);
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('content-length', payload.length);
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(payload);
}

export function sendHtml(response, status, html, headers = {}) {
  const payload = Buffer.from(html);
  response.statusCode = status;
  baseHeaders(response);
  response.setHeader('content-security-policy', "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.setHeader('content-length', payload.length);
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(payload);
}

export function redirect(response, location, headers = {}) {
  response.statusCode = 302;
  baseHeaders(response);
  response.setHeader('location', location);
  response.setHeader('content-length', '0');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end();
}

export function cookie(request, name) {
  const header = request.headers.cookie;
  if (typeof header !== 'string' || header.length > 4096) return null;
  const matches = [];
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    if (item.slice(0, separator).trim() === name) matches.push(item.slice(separator + 1).trim());
  }
  if (matches.length !== 1 || !/^[A-Za-z0-9_-]{1,256}$/u.test(matches[0])) return null;
  return matches[0];
}

export function setCookie(name, value, { maxAge = 600, sameSite = 'Lax' } = {}) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}`;
}

export function requestUrl(request, configuredOrigin) {
  if (request.headers.host !== new URL(configuredOrigin).host) {
    throw new LabHttpError(421, 'HOST_INVALID', 'request authority is not configured');
  }
  return new URL(request.url, configuredOrigin);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function exactSingle(params, name) {
  const values = params.getAll(name);
  return values.length === 1 && values[0] !== '' ? values[0] : null;
}
