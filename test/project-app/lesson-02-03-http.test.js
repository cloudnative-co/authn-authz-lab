import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';

const identity = Object.freeze({
  pid: process.pid,
  installId: 'install-http-test',
  runId: 'run-http-test',
  instanceId: 'install-http-test.run-http-test',
});
const shutdownToken = 'A'.repeat(43);

async function listen() {
  const server = createProjectAppServer({ identity, shutdownToken });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise());
  });
}

async function createScenario(origin, lessonId) {
  const response = await fetch(`${origin}/__course/lessons/${lessonId}/scenarios`, { method: 'POST' });
  assert.equal(response.status, 201);
  const scenarioId = response.headers.get('x-course-scenario-id');
  assert.match(scenarioId, /^[A-Za-z0-9_-]{22}$/u);
  const body = await response.text();
  assert.equal(body.includes(scenarioId), false);
  assert.equal(JSON.parse(body).status, 'created');
  return scenarioId;
}

function scenarioHeaders(scenarioId, headers = {}) {
  return { 'x-course-scenario-id': scenarioId, ...headers };
}

function jsonRequest(scenarioId, body, headers = {}) {
  return {
    method: 'POST',
    headers: scenarioHeaders(scenarioId, { 'content-type': 'application/json', ...headers }),
    body: JSON.stringify(body),
  };
}

function cookiePair(response) {
  const value = response.headers.get('set-cookie');
  assert.equal(typeof value, 'string');
  return value.split(';', 1)[0];
}

async function loginLesson03(origin, scenarioId) {
  const preAuth = await fetch(`${origin}/api/lessons/03/pre-auth`, {
    method: 'POST',
    headers: scenarioHeaders(scenarioId),
  });
  assert.equal(preAuth.status, 201);
  const preAuthSetCookie = preAuth.headers.get('set-cookie');
  const preAuthCookie = cookiePair(preAuth);
  const login = await fetch(`${origin}/api/lessons/03/login`, jsonRequest(scenarioId, {
    identifier: 'alice@example.com',
    password: 'alice-password-for-lesson-02',
  }, { cookie: preAuthCookie }));
  assert.equal(login.status, 200);
  const authenticatedSetCookie = login.headers.get('set-cookie');
  const authenticatedCookie = cookiePair(login);
  assert.notEqual(authenticatedCookie, preAuthCookie);
  const loginText = await login.text();
  assert.equal(loginText.includes(authenticatedCookie.split('=')[1]), false);
  assert.equal(loginText.includes('alice-password-for-lesson-02'), false);
  return {
    preAuthCookie,
    preAuthSetCookie,
    authenticatedCookie,
    authenticatedSetCookie,
    loginBody: JSON.parse(loginText),
  };
}

