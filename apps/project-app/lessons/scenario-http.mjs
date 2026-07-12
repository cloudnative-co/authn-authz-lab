import { SCENARIO_ID_PATTERN, ScenarioRegistryError } from '../scenario-registry.mjs';
import { sendEmpty, sendJson } from '../http.mjs';

export const SCENARIO_HEADER = 'x-course-scenario-id';

export function scenarioFromRequest(request, registry, lessonId) {
  const id = request.headers[SCENARIO_HEADER];
  if (typeof id !== 'string' || !SCENARIO_ID_PATTERN.test(id)) return null;
  const value = registry.get(lessonId, id);
  return value === null ? null : { id, value };
}

export function sendScenarioMissing(response) {
  sendJson(response, 404, { error: { code: 'SCENARIO_NOT_FOUND' } });
}

export async function createScenario({ response, registry, lessonId, factory }) {
  try {
    const created = await registry.create(lessonId, factory);
    sendJson(response, 201, {
      schemaVersion: 1,
      lessonId,
      status: 'created',
    }, { [SCENARIO_HEADER]: created.id });
  } catch (error) {
    if (!(error instanceof ScenarioRegistryError)) throw error;
    const status = error.reasonCode === 'SCENARIO_CAPACITY_EXHAUSTED' ? 503 : 500;
    sendJson(response, status, { error: { code: error.reasonCode } });
  }
}

export function deleteScenario({ request, response, registry, lessonId }) {
  const id = request.headers[SCENARIO_HEADER];
  if (typeof id === 'string') registry.remove(lessonId, id);
  sendEmpty(response, 204);
}

export function updateLogicalClock(scenario, timestampMs) {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < scenario.now()) {
    throw new TypeError('timestampMs must be a non-decreasing, non-negative safe integer');
  }
  scenario.setTime(timestampMs);
  return scenario.now();
}
