export class HttpInputError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'HttpInputError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new HttpInputError(reasonCode, message);
}

export function uniqueHeader(request, name, { required = false, maxBytes = 2048 } = {}) {
  const values = request.headersDistinct?.[name.toLowerCase()] ?? [];
  if (values.length === 0) {
    if (required) fail('HTTP_HEADER_MISSING', `${name} is required`);
    return null;
  }
  if (values.length !== 1 || typeof values[0] !== 'string'
      || Buffer.byteLength(values[0], 'utf8') > maxBytes) {
    fail('HTTP_HEADER_INVALID', `${name} must appear once and remain bounded`);
  }
  return values[0];
}

export async function readBoundedBody(request, {
  maxBytes = 768 * 1024,
  timeoutMs = 5000,
} = {}) {
  const contentLength = uniqueHeader(request, 'content-length');
  if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)) {
    fail('HTTP_BODY_TOO_LARGE', 'request body exceeds limits');
  }
  let total = 0;
  const chunks = [];
  const timeout = setTimeout(() => request.destroy(new Error('request body timeout')), timeoutMs);
  try {
    for await (const chunk of request) {
      total += chunk.length;
      if (total > maxBytes) fail('HTTP_BODY_TOO_LARGE', 'request body exceeds limits');
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(timeout);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function parseExactForm(raw, requiredNames) {
  if (typeof raw !== 'string') fail('HTTP_FORM_INVALID', 'form body is invalid');
  const parameters = new URLSearchParams(raw);
  const actualNames = [...new Set(parameters.keys())].sort();
  const expectedNames = [...requiredNames].sort();
  if (actualNames.length !== expectedNames.length
      || actualNames.some((name, index) => name !== expectedNames[index])) {
    fail('HTTP_FORM_INVALID', 'form fields are missing, duplicated, or unknown');
  }
  const result = {};
  for (const name of requiredNames) {
    const values = parameters.getAll(name);
    if (values.length !== 1 || values[0].length === 0) {
      fail('HTTP_FORM_INVALID', 'form fields are missing, duplicated, or empty');
    }
    result[name] = values[0];
  }
  return Object.freeze(result);
}

export function sendJson(response, status, body, headers = {}) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(encoded);
}
