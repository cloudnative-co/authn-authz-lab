import { createLesson12MfaService } from './mfa-service.mjs';
import {
  parseSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  SessionCookieError,
} from '../../../../packages/session/session-cookie.mjs';
import { HttpRequestError, readJson, requestPath, sendJson, sendRequestError } from '../../http.mjs';
import {
  createScenario,
  deleteScenario,
  scenarioFromRequest,
  sendScenarioMissing,
  updateLogicalClock,
} from '../scenario-http.mjs';

const LESSON_ID = '12';
const CONTROL_ROOT = '/__course/lessons/12';
export const LESSON_12_INITIAL_TIME_MS = 1_700_000_000_000;
const COOKIE_OPTIONS = Object.freeze({
  enrollment: Object.freeze({ name: 'course_mfa_enrollment', secure: false }),
  preAuth: Object.freeze({ name: 'course_mfa_pre_auth', secure: false }),
  session: Object.freeze({ name: 'course_mfa_session', secure: false }),
});

export async function createLesson12Scenario() {
  let logicalTime = LESSON_12_INITIAL_TIME_MS;
  const service = await createLesson12MfaService({ clock: () => logicalTime });
  return Object.freeze({
    service,
    now: () => logicalTime,
    setTime(value) { logicalTime = value; },
  });
}

function requireScenario(request, response, registry) {
  const scenario = scenarioFromRequest(request, registry, LESSON_ID);
  if (!scenario) sendScenarioMissing(response);
  return scenario?.value ?? null;
}

function requestCookie(request, options) {
  try {
    return parseSessionCookie(request.headers.cookie ?? '', options);
  } catch (error) {
    if (error instanceof SessionCookieError) return null;
    throw error;
  }
}

function publicResult(result, omittedFields = []) {
  const copy = { ...result };
  const headers = copy.headers ?? {};
  delete copy.headers;
  for (const field of omittedFields) delete copy[field];
  return { body: copy, headers };
}

function sendServiceResult(response, result, omittedFields = [], extraHeaders = {}) {
  const exposed = publicResult(result, omittedFields);
  sendJson(response, result.status, exposed.body, { ...exposed.headers, ...extraHeaders });
}

export function createLesson12HttpHandler({ registry, scenarioFactory = createLesson12Scenario } = {}) {
  if (!registry || typeof registry.create !== 'function') throw new TypeError('registry is required');
  if (typeof scenarioFactory !== 'function') throw new TypeError('scenarioFactory must be a function');

  return async function handleLesson12(request, response) {
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
      '/api/lessons/12/enrollment/password',
      '/api/lessons/12/enrollment/start',
      '/api/lessons/12/enrollment/confirm',
      '/api/lessons/12/login/password',
      '/api/lessons/12/login/second-factor',
      '/api/lessons/12/me',
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
      if (request.method === 'POST' && path === '/api/lessons/12/enrollment/password') {
        const input = await readJson(request);
        const result = await scenario.service.beginEnrollment(input?.identifier, input?.password);
        const cookie = result.ok
          ? serializeSessionCookie(result.enrollmentToken, {
            ...COOKIE_OPTIONS.enrollment,
            maxAgeSeconds: 5 * 60,
          })
          : null;
        sendServiceResult(
          response,
          result,
          ['enrollmentToken'],
          cookie ? { 'set-cookie': cookie } : {},
        );
        return true;
      }
      if (request.method === 'POST' && path === '/api/lessons/12/enrollment/start') {
        const result = scenario.service.startEnrollment(
          requestCookie(request, COOKIE_OPTIONS.enrollment),
        );
        sendServiceResult(response, result);
        return true;
      }
      if (request.method === 'POST' && path === '/api/lessons/12/enrollment/confirm') {
        const input = await readJson(request);
        const result = scenario.service.confirmEnrollment(
          requestCookie(request, COOKIE_OPTIONS.enrollment),
          input?.code,
        );
        sendServiceResult(
          response,
          result,
          [],
          result.ok
            ? { 'set-cookie': serializeClearedSessionCookie(COOKIE_OPTIONS.enrollment) }
            : {},
        );
        return true;
      }
      if (request.method === 'POST' && path === '/api/lessons/12/login/password') {
        const input = await readJson(request);
        const result = await scenario.service.beginLogin(input?.identifier, input?.password);
        const cookie = result.ok
          ? serializeSessionCookie(result.preAuthToken, {
            ...COOKIE_OPTIONS.preAuth,
            maxAgeSeconds: 5 * 60,
          })
          : null;
        sendServiceResult(response, result, ['preAuthToken'], cookie ? { 'set-cookie': cookie } : {});
        return true;
      }
      if (request.method === 'POST' && path === '/api/lessons/12/login/second-factor') {
        const input = await readJson(request);
        const result = scenario.service.completeLogin(
          requestCookie(request, COOKIE_OPTIONS.preAuth),
          { method: input?.method, code: input?.code },
        );
        const cookie = result.ok
          ? serializeSessionCookie(result.sessionToken, {
            ...COOKIE_OPTIONS.session,
            maxAgeSeconds: 30 * 60,
          })
          : null;
        sendServiceResult(response, result, ['sessionToken'], cookie ? { 'set-cookie': cookie } : {});
        return true;
      }
      if (request.method === 'GET' && path === '/api/lessons/12/me') {
        const result = scenario.service.currentUser(requestCookie(request, COOKIE_OPTIONS.session));
        sendServiceResult(response, result);
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
