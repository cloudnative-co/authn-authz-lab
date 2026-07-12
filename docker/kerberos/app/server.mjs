import { createServer } from 'node:http';
import { initializeServer } from 'kerberos';
import { formatNegotiateChallenge, parseNegotiateAuthorization } from './negotiate-header.mjs';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const serviceName = process.env.KERBEROS_SERVICE_NAME ?? 'HTTP@app.example.test';
const genericFailure = Object.freeze({
  code: 'NEGOTIATE_REQUIRED',
  message: 'Kerberos authentication is required.',
});

const diagnostics = {
  requests: 0,
  successes: 0,
  challenges: 0,
  finalTokens: 0,
  incompleteContexts: 0,
  lastReason: null,
};

function classifyGssError(error) {
  const value = String(error?.message ?? '');
  if (/clock skew|skew too great/i.test(value)) {
    return 'CLOCK_SKEW_REJECTED';
  }
  if (/kvno|key table|keytab|decrypt|encryption key|not found in.*key/i.test(value)) {
    return 'ACCEPTOR_KEY_MISMATCH';
  }
  return 'GSS_ACCEPT_FAILED';
}

function record(reason) {
  diagnostics.lastReason = reason;
  process.stderr.write(`${JSON.stringify({ component: 'lesson07-gssapi', reason })}\n`);
}

function sendJson(response, status, body, headers = {}) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(encoded);
}

function challenge(response, token, reason) {
  diagnostics.challenges += 1;
  record(reason);
  let header = 'Negotiate';
  try {
    header = formatNegotiateChallenge(token);
  } catch {
    record('GSS_SERVER_TOKEN_INVALID');
  }
  sendJson(response, 401, genericFailure, { 'www-authenticate': header });
}

async function authenticate(request, response) {
  diagnostics.requests += 1;
  const parsed = parseNegotiateAuthorization(request.headers.authorization);
  if (parsed.kind !== 'token') {
    challenge(response, undefined, parsed.reason);
    return;
  }

  try {
    const server = await initializeServer(serviceName);
    const responseToken = await server.step(parsed.token);
    if (!server.contextComplete) {
      diagnostics.incompleteContexts += 1;
      challenge(response, undefined, 'GSS_CONTEXT_INCOMPLETE_UNSUPPORTED');
      return;
    }
    diagnostics.successes += 1;
    diagnostics.lastReason = 'GSS_ACCEPTED';
    if (responseToken) diagnostics.finalTokens += 1;
    const headers = responseToken ? { 'www-authenticate': formatNegotiateChallenge(responseToken) } : {};
    sendJson(response, 200, {
      code: 'KERBEROS_AUTHENTICATED',
      principal: server.username,
    }, headers);
  } catch (error) {
    challenge(response, undefined, classifyGssError(error));
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://app.example.test');
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/__course/diagnostics') {
    sendJson(response, 200, {
      schemaVersion: 1,
      implementation: {
        protocol: 'HTTP-Negotiate',
        mechanismScope: 'Kerberos-v5-in-SPNEGO',
        acceptor: 'GSSAPI-keytab',
        transportContext: 'compose-private-http-training-deviation',
        productionRequirement: 'tls-required',
      },
      counters: { ...diagnostics },
      redaction: {
        authorizationToken: 'omitted',
        responseToken: 'omitted',
        keytab: 'omitted',
        nativeError: 'omitted',
      },
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/kerberos/me') {
    await authenticate(request, response);
    return;
  }
  sendJson(response, 404, { code: 'NOT_FOUND' });
});

server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.listen(port, '0.0.0.0');
