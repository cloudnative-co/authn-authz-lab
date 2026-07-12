import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';

const identity = Object.freeze({
  pid: process.pid,
  installId: 'install-lesson04-http',
  runId: 'run-lesson04-http',
  instanceId: 'install-lesson04-http.run-lesson04-http',
});
const shutdownToken = Buffer.alloc(32, 4).toString('base64url');

function scenarioHeaders(scenarioId, headers = {}) {
  return { 'x-course-scenario-id': scenarioId, ...headers };
}

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

async function createScenario(origin) {
  const response = await fetch(`${origin}/__course/lessons/04/scenarios`, { method: 'POST' });
  assert.equal(response.status, 201);
  return response.headers.get('x-course-scenario-id');
}

async function login(origin, scenarioId, identifier, password) {
  const preAuth = await fetch(`${origin}/api/lessons/04/pre-auth`, {
    method: 'POST', headers: scenarioHeaders(scenarioId),
  });
  assert.equal(preAuth.status, 201);
  const preAuthCookie = preAuth.headers.get('set-cookie').split(';', 1)[0];
  const response = await fetch(`${origin}/api/lessons/04/login`, {
    method: 'POST',
    headers: scenarioHeaders(scenarioId, {
      'content-type': 'application/json', cookie: preAuthCookie,
    }),
    body: JSON.stringify({ identifier, password }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';', 1)[0];
  assert.notEqual(cookie, preAuthCookie);
  return cookie;
}

async function remove(origin, scenarioId, resourceId, cookie, headers = {}) {
  return fetch(`${origin}/api/lessons/04/projects/${resourceId}`, {
    method: 'DELETE',
    headers: scenarioHeaders(scenarioId, { ...(cookie ? { cookie } : {}), ...headers }),
  });
}

test('Lesson 04 enforces Cookie session at the PEP and resource policy in project-core', async () => {
  const { server, origin } = await listen();
  try {
    const scenarioId = await createScenario(origin);

    const anonymous = await remove(origin, scenarioId, 'p-100');
    assert.equal(anonymous.status, 403);
    assert.equal(anonymous.headers.get('www-authenticate'), null);
    assert.equal((await anonymous.json()).code, 'SESSION_UNAVAILABLE');

    const bob = await login(
      origin, scenarioId, 'bob.04@example.test', 'bob-password-for-lesson-04',
    );
    const viewer = await remove(origin, scenarioId, 'p-100', bob, {
      'x-principal-id': 'user-100', 'x-project-role': 'owner',
    });
    assert.equal(viewer.status, 403);
    assert.deepEqual(await viewer.json(), {
      ok: false, status: 403, code: 'PROJECT_DELETE_FORBIDDEN', message: 'Forbidden.',
    });

    const carol = await login(
      origin, scenarioId, 'carol.04@example.test', 'carol-password-for-lesson-04',
    );
    const dave = await login(
      origin, scenarioId, 'dave.04@example.test', 'dave-password-for-lesson-04',
    );
    const concealed = await Promise.all([
      remove(origin, scenarioId, 'p-100', carol),
      remove(origin, scenarioId, 'p-100', dave),
      remove(origin, scenarioId, 'p-999', carol),
    ]);
    const concealedBodies = await Promise.all(concealed.map((response) => response.json()));
    assert.deepEqual(concealed.map(({ status }) => status), [404, 404, 404]);
    assert.deepEqual(concealedBodies, Array(3).fill({
      ok: false, status: 404, code: 'PROJECT_NOT_FOUND', message: 'Project not found.',
    }));

    const alice = await login(
      origin, scenarioId, 'alice.04@example.test', 'alice-password-for-lesson-04',
    );
    const allowed = await remove(origin, scenarioId, 'p-100', alice);
    assert.equal(allowed.status, 204);
    assert.equal(await allowed.text(), '');
    assert.equal((await remove(origin, scenarioId, 'p-100', alice)).status, 404);

    const observedResponse = await fetch(`${origin}/__course/lessons/04/observe`, {
      headers: scenarioHeaders(scenarioId),
    });
    const observedText = await observedResponse.text();
    const observed = JSON.parse(observedText);
    assert.deepEqual(observed.state.projects, []);
    assert.equal(observed.audit.retainedEntryCount, 6);
    assert.deepEqual(observed.audit.entries.map(({ status }) => status), [403, 404, 404, 404, 204, 404]);
    for (const secret of [
      bob,
      carol,
      dave,
      alice,
      'bob.04@example.test',
      'bob-password-for-lesson-04',
    ]) assert.equal(observedText.includes(secret), false);

    assert.equal((await fetch(`${origin}/__course/lessons/04/scenarios`, {
      method: 'DELETE', headers: scenarioHeaders(scenarioId),
    })).status, 204);
  } finally {
    await close(server);
  }
});
