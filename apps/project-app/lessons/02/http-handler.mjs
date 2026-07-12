import { createLesson02PasswordService } from './password-auth-service.mjs';
import { HttpRequestError, readJson, requestPath, sendJson, sendRequestError } from '../../http.mjs';
import {
  createScenario,
  deleteScenario,
  scenarioFromRequest,
  sendScenarioMissing,
  updateLogicalClock,
} from '../scenario-http.mjs';

const LESSON_ID = '02';
const CONTROL_ROOT = '/__course/lessons/02';
const LESSON_RATE_LIMIT = Object.freeze({
  failureThreshold: 3,
  failureWindowMs: 30_000,
  blockDurationMs: 30_000,
  maxTrackedIdentifiers: 8,
});

export async function createLesson02Scenario() {
  let logicalTime = 0;
  const service = await createLesson02PasswordService({
    clock: () => logicalTime,
    rateLimit: LESSON_RATE_LIMIT,
  });
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

export function createLesson02HttpHandler({ registry, scenarioFactory = createLesson02Scenario } = {}) {
  if (!registry || typeof registry.create !== 'function') throw new TypeError('registry is required');
  if (typeof scenarioFactory !== 'function') throw new TypeError('scenarioFactory must be a function');

  return async function handleLesson02(request, response) {
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
      '/api/lessons/02/authenticate',
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
      if (request.method === 'POST' && path === '/api/lessons/02/authenticate') {
        const input = await readJson(request);
        const result = await scenario.service.authenticate(input?.identifier, input?.password);
        const { headers = {}, ...publicResult } = result;
        sendJson(response, result.status, publicResult, headers);
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
