import { createLesson02PasswordService } from '../02/password-auth-service.mjs';
import { createLesson03SessionService } from './session-service.mjs';
import {
  parseSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  SessionCookieError,
} from '../../../../packages/session/session-cookie.mjs';
import {
  HttpRequestError,
  readJson,
  requestPath,
  sendEmpty,
  sendJson,
  sendRequestError,
} from '../../http.mjs';
import {
  createScenario,
  deleteScenario,
  scenarioFromRequest,
  sendScenarioMissing,
  updateLogicalClock,
} from '../scenario-http.mjs';

const LESSON_ID = '03';
const CONTROL_ROOT = '/__course/lessons/03';
const COOKIE_OPTIONS = Object.freeze({ secure: false });

export async function createLesson03Scenario() {
  let logicalTime = 0;
  const passwordService = await createLesson02PasswordService({ clock: () => logicalTime });
  const sessionService = createLesson03SessionService({
    clock: () => logicalTime,
    authenticator: passwordService,
    secureCookies: false,
  });
  return Object.freeze({
    service: sessionService,
    now: () => logicalTime,
    setTime(value) { logicalTime = value; },
  });
}

function requireScenario(request, response, registry) {
  const scenario = scenarioFromRequest(request, registry, LESSON_ID);
  if (!scenario) sendScenarioMissing(response);
  return scenario?.value ?? null;
}

function requestSessionToken(request) {
  try {
    return parseSessionCookie(request.headers.cookie ?? '', COOKIE_OPTIONS);
  } catch (error) {
    if (error instanceof SessionCookieError) return null;
    throw error;
  }
}

function publicResult(result) {
  const {
    sessionToken: ignoredSessionToken,
    headers: ignoredHeaders,
    ...publicFields
  } = result;
  void ignoredSessionToken;
  void ignoredHeaders;
  return publicFields;
}

function sessionCookie(token, maxAgeSeconds) {
  return serializeSessionCookie(token, { ...COOKIE_OPTIONS, maxAgeSeconds });
}

export function createLesson03HttpHandler({ registry, scenarioFactory = createLesson03Scenario } = {}) {
  if (!registry || typeof registry.create !== 'function') throw new TypeError('registry is required');
  if (typeof scenarioFactory !== 'function') throw new TypeError('scenarioFactory must be a function');

  return async function handleLesson03(request, response) {
    const path = requestPath(request);
    if (request.method === 'POST' && path === `${CONTROL_ROOT}/scenarios`) {
      await createScenario({ response, registry, lessonId: LESSON_ID, factory: scenarioFactory });
      return true;
    }
    if (request.method === 'DELETE' && path === `${CONTROL_ROOT}/scenarios`) {
      deleteScenario({ request, response, registry, lessonId: LESSON_ID });
      return true;
    }
    if (![
      `${CONTROL_ROOT}/observe`,
      `${CONTROL_ROOT}/clock`,
      `${CONTROL_ROOT}/revoke-subject`,
      '/api/lessons/03/pre-auth',
      '/api/lessons/03/login',
      '/api/lessons/03/me',
      '/api/lessons/03/logout',
    ].includes(path)) return false;

    const scenario = requireScenario(request, response, registry);
    if (!scenario) return true;
    try {
      if (request.method === 'GET' && path === `${CONTROL_ROOT}/observe`) {
        sendJson(response, 200, scenario.service.observe());
        return true;
      }
      if (request.method === 'POST' && path === `${CONTROL_ROOT}/clock`) {
        const input = await readJson(request);
        const currentTimeMs = updateLogicalClock(scenario, input?.timestampMs);
        sendJson(response, 200, {
          schemaVersion: 1,
          lessonId: LESSON_ID,
          labControl: 'logical-clock',
          currentTimeMs,
        });
        return true;
      }
      if (request.method === 'POST' && path === `${CONTROL_ROOT}/revoke-subject`) {
        const input = await readJson(request);
        const result = scenario.service.revokeSubject(input?.subjectId);
        sendJson(response, result.status, { ...result, labControl: 'server-side-revocation' });
        return true;
      }
      if (request.method === 'POST' && path === '/api/lessons/03/pre-auth') {
        const result = scenario.service.createPreAuthSession();
        const headers = result.ok
          ? { 'set-cookie': sessionCookie(result.sessionToken, 5 * 60) }
          : {};
        sendJson(response, result.status, publicResult(result), headers);
        return true;
      }
      if (request.method === 'POST' && path === '/api/lessons/03/login') {
        const input = await readJson(request);
        const result = await scenario.service.login({
          sessionToken: requestSessionToken(request),
          identifier: input?.identifier,
          password: input?.password,
        });
        const headers = result.ok
          ? { 'set-cookie': sessionCookie(result.sessionToken, 30 * 60) }
          : (result.headers ?? {});
        sendJson(response, result.status, publicResult(result), headers);
        return true;
      }
      if (request.method === 'GET' && path === '/api/lessons/03/me') {
        const result = scenario.service.currentUser(requestSessionToken(request));
        sendJson(response, result.status, result);
        return true;
      }
      if (request.method === 'POST' && path === '/api/lessons/03/logout') {
        scenario.service.logout(requestSessionToken(request));
        sendEmpty(response, 204, {
          'set-cookie': serializeClearedSessionCookie(COOKIE_OPTIONS),
        });
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof HttpRequestError) sendRequestError(response, error);
      else if (error instanceof TypeError) sendJson(response, 400, { error: { code: 'REQUEST_INVALID' } });
      else throw error;
      return true;
    }
  };
}
