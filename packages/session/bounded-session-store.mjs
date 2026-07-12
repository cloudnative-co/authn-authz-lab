import { sessionDigestFingerprint } from './session-token.mjs';

const STATUSES = new Set(['pre-authenticated', 'authenticated', 'revoked', 'expired']);
const RECORD_KEYS = ['status', 'subject', 'timestamps', 'tokenDigest'];
const TIMESTAMP_KEYS = ['authenticatedAt', 'createdAt', 'expiredAt', 'expiresAt', 'revokedAt'];

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function keysExactly(value, expected) {
  return Object.keys(value).sort().join('\u0000') === [...expected].sort().join('\u0000');
}

function copySubject(subject) {
  if (subject === null) return null;
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) {
    throw new TypeError('session subject must be null or an object');
  }
  const allowed = subject.identifier === undefined ? ['id'] : ['id', 'identifier'];
  if (!keysExactly(subject, allowed)) throw new TypeError('session subject contains unsupported fields');
  if (typeof subject.id !== 'string' || subject.id.length < 1 || subject.id.length > 128) {
    throw new TypeError('session subject id is invalid');
  }
  if (/[\u0000-\u001f\u007f]/u.test(subject.id)) throw new TypeError('session subject id is invalid');
  const copied = { id: subject.id };
  if (subject.identifier !== undefined) {
    if (
      typeof subject.identifier !== 'string'
      || subject.identifier.length < 1
      || subject.identifier.length > 254
      || /[\u0000-\u001f\u007f]/u.test(subject.identifier)
    ) {
      throw new TypeError('session subject identifier is invalid');
    }
    copied.identifier = subject.identifier;
  }
  return Object.freeze(copied);
}

function copyTimestamps(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('session timestamps must be an object');
  }
  if (!keysExactly(value, TIMESTAMP_KEYS)) {
    throw new TypeError('session timestamps contain unsupported fields');
  }
  const copied = {};
  for (const key of TIMESTAMP_KEYS) {
    const timestamp = value[key];
    if (timestamp !== null && (!Number.isSafeInteger(timestamp) || timestamp < 0)) {
      throw new TypeError(`session timestamp ${key} is invalid`);
    }
    copied[key] = timestamp;
  }
  if (copied.createdAt === null || copied.expiresAt === null || copied.expiresAt < copied.createdAt) {
    throw new TypeError('session lifetime timestamps are invalid');
  }
  return Object.freeze(copied);
}

function copyRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('session record must be an object');
  }
  if (!keysExactly(record, RECORD_KEYS)) {
    throw new TypeError('session record may contain only digest, subject, status, and timestamps');
  }
  sessionDigestFingerprint(record.tokenDigest);
  if (!STATUSES.has(record.status)) throw new TypeError('session status is invalid');
  const subject = copySubject(record.subject);
  if (record.status === 'authenticated' && subject === null) {
    throw new TypeError('authenticated session must have a subject');
  }
  if (record.status === 'pre-authenticated' && subject !== null) {
    throw new TypeError('pre-authenticated session must not have a subject');
  }
  return Object.freeze({
    tokenDigest: record.tokenDigest,
    subject,
    status: record.status,
    timestamps: copyTimestamps(record.timestamps),
  });
}

function redactedSubject(subject) {
  return subject === null ? null : Object.freeze({ id: subject.id });
}

export function createBoundedSessionStore(options = {}) {
  const maxSessions = positiveInteger(options.maxSessions ?? 128, 'maxSessions');
  const maxEvents = positiveInteger(options.maxEvents ?? 256, 'maxEvents');
  const records = new Map();
  const events = [];
  let sequence = 0;

  function put(record) {
    const copied = copyRecord(record);
    if (!records.has(copied.tokenDigest) && records.size >= maxSessions) {
      const error = new Error('session store capacity is exhausted');
      error.code = 'SESSION_STORE_CAPACITY';
      throw error;
    }
    records.set(copied.tokenDigest, copied);
    return copied;
  }

  function appendEvent({ type, tokenDigest, subject, status, timestamp }) {
    if (typeof type !== 'string' || type.length < 1 || type.length > 64) {
      throw new TypeError('session event type is invalid');
    }
    if (!STATUSES.has(status)) throw new TypeError('session event status is invalid');
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError('session event timestamp is invalid');
    }
    const event = Object.freeze({
      sequence: ++sequence,
      type,
      sessionFingerprint: sessionDigestFingerprint(tokenDigest),
      subject: copySubject(subject),
      status,
      timestamp,
    });
    events.push(event);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    return event;
  }

  return Object.freeze({
    get: (digest) => records.get(digest) ?? null,
    has: (digest) => records.has(digest),
    put,
    delete: (digest) => records.delete(digest),
    entries: () => Object.freeze([...records.entries()]),
    size: () => records.size,
    appendEvent,
    observe() {
      const redactedRecords = [...records.values()]
        .map((record) => Object.freeze({
          sessionFingerprint: sessionDigestFingerprint(record.tokenDigest),
          subject: redactedSubject(record.subject),
          status: record.status,
          timestamps: record.timestamps,
        }))
        .sort((left, right) => left.sessionFingerprint.localeCompare(right.sessionFingerprint));
      const redactedEvents = events.map((event) => Object.freeze({
        ...event,
        subject: redactedSubject(event.subject),
      }));
      return Object.freeze({
        retainedSessionCount: records.size,
        maxSessions,
        records: Object.freeze(redactedRecords),
        retainedEventCount: events.length,
        maxEvents,
        events: Object.freeze(redactedEvents),
      });
    },
  });
}