test('lesson 02 traverses real HTTP with isolated password state and redacted observation', async () => {
  const { server, origin } = await listen();
  try {
    const absent = await fetch(`${origin}/api/lessons/02/authenticate`, jsonRequest('A'.repeat(22), {
      identifier: 'alice@example.com',
      password: 'wrong',
    }));
    assert.equal(absent.status, 404);

    const scenarioId = await createScenario(origin, '02');
    const observationResponse = await fetch(`${origin}/__course/lessons/02/observe`, {
      headers: scenarioHeaders(scenarioId),
    });
    assert.equal(observationResponse.status, 200);
    const observationText = await observationResponse.text();
    const observation = JSON.parse(observationText);
    assert.deepEqual(observation.kdf.defaultProfile, { N: 32768, r: 8, p: 3 });
    assert.equal(observation.seed.dummySaltDemonstration.saltsDiffer, true);
    assert.equal(observation.implementation.sessionIssuance, 'not-implemented');
    assert.equal(observationText.includes('alice-password-for-lesson-02'), false);
    assert.equal(observationText.includes('$course-scrypt$'), false);

    const success = await fetch(`${origin}/api/lessons/02/authenticate`, jsonRequest(scenarioId, {
      identifier: 'alice@example.com',
      password: 'alice-password-for-lesson-02',
    }));
    assert.equal(success.status, 200);
    assert.equal((await success.json()).sessionIssued, false);

    const wrongInput = { identifier: 'alice@example.com', password: 'wrong password' };
    const wrong = await fetch(`${origin}/api/lessons/02/authenticate`, jsonRequest(scenarioId, wrongInput));
    const unknown = await fetch(`${origin}/api/lessons/02/authenticate`, jsonRequest(scenarioId, {
      identifier: 'nobody@example.com',
      password: 'wrong password',
    }));
    assert.equal(wrong.status, 422);
    assert.equal(unknown.status, 422);
    assert.deepEqual(await wrong.json(), await unknown.json());

    assert.equal((await fetch(`${origin}/api/lessons/02/authenticate`, jsonRequest(scenarioId, wrongInput))).status, 422);
    const limited = await fetch(`${origin}/api/lessons/02/authenticate`, jsonRequest(scenarioId, wrongInput));
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '30');
    assert.equal((await fetch(`${origin}/api/lessons/02/authenticate`, jsonRequest(scenarioId, {
      identifier: 'alice@example.com',
      password: 'alice-password-for-lesson-02',
    }))).status, 429);

    const clock = await fetch(`${origin}/__course/lessons/02/clock`, jsonRequest(scenarioId, {
      timestampMs: 30_000,
    }));
    assert.equal(clock.status, 200);
    assert.equal((await fetch(`${origin}/api/lessons/02/authenticate`, jsonRequest(scenarioId, {
      identifier: 'alice@example.com',
      password: 'alice-password-for-lesson-02',
    }))).status, 200);

    const wrongType = await fetch(`${origin}/api/lessons/02/authenticate`, {
      method: 'POST',
      headers: scenarioHeaders(scenarioId, { 'content-type': 'text/plain' }),
      body: '{}',
    });
    assert.equal(wrongType.status, 400);
    assert.equal((await wrongType.json()).error.code, 'CONTENT_TYPE_INVALID');

    assert.equal((await fetch(`${origin}/__course/lessons/02/scenarios`, {
      method: 'DELETE', headers: scenarioHeaders(scenarioId),
    })).status, 204);
    assert.equal((await fetch(`${origin}/__course/lessons/02/scenarios`, {
      method: 'DELETE', headers: scenarioHeaders(scenarioId),
    })).status, 204);
    assert.equal((await fetch(`${origin}/__course/lessons/02/observe`, {
      headers: scenarioHeaders(scenarioId),
    })).status, 404);
  } finally {
    await close(server);
  }
});

