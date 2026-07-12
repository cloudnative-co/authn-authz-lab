import { canonicalOpaque, randomOpaque } from './crypto.mjs';
import { createEvidenceRecorder } from './evidence.mjs';

const PROFILES = Object.freeze({
  'lesson-10': Object.freeze({
    oauthClientFaultQueue: Object.freeze([null, 'pkce', 'replay']),
    idTokenFaultQueue: Object.freeze([]),
    accessTokenFaultQueue: Object.freeze([]),
  }),
  'lesson-11': Object.freeze({
    oauthClientFaultQueue: Object.freeze([]),
    idTokenFaultQueue: Object.freeze([null, 'signature', 'issuer', 'audience', 'expiry', 'nonce', 'access-token']),
    accessTokenFaultQueue: Object.freeze([]),
  }),
  'lesson-15': Object.freeze({
    oauthClientFaultQueue: Object.freeze([]),
    idTokenFaultQueue: Object.freeze([]),
    accessTokenFaultQueue: Object.freeze([
      'malformed',
      'signature',
      'issuer',
      'audience',
      'expiry',
      'wrong-typ',
      'id-token',
      'missing-client-id',
      'wrong-client-id',
      'missing-sub',
      'missing-jti',
      'missing-iat',
      'missing-scope',
      null,
      null,
      null,
      null,
      null,
    ]),
  }),
});

function record(profile = null) {
  const plan = profile ? PROFILES[profile] : {
    oauthClientFaultQueue: [], idTokenFaultQueue: [], accessTokenFaultQueue: [],
  };
  if (!plan) throw new TypeError('unsupported scenario profile');
  return Object.freeze({
    profile,
    oauthClientFaultQueue: Object.freeze([...plan.oauthClientFaultQueue]),
    idTokenFaultQueue: Object.freeze([...plan.idTokenFaultQueue]),
    accessTokenFaultQueue: Object.freeze([...plan.accessTokenFaultQueue]),
    evidence: createEvidenceRecorder(),
  });
}

function distinctHeader(request, name) {
  const values = request.headersDistinct?.[name]
    ?? (request.headers[name] === undefined ? [] : [request.headers[name]]);
  return values.length === 1 ? values[0] : null;
}

export function createLabScenarioRegistry({ limit = 16 } = {}) {
  const defaultScenario = record();
  const scenarios = new Map();

  function create(profile) {
    if (!Object.hasOwn(PROFILES, profile)) throw new TypeError('unsupported scenario profile');
    if (scenarios.size >= limit) throw new Error('SCENARIO_CAPACITY_EXCEEDED');
    const id = randomOpaque();
    scenarios.set(id, record(profile));
    return id;
  }

  function fromRequest(request) {
    const values = request.headersDistinct?.['x-course-scenario-id']
      ?? (request.headers['x-course-scenario-id'] === undefined ? [] : [request.headers['x-course-scenario-id']]);
    if (values.length === 0) return defaultScenario;
    if (values.length !== 1 || !canonicalOpaque(values[0])) return null;
    return scenarios.get(values[0]) ?? null;
  }

  function get(id) {
    return canonicalOpaque(id) ? scenarios.get(id) ?? null : null;
  }

  function remove(id) {
    return canonicalOpaque(id) && scenarios.delete(id);
  }

  return Object.freeze({ create, fromRequest, get, remove, defaultScenario });
}

export function scenarioIdFromRequest(request) {
  const value = distinctHeader(request, 'x-course-scenario-id');
  return canonicalOpaque(value) ? value : null;
}

export const SCENARIO_PROFILES = Object.freeze(Object.keys(PROFILES));
