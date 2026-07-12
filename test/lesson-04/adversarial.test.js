import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLesson04ProjectCore } from '../../services/project-core/index.mjs';

function deletion(core, principal, resourceId = 'p-100', extraInput = {}) {
  return core.deleteProject({ principal, resourceId, ...extraInput });
}

test('caller-supplied tenant and role cannot elevate Bob, Carol, or Dave', () => {
  const bobCore = createLesson04ProjectCore();
  const carolCore = createLesson04ProjectCore();
  const daveCore = createLesson04ProjectCore();

  assert.equal(deletion(bobCore, {
    id: 'user-200',
    tenantId: 't-200',
    role: 'owner',
  }).status, 403);
  assert.equal(deletion(carolCore, {
    id: 'user-300',
    tenantId: 't-100',
    role: 'owner',
  }).status, 404);
  assert.equal(deletion(daveCore, {
    id: 'user-400',
    tenantId: 't-100',
    role: 'owner',
  }).status, 404);

  assert.deepEqual(bobCore.observe().state.projects.map(({ id }) => id), ['p-100']);
  assert.deepEqual(carolCore.observe().state.projects.map(({ id }) => id), ['p-100']);
  assert.deepEqual(daveCore.observe().state.projects.map(({ id }) => id), ['p-100']);
});

test('outsider, other tenant, unknown subject, and missing resource have one 404 surface', () => {
  const cases = [
    [{ id: 'user-300' }, 'p-100'],
    [{ id: 'user-400' }, 'p-100'],
    [{ id: 'user-999' }, 'p-100'],
    [{ id: 'user-300' }, 'p-999'],
    [{ id: 'user-400' }, 'p-999'],
  ];
  const results = cases.map(([principal, resourceId]) => (
    deletion(createLesson04ProjectCore(), principal, resourceId)
  ));

  for (const result of results) assert.deepEqual(result, results[0]);
  assert.deepEqual(results[0], {
    ok: false,
    status: 404,
    code: 'PROJECT_NOT_FOUND',
    message: 'Project not found.',
  });
});

test('audit entries retain only the six policy fields and omit presented secrets and spoofed claims', () => {
  const core = createLesson04ProjectCore();
  const secrets = [
    'credential-value-04',
    'session-token-value-04',
    'control-secret-value-04',
    'alice@example.com',
    't-200',
    'owner',
  ];
  deletion(core, {
    id: 'user-200',
    tenantId: 't-200',
    role: 'owner',
    identifier: 'alice@example.com',
    credential: 'credential-value-04',
    sessionToken: 'session-token-value-04',
    controlSecret: 'control-secret-value-04',
  }, 'p-100', {
    credential: 'credential-value-04',
    sessionToken: 'session-token-value-04',
    controlSecret: 'control-secret-value-04',
  });

  const audit = core.readAudit();
  assert.deepEqual(Object.keys(audit.entries[0]).sort(), [
    'action',
    'decision',
    'reason',
    'resource',
    'status',
    'subject',
  ]);
  const serialized = JSON.stringify(audit);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false);
});

test('audit retention is bounded and deterministically drops the oldest decisions', () => {
  const core = createLesson04ProjectCore({ maxAuditEntries: 2 });
  deletion(core, { id: 'user-200' });
  deletion(core, { id: 'user-300' });
  deletion(core, { id: 'user-400' });
  deletion(core, { id: 'user-200' });
  deletion(core, { id: 'user-300' });

  assert.deepEqual(core.readAudit(), {
    maxEntries: 2,
    retainedEntryCount: 2,
    droppedEntryCount: 3,
    entries: [
      {
        subject: 'user-200',
        resource: 'p-100',
        action: 'project:delete',
        decision: 'deny',
        status: 403,
        reason: 'insufficient-project-role',
      },
      {
        subject: 'user-300',
        resource: 'p-100',
        action: 'project:delete',
        decision: 'deny',
        status: 404,
        reason: 'resource-concealed',
      },
    ],
  });
});

test('malformed identifiers are rejected before policy, mutation, or audit', () => {
  const core = createLesson04ProjectCore();
  for (const input of [
    { principal: { id: 'user-100' }, resourceId: 'p-100?credential=secret' },
    { principal: { id: 'user-100\ncredential=secret' }, resourceId: 'p-100' },
    { principal: { id: '__proto__' }, resourceId: 'p-100' },
  ]) {
    assert.throws(() => core.deleteProject(input), /canonical identifier/u);
  }
  assert.deepEqual(core.observe().state.projects.map(({ id }) => id), ['p-100']);
  assert.equal(core.readAudit().retainedEntryCount, 0);
});

test('observations are detached copies and cannot mutate authoritative state', () => {
  const core = createLesson04ProjectCore();
  const observation = core.observe();
  observation.state.projects.splice(0);
  observation.state.audit.entries.push({ subject: 'user-100' });

  assert.deepEqual(core.observe().state.projects.map(({ id }) => id), ['p-100']);
  assert.equal(core.readAudit().retainedEntryCount, 0);
});
