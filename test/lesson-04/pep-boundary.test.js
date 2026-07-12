import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildProjectCoreDeleteInput } from '../../apps/project-app/lessons/04/http-handler.mjs';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';

const identity = Object.freeze({
  pid: process.pid,
  installId: 'install-lesson04-pep',
  runId: 'run-lesson04-pep',
  instanceId: 'install-lesson04-pep.run-lesson04-pep',
});
const shutdownToken = Buffer.alloc(32, 4).toString('base64url');
const sessionToken = Buffer.alloc(32, 7).toString('base64url');

async function listen(options) {
  const server = createProjectAppServer({ identity, shutdownToken, ...options });
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

test('Lesson 04 PEP passes only principal id and resource id to project-core', () => {
  const input = buildProjectCoreDeleteInput({
    principal: {
      id: 'user-100',
      identifier: 'alice.04@example.test',
      roles: ['untrusted-caller-role'],
      tenantId: 'untrusted-caller-tenant',
      authenticationContext: { secret: 'must-not-cross-boundary' },
    },
    resourceId: 'p-100',
  });

  assert.deepEqual(input, {
    principal: { id: 'user-100' },
    resourceId: 'p-100',
  });
  assert.deepEqual(Object.keys(input), ['principal', 'resourceId']);
  assert.deepEqual(Object.keys(input.principal), ['id']);
  assert.equal(Object.isFrozen(input), true);
  assert.equal(Object.isFrozen(input.principal), true);
});

test('Lesson 04 PEP rejects a missing session principal before project-core', () => {
  assert.throws(
    () => buildProjectCoreDeleteInput({ resourceId: 'p-100' }),
    /principal is required/u,
  );
});

test('Lesson 04 HTTP handler wires only the reduced principal into project-core', async () => {
  const received = [];
  const richPrincipal = Object.freeze({
    id: 'user-100',
    identifier: 'alice.04@example.test',
    roles: Object.freeze(['untrusted-caller-role']),
    tenantId: 'untrusted-caller-tenant',
    authenticationContext: Object.freeze({ secret: 'must-not-cross-boundary' }),
  });
  const lesson04ScenarioFactory = async () => Object.freeze({
    sessionService: Object.freeze({
      currentUser: () => Object.freeze({ ok: true, principal: richPrincipal }),
    }),
    projectCore: Object.freeze({
      deleteProject(input) {
        received.push(input);
        return Object.freeze({ status: 204 });
      },
    }),
  });
  const { server, origin } = await listen({ lesson04ScenarioFactory });
  try {
    const created = await fetch(`${origin}/__course/lessons/04/scenarios`, { method: 'POST' });
    assert.equal(created.status, 201);
    const scenarioId = created.headers.get('x-course-scenario-id');

    const deleted = await fetch(`${origin}/api/lessons/04/projects/p-100`, {
      method: 'DELETE',
      headers: {
        cookie: `course04_session=${sessionToken}`,
        'x-course-scenario-id': scenarioId,
      },
    });
    assert.equal(deleted.status, 204);
    assert.deepEqual(received, [{ principal: { id: 'user-100' }, resourceId: 'p-100' }]);
    assert.equal(JSON.stringify(received).includes('alice.04@example.test'), false);
    assert.equal(JSON.stringify(received).includes('must-not-cross-boundary'), false);
  } finally {
    await close(server);
  }
});
