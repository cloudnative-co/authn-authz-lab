import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizeProjectAction } from '../src/auth/authorization.js';
import { authenticateBasicAuth } from '../src/auth/basic.js';
import { authenticateWithPassword } from '../src/auth/password.js';
import { SessionStore } from '../src/auth/session.js';
import { createSeedData } from '../src/data/seed.js';

test('02 password authentication identifies a user', () => {
  const store = createSeedData();
  const alice = authenticateWithPassword(store, 'alice@example.com', 'password-alice');
  assert.equal(alice.id, 'user_alice');
  assert.equal(authenticateWithPassword(store, 'alice@example.com', 'wrong-password'), null);
});

test('03 sessions preserve authentication result between requests', () => {
  const sessions = new SessionStore({ ttlMs: 1000 });
  const id = sessions.create('user_alice', 1000);
  assert.equal(sessions.resolve(id, 1500), 'user_alice');
  assert.equal(sessions.resolve(id, 2500), null);
});

test('04 project authorization separates login from delete permission', () => {
  const store = createSeedData();
  assert.equal(authorizeProjectAction(store, 'user_alice', 'project_123', 'project.delete').allowed, true);
  assert.equal(authorizeProjectAction(store, 'user_bob', 'project_123', 'project.delete').allowed, false);
});

test('05 basic authentication authenticates every request with the Authorization header', () => {
  const store = createSeedData();
  const token = Buffer.from('alice@example.com:password-alice').toString('base64');
  const user = authenticateBasicAuth(store, `Basic ${token}`);
  assert.equal(user.id, 'user_alice');
});