test('lesson 03 uses Set-Cookie and Cookie for rotation, logout, expiry, and revocation', async () => {
  const { server, origin } = await listen();
  try {
    const scenarioId = await createScenario(origin, '03');
    const first = await loginLesson03(origin, scenarioId);
    assert.match(first.preAuthSetCookie, /; HttpOnly; SameSite=Lax; Path=\/; Max-Age=300$/u);
    assert.match(first.authenticatedSetCookie, /; HttpOnly; SameSite=Lax; Path=\/; Max-Age=1800$/u);
    assert.doesNotMatch(first.preAuthSetCookie, /Domain=|Secure/u);
    assert.doesNotMatch(first.authenticatedSetCookie, /Domain=|Secure/u);
    assert.equal(first.loginBody.sessionRotated, true);

    const oldSession = await fetch(`${origin}/api/lessons/03/me`, {
      headers: scenarioHeaders(scenarioId, { cookie: first.preAuthCookie }),
    });
    const currentSession = await fetch(`${origin}/api/lessons/03/me`, {
      headers: scenarioHeaders(scenarioId, { cookie: first.authenticatedCookie }),
    });
    assert.equal(oldSession.status, 403);
    assert.equal(oldSession.headers.get('www-authenticate'), null);
    assert.equal(currentSession.status, 200);

    const observationResponse = await fetch(`${origin}/__course/lessons/03/observe`, {
      headers: scenarioHeaders(scenarioId),
    });
    const observationText = await observationResponse.text();
    const token = first.authenticatedCookie.split('=')[1];
    const fullDigest = createHash('sha256').update(token, 'ascii').digest('hex');
    assert.equal(observationText.includes(token), false);
    assert.equal(observationText.includes(fullDigest), false);
    const observation = JSON.parse(observationText);
    assert.equal(observation.implementation.serverStorage, 'sha-256-token-digest-only');
    assert.equal(observation.cookie.httpOnly, true);
    assert.equal(observation.cookie.secure, false);
    assert.equal(observation.cookie.transportContext, 'loopback-http-training-deviation');

    const revoked = await fetch(`${origin}/__course/lessons/03/revoke-subject`, jsonRequest(scenarioId, {
      subjectId: 'user-alice',
    }));
    assert.equal(revoked.status, 200);
    assert.equal((await revoked.json()).revokedCount, 1);
    assert.equal((await fetch(`${origin}/api/lessons/03/me`, {
      headers: scenarioHeaders(scenarioId, { cookie: first.authenticatedCookie }),
    })).status, 403);
    const repeatedRevoke = await fetch(`${origin}/__course/lessons/03/revoke-subject`, jsonRequest(scenarioId, {
      subjectId: 'user-alice',
    }));
    assert.equal((await repeatedRevoke.json()).revokedCount, 0);

    const second = await loginLesson03(origin, scenarioId);
    const logout = await fetch(`${origin}/api/lessons/03/logout`, {
      method: 'POST',
      headers: scenarioHeaders(scenarioId, { cookie: second.authenticatedCookie }),
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/u);
    assert.equal((await fetch(`${origin}/api/lessons/03/me`, {
      headers: scenarioHeaders(scenarioId, { cookie: second.authenticatedCookie }),
    })).status, 403);
    assert.equal((await fetch(`${origin}/api/lessons/03/logout`, {
      method: 'POST', headers: scenarioHeaders(scenarioId, { cookie: 'course_session=malformed' }),
    })).status, 204);

    const third = await loginLesson03(origin, scenarioId);
    const clock = await fetch(`${origin}/__course/lessons/03/clock`, jsonRequest(scenarioId, {
      timestampMs: third.loginBody.expiresAt,
    }));
    assert.equal(clock.status, 200);
    assert.equal((await fetch(`${origin}/api/lessons/03/me`, {
      headers: scenarioHeaders(scenarioId, { cookie: third.authenticatedCookie }),
    })).status, 403);

    const malformed = await fetch(`${origin}/api/lessons/03/me`, {
      headers: scenarioHeaders(scenarioId, { cookie: 'course_session=not-a-token' }),
    });
    assert.equal(malformed.status, 403);
    assert.equal((await malformed.json()).code, 'SESSION_UNAVAILABLE');

    const rejectedPreAuth = await fetch(`${origin}/api/lessons/03/pre-auth`, {
      method: 'POST', headers: scenarioHeaders(scenarioId),
    });
    const rejectedCookie = rejectedPreAuth.headers.get('set-cookie').split(';', 1)[0];
    const wrongLoginRequest = () => fetch(`${origin}/api/lessons/03/login`, jsonRequest(
      scenarioId,
      { identifier: 'alice@example.com', password: 'wrong password' },
      { cookie: rejectedCookie },
    ));
    const firstWrong = await wrongLoginRequest();
    const secondWrong = await wrongLoginRequest();
    const rateLimited = await wrongLoginRequest();
    assert.equal(firstWrong.status, 422);
    assert.equal(secondWrong.status, 422);
    assert.equal(firstWrong.headers.get('www-authenticate'), null);
    assert.equal(rateLimited.status, 429);
    assert.equal(rateLimited.headers.get('retry-after'), '30');
    assert.equal(rateLimited.headers.get('www-authenticate'), null);

    assert.equal((await fetch(`${origin}/__course/lessons/03/scenarios`, {
      method: 'DELETE', headers: scenarioHeaders(scenarioId),
    })).status, 204);
  } finally {
    await close(server);
  }
});
