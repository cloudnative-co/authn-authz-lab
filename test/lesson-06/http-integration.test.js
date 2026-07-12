import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';

const shutdownToken = 'A'.repeat(43);

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function createScenario(origin, lessonId) {
  const response = await fetch(`${origin}/__course/lessons/${lessonId}/scenarios`, { method: 'POST' });
  assert.equal(response.status, 201);
  return response.headers.get('x-course-scenario-id');
}

test('directory login uses generic 422 without an HTTP challenge while Basic keeps 401 challenge', async (t) => {
  const generic = Object.freeze({
    ok: false,
    status: 422,
    code: 'DIRECTORY_AUTH_FAILED',
    message: 'Directory authentication failed.',
  });
  const server = createProjectAppServer({
    identity: {
      pid: process.pid,
      installId: 'a'.repeat(32),
      runId: 'lesson06-http-test',
      instanceId: `${'a'.repeat(32)}.lesson06-http-test`,
    },
    shutdownToken,
    lesson06ScenarioFactory: async () => ({
      service: {
        authenticate: async () => generic,
        observe: () => ({ schemaVersion: 1, lessonId: '06' }),
      },
    }),
    lesson05ScenarioFactory: async () => ({
      service: {
        authenticateAuthorization: async () => ({
          ok: false,
          status: 401,
          code: 'BASIC_AUTH_REQUIRED',
          message: 'Authentication required.',
          headers: { 'www-authenticate': 'Basic realm="lesson-05", charset="UTF-8"' },
        }),
        observe: () => ({ schemaVersion: 1, lessonId: '05' }),
      },
    }),
  });
  t.after(() => server.close());
  const origin = await listen(server);
  const lesson06 = await createScenario(origin, '06');
  for (const input of [
    { identifier: 'alice@example.com', password: 'wrong' },
    { identifier: 'unknown@example.com', password: 'wrong' },
    { identifier: 'alice@example.com', password: '' },
    { identifier: '*)(uid=*', password: 'wrong' },
  ]) {
    const response = await fetch(`${origin}/api/lessons/06/directory/authenticate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-course-scenario-id': lesson06,
      },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 422);
    assert.equal(response.headers.get('www-authenticate'), null);
    assert.deepEqual(await response.json(), generic);
  }

  const lesson05 = await createScenario(origin, '05');
  const basic = await fetch(`${origin}/api/lessons/05/basic/me`, {
    headers: { 'x-course-scenario-id': lesson05 },
  });
  assert.equal(basic.status, 401);
  assert.equal(basic.headers.get('www-authenticate'), 'Basic realm="lesson-05", charset="UTF-8"');
});
