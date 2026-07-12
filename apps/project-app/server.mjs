import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { evaluateLesson01Submission, Lesson01SubmissionError } from '../../course/lessons/01/assessment.mjs';
import { getLesson01Exercise } from '../../course/lessons/01/domain.mjs';
import { HttpRequestError, readJson, sendJson, sendRequestError } from './http.mjs';
import { createLesson02HttpHandler } from './lessons/02/http-handler.mjs';
import { createLesson03HttpHandler } from './lessons/03/http-handler.mjs';
import { createLesson04HttpHandler } from './lessons/04/http-handler.mjs';
import { createLesson05HttpHandler } from './lessons/05/http-handler.mjs';
import { createLesson06HttpHandler } from './lessons/06/http-handler.mjs';
import { createLesson12HttpHandler } from './lessons/12/http-handler.mjs';
import { createWebAuthnLessonHttpHandler } from './lessons/13-14/http-handler.mjs';
import { createScenarioRegistry } from './scenario-registry.mjs';

function tokenDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function assertControlToken(value) {
  if (typeof value !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/u.test(value)
      || Buffer.from(value, 'base64url').length !== 32
      || Buffer.from(value, 'base64url').toString('base64url') !== value) {
    throw new TypeError('shutdownToken must be a canonical 256-bit base64url value');
  }
  return value;
}

function secureTokenMatch(value, expectedDigest) {
  if (typeof value !== 'string') return false;
  return timingSafeEqual(tokenDigest(value), expectedDigest);
}

function expectedRequestAuthority(request) {
  const address = request.socket.localAddress;
  const port = request.socket.localPort;
  if (typeof address !== 'string' || !Number.isSafeInteger(port)) return null;
  return `${address.includes(':') ? `[${address}]` : address}:${port}`;
}

function requestAuthorityIsLocal(request) {
  const expected = expectedRequestAuthority(request);
  const port = request.socket.localPort;
  return expected !== null
    && Number.isSafeInteger(port)
    && (request.headers.host === expected || request.headers.host === `localhost:${port}`);
}

function assertIdentity(identity) {
  if (
    !identity
    || !Number.isSafeInteger(identity.pid)
    || identity.pid <= 0
    || typeof identity.installId !== 'string'
    || typeof identity.runId !== 'string'
    || identity.instanceId !== `${identity.installId}.${identity.runId}`
  ) {
    throw new TypeError('identity is invalid');
  }
}

export function createProjectAppServer({
  identity,
  shutdownToken,
  scenarioRegistry = createScenarioRegistry(),
  lesson02ScenarioFactory,
  lesson03ScenarioFactory,
  lesson04ScenarioFactory,
  lesson05ScenarioFactory,
  lesson06ScenarioFactory,
  lesson12ScenarioFactory,
  lesson13ScenarioFactory,
  lesson14ScenarioFactory,
} = {}) {
  assertIdentity(identity);
  assertControlToken(shutdownToken);
  if (!scenarioRegistry || typeof scenarioRegistry.get !== 'function') {
    throw new TypeError('scenarioRegistry is invalid');
  }
  const expectedTokenDigest = tokenDigest(shutdownToken);
  const handleLesson02 = createLesson02HttpHandler({
    registry: scenarioRegistry,
    scenarioFactory: lesson02ScenarioFactory,
  });
  const handleLesson03 = createLesson03HttpHandler({
    registry: scenarioRegistry,
    scenarioFactory: lesson03ScenarioFactory,
  });
  const handleLesson04 = createLesson04HttpHandler({
    registry: scenarioRegistry,
    scenarioFactory: lesson04ScenarioFactory,
  });
  const handleLesson05 = createLesson05HttpHandler({
    registry: scenarioRegistry,
    scenarioFactory: lesson05ScenarioFactory,
  });
  const handleLesson06 = createLesson06HttpHandler({
    registry: scenarioRegistry,
    scenarioFactory: lesson06ScenarioFactory ?? (async () => {
      throw new TypeError('Lesson 06 LDAP runtime is not configured');
    }),
  });
  const handleLesson12 = createLesson12HttpHandler({
    registry: scenarioRegistry,
    scenarioFactory: lesson12ScenarioFactory,
  });
  const handleLesson13 = createWebAuthnLessonHttpHandler({
    lessonId: '13',
    registry: scenarioRegistry,
    scenarioFactory: lesson13ScenarioFactory,
  });
  const handleLesson14 = createWebAuthnLessonHttpHandler({
    lessonId: '14',
    registry: scenarioRegistry,
    scenarioFactory: lesson14ScenarioFactory,
  });
  let server;

  server = createServer(async (request, response) => {
    if (!requestAuthorityIsLocal(request)) {
      sendJson(response, 421, { error: { code: 'HOST_INVALID' } });
      return;
    }

    if (request.method === 'GET' && request.url === '/__course/health') {
      sendJson(response, 200, identity);
      return;
    }

    if (request.method === 'POST' && request.url === '/__course/shutdown') {
      const authenticated = request.headers['x-course-instance-id'] === identity.instanceId
        && secureTokenMatch(request.headers['x-course-control-token'], expectedTokenDigest);
      if (!authenticated) {
        sendJson(response, 403, { error: { code: 'SHUTDOWN_FORBIDDEN' } });
        return;
      }
      response.statusCode = 202;
      response.setHeader('cache-control', 'no-store');
      response.setHeader('content-length', '0');
      response.setHeader('x-course-instance-id', identity.instanceId);
      response.once('finish', () => server.close());
      response.end();
      return;
    }

    if (request.method === 'GET' && request.url === '/api/lessons/01/request-traces') {
      sendJson(response, 200, getLesson01Exercise());
      return;
    }

    if (request.method === 'POST' && request.url === '/api/lessons/01/check') {
      try {
        const submission = await readJson(request);
        sendJson(response, 200, evaluateLesson01Submission(submission));
      } catch (error) {
        if (error instanceof Lesson01SubmissionError || error instanceof HttpRequestError) {
          sendRequestError(response, error);
          return;
        }
        sendJson(response, 500, { error: { code: 'INTERNAL_ERROR' } });
      }
      return;
    }

    try {
      if (await handleLesson02(request, response)) return;
      if (await handleLesson03(request, response)) return;
      if (await handleLesson04(request, response)) return;
      if (await handleLesson05(request, response)) return;
      if (await handleLesson06(request, response)) return;
      if (await handleLesson12(request, response)) return;
      if (await handleLesson13(request, response)) return;
      if (await handleLesson14(request, response)) return;
    } catch {
      sendJson(response, 500, { error: { code: 'INTERNAL_ERROR' } });
      return;
    }

    sendJson(response, 404, { error: { code: 'NOT_FOUND' } });
  });

  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  return server;
}
