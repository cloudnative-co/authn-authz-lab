import { createLesson02PasswordService } from '../02/password-auth-service.mjs';
import { createLesson05BasicAuthService } from './basic-auth-service.mjs';
import { requestPath, sendJson } from '../../http.mjs';
import {
  createScenario,
  deleteScenario,
  scenarioFromRequest,
  sendScenarioMissing,
} from '../scenario-http.mjs';

const LESSON_ID = '05';
const CONTROL_ROOT = '/__course/lessons/05';
const TRAINING_ACCOUNT = Object.freeze({
  id: 'user-500',
  identifier: 'basic.alice@example.test',
  password: 'basic-password-for-lesson-05',
});

export async function createLesson05Scenario() {
  const passwordService = await createLesson02PasswordService({
    accounts: [TRAINING_ACCOUNT],
    dummyPassword: 'dummy-password-for-lesson-05',
  });
  return Object.freeze({
    service: createLesson05BasicAuthService({ authenticator: passwordService }),
  });
}

function requireScenario(request, response, registry) {
  const scenario = scenarioFromRequest(request, registry, LESSON_ID);
  if (!scenario) sendScenarioMissing(response);
  return scenario?.value ?? null;
}

function publicResult(result) {
  const { headers: ignoredHeaders, ...publicFields } = result;
  void ignoredHeaders;
  return publicFields;
}

export function createLesson05HttpHandler({ registry, scenarioFactory = createLesson05Scenario } = {}) {
  if (!registry || typeof registry.create !== 'function') throw new TypeError('registry is required');
  if (typeof scenarioFactory !== 'function') throw new TypeError('scenarioFactory must be a function');

  return async function handleLesson05(request, response) {
    const path = requestPath(request);
    if (request.method === 'POST' && path === `${CONTROL_ROOT}/scenarios`) {
      await createScenario({ response, registry, lessonId: LESSON_ID, factory: scenarioFactory });
      return true;
    }
    if (request.method === 'DELETE' && path === `${CONTROL_ROOT}/scenarios`) {
      deleteScenario({ request, response, registry, lessonId: LESSON_ID });
      return true;
    }
    if (![`${CONTROL_ROOT}/observe`, '/api/lessons/05/basic/me'].includes(path)) return false;

    const scenario = requireScenario(request, response, registry);
    if (!scenario) return true;
    if (request.method === 'GET' && path === `${CONTROL_ROOT}/observe`) {
      sendJson(response, 200, scenario.service.observe());
      return true;
    }
    if (request.method === 'GET' && path === '/api/lessons/05/basic/me') {
      const result = await scenario.service.authenticateAuthorization(request.headers.authorization);
      sendJson(response, result.status, publicResult(result), result.headers ?? {});
      return true;
    }
    return false;
  };
}
