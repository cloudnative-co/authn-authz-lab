const ROLES = new Set(['authorization-server', 'oauth-client', 'oidc-rp', 'resource-api']);
const METHODS = new Set(['GET', 'POST', 'DELETE']);
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/u;

export function createEvidenceRecorder({ limit = 256 } = {}) {
  const events = [];

  function record({ role, origin, method, path, status, reason, checks = {} }) {
    if (!ROLES.has(role) || !METHODS.has(method)) throw new TypeError('invalid evidence role or method');
    const url = new URL(path, origin);
    if (url.origin !== origin || url.search || url.hash) throw new TypeError('evidence path must omit query and fragment');
    if (!Number.isSafeInteger(status) || status < 100 || status > 599) throw new TypeError('invalid status');
    if (reason !== undefined && !REASON.test(reason)) throw new TypeError('invalid evidence reason');
    const booleans = {};
    for (const [name, value] of Object.entries(checks)) {
      if (!/^[a-z][A-Za-z0-9]{1,63}$/u.test(name) || typeof value !== 'boolean') {
        throw new TypeError('evidence checks must be named booleans');
      }
      booleans[name] = value;
    }
    if (events.length >= limit) throw new Error('EVIDENCE_CAPACITY_EXCEEDED');
    events.push(Object.freeze({ role, origin, method, path: url.pathname, status, reason, checks: booleans }));
  }

  function snapshot() {
    return structuredClone(events);
  }

  function clear() {
    events.length = 0;
  }

  return Object.freeze({ record, snapshot, clear });
}
