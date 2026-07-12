import { createLesson04ProjectCore } from '../../../../services/project-core/index.mjs';
import {
  parseSessionCookie,
  serializeSessionCookie,
  SessionCookieError,
} from '../../../../packages/session/session-cookie.mjs';
import { HttpRequestError, readJson, requestPath, sendEmpty, sendJson, sendRequestError } from '../../http.mjs';
import { createLesson02PasswordService } from '../02/password-auth-service.mjs';
import { createLesson03SessionService } from '../03/session-service.mjs';
import {
  createScenario,
  deleteScenario,
  scenarioFromRequest,
  sendScenarioMissing,
} from '../scenario-http.mjs';

const LESSON_ID = '04';
const CONTROL_ROOT = '/__course/lessons/04';
const PROJECT_ROOT = '/api/lessons/04/projects/';
const COOKIE_OPTIONS = Object.freeze({ name: 'course04_session', secure: false });
const TRAINING_ACCOUNTS = Object.freeze([
  Object.freeze({
    id: 'user-100', identifier: 'alice.04@example.test', password: 'alice-password-for-lesson-04',
  }),
  Object.freeze({
    id: 'user-200', identifier: 'bob.04@example.test', password: 'bob-password-for-lesson-04',
  }),
  Object.freeze({
    id: 'user-300', identifier: 'carol.04@example.test', password: 'carol-password-for-lesson-04',
  }),
  Object.freeze({
    id: 'user-400', identifier: 'dave.04@example.test', password: 'dave-password-for-lesson-04',
  }),
]);

export async function createLesson04Scenario() {
  let logicalTime = 0;
  const passwordService = await createLesson02PasswordService({
    clock: () => logicalTime,
    accounts: TRAINING_ACCOUNTS,
    dummyPassword: 'dummy-password-for-lesson-04',
  });
  const sessionService = createLesson03SessionService({
    clock: () => logicalTime,
    authenticator: passwordService,
    secureCookies: false,
  });
  return Object.freeze({
    sessionService,
    projectCore: createLesson04ProjectCore({ maxAuditEntries: 64 }),
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

function sendDomainResult(response, result) {
  if (result.status === 204) sendEmpty(response, 204);
  else sendJson(response, result.status, result);
}

export function buildProjectCoreDeleteInput({ principal, resourceId } = {}) {
  if (!principal || typeof principal !== 'object') throw new TypeError('principal is required');
  return Object.freeze({
    principal: Object.freeze({ id: principal.id }),
    resourceId,
  });
}

export function createLesson04HttpHandler({ registry, scenarioFactory = createLesson04Scenario } = {}) {
  if (!registry || typeof registry.create !== 'function') throw new TypeError('registry is required');
  if (typeof scenarioFactory !== 'function') throw new TypeError('scenarioFactory must be a function');

  return async function handleLesson04(request, response) {
    const path = requestPath(request);
    if (request.method === 'POST' && path === `${CONTROL_ROOT}/scenarios`) {
      await createScenario({ response, registry, lessonId: LESSON_ID, factory: scenarioFactory });
      return true;
    }
    if (request.method === 'DELETE' && path === `${CONTROL_ROOT}/scenarios`) {
      deleteScenario({ request, response, registry, lessonId: LESSON_ID });
      return true;
    }
    const projectDelete = request.method === 'DELETE' && path?.startsWith(PROJECT_ROOT);
    if (![
      `${CONTROL_ROOT}/observe`,
      '/api/lessons/04/pre-auth',
      '/api/lessons/04/login',
    ].includes(path) && !projectDelete) return false;

    const scenario = requireScenario(request, response, registry);
    if (!scenario) return true;
    try {
      if (request.method === 'GET' && path === `${CONTROL_ROOT}/observe`) {
        const authorization = scenario.projectCore.observe();
        sendJson(response, 200, {
          schemaVersion: 1,
          lessonId: LESSON_ID,
          implementation: authorization.implementation,
          state: authorization.state,
          audit: scenario.projectCore.readAudit(),
          session: scenario.sessionService.observe(),
        });
        return true;
      }
      if (request.method === 'POST' && path === '/api/lessons/04/pre-auth') {
        const result = scenario.sessionService.createPreAuthSession();
        const headers = result.ok
          ? { 'set-cookie': serializeSessionCookie(result.sessionToken, {
            ...COOKIE_OPTIONS, maxAgeSeconds: 5 * 60,
          }) }
          : {};
        sendJson(response, result.status, publicResult(result), headers);
        return true;
      }
      if (request.method === 'POST' && path === '/api/lessons/04/login') {
        const input = await readJson(request);
        const result = await scenario.sessionService.login({
          sessionToken: requestSessionToken(request),
          identifier: input?.identifier,
          password: input?.password,
        });
        const headers = result.ok
          ? { 'set-cookie': serializeSessionCookie(result.sessionToken, {
            ...COOKIE_OPTIONS, maxAgeSeconds: 30 * 60,
          }) }
          : (result.headers ?? {});
        sendJson(response, result.status, publicResult(result), headers);
        return true;
      }
      if (projectDelete) {
        const current = scenario.sessionService.currentUser(requestSessionToken(request));
        if (!current.ok) {
          sendJson(response, current.status, current);
          return true;
        }
        const result = scenario.projectCore.deleteProject(buildProjectCoreDeleteInput({
          principal: current.principal,
          resourceId: path.slice(PROJECT_ROOT.length),
        }));
        sendDomainResult(response, result);
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
