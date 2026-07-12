import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { constantTimeEqual } from '../../../packages/saml-strict/bounded-store.mjs';
import { generateRuntimeCertificate } from '../../../packages/saml-strict/fixture.mjs';
import { fetchIdpMetadata } from '../../../packages/saml-strict/metadata.mjs';
import { createStrictSamlServiceProvider } from '../../../packages/saml-strict/service-provider.mjs';
import { runConformanceSuite } from './conformance.mjs';
import {
  parseExactForm,
  readBoundedBody,
  sendJson,
  uniqueHeader,
} from './http.mjs';
import { SessionStore } from './session-store.mjs';

const PORT = 3009;
const SP_ISSUER = 'lesson09-sp';
const SP_ACS = 'http://sp:3009/saml/acs';
const KEYCLOAK_ISSUER = 'http://keycloak:8080/realms/lesson09';
const KEYCLOAK_METADATA = `${KEYCLOAK_ISSUER}/protocol/saml/descriptor`;
const FIXTURE_ISSUER = 'https://lesson09-runtime-fixture.invalid/idp';
const FIXTURE_AUDIENCE = 'lesson09-fixture-sp';
const FIXTURE_ACS = 'http://sp:3009/saml/fixture-acs';
const GENERIC_FAILURE = Object.freeze({
  code: 'SAML_LOGIN_FAILED',
  message: 'SSO response could not be accepted',
});

function redirect(response, location, headers = {}) {
  response.writeHead(303, { location, 'cache-control': 'no-store', ...headers });
  response.end();
}

function isControlAuthorized(request, token) {
  try {
    const value = uniqueHeader(request, 'authorization', { required: true, maxBytes: 512 });
    return value.startsWith('Bearer ') && constantTimeEqual(value.slice(7), token);
  } catch {
    return false;
  }
}

async function main() {
  const controlToken = (await readFile('/run/secrets/lesson09_control_token', 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{43}$/u.test(controlToken)) throw new Error('control token is invalid');
  const metadata = await fetchIdpMetadata(KEYCLOAK_METADATA, { expectedEntityId: KEYCLOAK_ISSUER });
  const actualProvider = createStrictSamlServiceProvider({
    callbackUrl: SP_ACS,
    entryPoint: metadata.entryPoint,
    issuer: SP_ISSUER,
    audience: SP_ISSUER,
    idpIssuer: metadata.entityId,
    idpCert: metadata.certs,
  });
  const fixtureKeys = await generateRuntimeCertificate('/tmp/lesson09-fixture');
  const fixtureProvider = createStrictSamlServiceProvider({
    callbackUrl: FIXTURE_ACS,
    entryPoint: 'http://fixture-idp.invalid/sso',
    issuer: FIXTURE_AUDIENCE,
    audience: FIXTURE_AUDIENCE,
    idpIssuer: FIXTURE_ISSUER,
    idpCert: fixtureKeys.certificate,
  });
  const sessions = new SessionStore();
  const fixtureDiagnostics = { lastReason: null };
  const actualDiagnostics = {
    accepted: 0,
    rejected: 0,
    lastReason: null,
    rawXmlLogged: false,
    nameIdLogged: false,
    sessionCookieLogged: false,
  };
  let conformanceTail = Promise.resolve();

  async function handleAcs(request, response, provider, diagnostics) {
    const beforeSessions = sessions.createdCount;
    try {
      if (uniqueHeader(request, 'transfer-encoding') !== null
          || uniqueHeader(request, 'content-encoding') !== null) {
        throw new Error('unsupported request framing');
      }
      const contentType = uniqueHeader(request, 'content-type', { required: true, maxBytes: 128 });
      if (!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/iu.test(contentType)) {
        throw new Error('unexpected content type');
      }
      const fields = parseExactForm(await readBoundedBody(request), ['SAMLResponse', 'RelayState']);
      const verified = await provider.validateResponse({
        samlResponse: fields.SAMLResponse,
        relayState: fields.RelayState,
      });
      const session = sessions.create(verified.subjectDigest);
      diagnostics.lastReason = null;
      diagnostics.accepted = (diagnostics.accepted ?? 0) + 1;
      return redirect(response, '/me', { 'set-cookie': session.cookie });
    } catch (error) {
      diagnostics.lastReason = error?.reasonCode ?? 'ACS_INPUT_INVALID';
      diagnostics.rejected = (diagnostics.rejected ?? 0) + 1;
      if (sessions.createdCount !== beforeSessions) {
        diagnostics.lastReason = 'SESSION_CREATED_BEFORE_VALIDATION';
      }
      return sendJson(response, 400, GENERIC_FAILURE);
    }
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://sp:3009');
      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { status: 'ready', protocol: 'SAML-2.0' });
      }
      if (request.method === 'GET' && url.pathname === '/login') {
        const login = await actualProvider.beginLogin();
        response.writeHead(302, {
          location: login.location,
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        });
        return response.end();
      }
      if (request.method === 'POST' && url.pathname === '/saml/acs') {
        return handleAcs(request, response, actualProvider, actualDiagnostics);
      }
      if (request.method === 'POST' && url.pathname === '/saml/fixture-acs') {
        return handleAcs(request, response, fixtureProvider, fixtureDiagnostics);
      }
      if (request.method === 'GET' && url.pathname === '/me') {
        let session = null;
        try {
          session = sessions.resolve(uniqueHeader(request, 'cookie', { maxBytes: 4096 }));
        } catch {
          session = null;
        }
        if (!session) return sendJson(response, 401, { code: 'LOGIN_REQUIRED' });
        return sendJson(response, 200, {
          authenticated: true,
          subjectBoundToSession: typeof session.subjectDigest === 'string',
          source: 'validated-saml-assertion',
        });
      }
      if (request.method === 'POST' && url.pathname === '/__course/conformance') {
        if (!isControlAuthorized(request, controlToken)) {
          return sendJson(response, 404, { code: 'NOT_FOUND' });
        }
        if (uniqueHeader(request, 'content-length') !== null
            && uniqueHeader(request, 'content-length') !== '0') {
          return sendJson(response, 400, { code: 'CONTROL_INPUT_INVALID' });
        }
        const operation = conformanceTail.then(() => runConformanceSuite({
          fixtureProvider,
          fixtureKeys,
          fixtureDiagnostics,
          sessionStore: sessions,
          fixtureIssuer: FIXTURE_ISSUER,
          fixtureAudience: FIXTURE_AUDIENCE,
          fixtureAcs: FIXTURE_ACS,
        }));
        conformanceTail = operation.catch(() => undefined);
        return sendJson(response, 200, await operation);
      }
      if (request.method === 'GET' && url.pathname === '/__course/evidence') {
        if (!isControlAuthorized(request, controlToken)) {
          return sendJson(response, 404, { code: 'NOT_FOUND' });
        }
        return sendJson(response, 200, {
          actual: actualDiagnostics,
          provider: actualProvider.diagnostics(),
          evidenceRedaction: {
            rawSamlResponse: 'omitted',
            assertionXml: 'omitted',
            nameId: 'omitted',
            sessionCookie: 'omitted',
            privateKey: 'omitted',
          },
        });
      }
      return sendJson(response, 404, { code: 'NOT_FOUND' });
    } catch {
      return sendJson(response, 500, { code: 'INTERNAL_ERROR' });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 64;
  server.listen(PORT, '0.0.0.0');

  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error) => {
  process.stderr.write(`Lesson 09 SP startup failed: ${String(error?.message ?? 'unknown')}\n`);
  process.exit(1);
});
