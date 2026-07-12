import { randomBytes } from 'node:crypto';

const LESSON_ID_PATTERN = /^[0-9]{2}$/;
export const SCENARIO_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export class ScenarioRegistryError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'ScenarioRegistryError';
    this.reasonCode = reasonCode;
  }
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function timestamp(clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('clock must return a non-negative safe integer');
  }
  return value;
}

function lessonId(value) {
  if (typeof value !== 'string' || !LESSON_ID_PATTERN.test(value)) {
    throw new TypeError('lessonId must contain exactly two digits');
  }
  return value;
}

function scenarioId(randomId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const value = randomId();
    if (typeof value === 'string' && SCENARIO_ID_PATTERN.test(value)) return value;
  }
  throw new ScenarioRegistryError('SCENARIO_ID_UNAVAILABLE', 'a scenario id could not be generated');
}

export function createScenarioRegistry({
  maxScenarios = 8,
  ttlMs = 5 * 60 * 1000,
  clock = Date.now,
  randomId = () => randomBytes(16).toString('base64url'),
} = {}) {
  positiveInteger(maxScenarios, 'maxScenarios');
  positiveInteger(ttlMs, 'ttlMs');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof randomId !== 'function') throw new TypeError('randomId must be a function');
  const scenarios = new Map();
  let pendingCreates = 0;

  function sweep(now = timestamp(clock)) {
    for (const [id, entry] of scenarios) {
      if (now - entry.lastAccessedAt >= ttlMs) scenarios.delete(id);
    }
  }

  async function create(requestedLessonId, factory) {
    const idForLesson = lessonId(requestedLessonId);
    if (typeof factory !== 'function') throw new TypeError('factory must be a function');
    const startedAt = timestamp(clock);
    sweep(startedAt);
    if (scenarios.size + pendingCreates >= maxScenarios) {
      throw new ScenarioRegistryError('SCENARIO_CAPACITY_EXHAUSTED', 'scenario capacity is exhausted');
    }
    pendingCreates += 1;
    try {
      const value = await factory();
      const completedAt = timestamp(clock);
      sweep(completedAt);
      if (scenarios.size >= maxScenarios) {
        throw new ScenarioRegistryError('SCENARIO_CAPACITY_EXHAUSTED', 'scenario capacity is exhausted');
      }
      let id = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = scenarioId(randomId);
        if (!scenarios.has(candidate)) {
          id = candidate;
          break;
        }
      }
      if (id === null) {
        throw new ScenarioRegistryError('SCENARIO_ID_UNAVAILABLE', 'a unique scenario id could not be generated');
      }
      scenarios.set(id, {
        lessonId: idForLesson,
        value,
        createdAt: completedAt,
        lastAccessedAt: completedAt,
      });
      return Object.freeze({ id, lessonId: idForLesson });
    } finally {
      pendingCreates -= 1;
    }
  }

  function get(requestedLessonId, id) {
    const idForLesson = lessonId(requestedLessonId);
    const now = timestamp(clock);
    sweep(now);
    if (typeof id !== 'string' || !SCENARIO_ID_PATTERN.test(id)) return null;
    const entry = scenarios.get(id);
    if (!entry || entry.lessonId !== idForLesson) return null;
    entry.lastAccessedAt = now;
    return entry.value;
  }

  function remove(requestedLessonId, id) {
    const idForLesson = lessonId(requestedLessonId);
    sweep();
    if (typeof id !== 'string' || !SCENARIO_ID_PATTERN.test(id)) return false;
    const entry = scenarios.get(id);
    if (!entry || entry.lessonId !== idForLesson) return false;
    return scenarios.delete(id);
  }

  function inspect() {
    sweep();
    const counts = {};
    for (const entry of scenarios.values()) counts[entry.lessonId] = (counts[entry.lessonId] ?? 0) + 1;
    return Object.freeze({ size: scenarios.size, pendingCreates, counts: Object.freeze({ ...counts }) });
  }

  return Object.freeze({ create, get, remove, inspect });
}
