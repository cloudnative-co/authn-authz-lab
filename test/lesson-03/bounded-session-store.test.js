import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createBoundedSessionStore } from '../../packages/session/bounded-session-store.mjs';

const TOKEN = Buffer.alloc(32, 0x42).toString('base64url');
const DIGEST = createHash('sha256').update(TOKEN, 'ascii').digest('hex');
const TIMESTAMPS = Object.freeze({
  authenticatedAt: null,
  createdAt: 0,
  expiredAt: null,
  expiresAt: 100,
  revokedAt: null,
});

test('the server-side store accepts only digest, subject, status, and timestamps', () => {
  const store = createBoundedSessionStore({ maxSessions: 2, maxEvents: 2 });
  store.put({
    tokenDigest: DIGEST,
    subject: null,
    status: 'pre-authenticated',
    timestamps: TIMESTAMPS,
  });
  const stored = store.entries()[0][1];
  assert.deepEqual(Object.keys(stored).sort(), [
    'status',
    'subject',
    'timestamps',
    'tokenDigest',
  ]);
  assert.equal(stored.tokenDigest, DIGEST);
  assert.equal(JSON.stringify(stored).includes(TOKEN), false);

  assert.throws(() => store.put({
    tokenDigest: DIGEST,
    token: TOKEN,
    subject: null,
    status: 'pre-authenticated',
    timestamps: TIMESTAMPS,
  }), /may contain only digest/u);
});

test('store capacity and redacted event history are enforced independently', () => {
  const store = createBoundedSessionStore({ maxSessions: 1, maxEvents: 1 });
  const record = store.put({
    tokenDigest: DIGEST,
    subject: null,
    status: 'pre-authenticated',
    timestamps: TIMESTAMPS,
  });
  store.appendEvent({
    type: 'created',
    tokenDigest: DIGEST,
    subject: null,
    status: record.status,
    timestamp: 0,
  });
  store.appendEvent({
    type: 'observed',
    tokenDigest: DIGEST,
    subject: null,
    status: record.status,
    timestamp: 1,
  });

  const observation = store.observe();
  assert.equal(observation.retainedSessionCount, 1);
  assert.equal(observation.retainedEventCount, 1);
  assert.equal(observation.events[0].type, 'observed');
  assert.equal(JSON.stringify(observation).includes(DIGEST), false);
  assert.equal(JSON.stringify(observation).includes(TOKEN), false);
});

test('observation omits the subject identifier from both records and events', () => {
  const store = createBoundedSessionStore({ maxSessions: 1, maxEvents: 1 });
  const authenticated = store.put({
    tokenDigest: DIGEST,
    subject: { id: 'user-alice', identifier: 'alice@example.com' },
    status: 'authenticated',
    timestamps: {
      ...TIMESTAMPS,
      authenticatedAt: 0,
    },
  });
  store.appendEvent({
    type: 'authenticated',
    tokenDigest: DIGEST,
    subject: authenticated.subject,
    status: authenticated.status,
    timestamp: 0,
  });

  const observation = store.observe();
  assert.deepEqual(observation.records[0].subject, { id: 'user-alice' });
  assert.deepEqual(observation.events[0].subject, { id: 'user-alice' });
  assert.equal(JSON.stringify(observation).includes('alice@example.com'), false);
});
