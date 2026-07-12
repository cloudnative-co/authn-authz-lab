import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLesson01Exercise } from '../../course/lessons/01/domain.mjs';
import { createLesson04ProjectCore } from '../../services/project-core/index.mjs';
import { createProjectCoreStore } from '../../services/project-core/store.mjs';

function deletion(core, subjectId, resourceId = 'p-100', principalOverrides = {}) {
  return core.deleteProject({
    principal: { id: subjectId, ...principalOverrides },
    resourceId,
  });
}

test('the continuing scenario is seeded with one tenant-owned project and authoritative roles', () => {
  const core = createLesson04ProjectCore();
  const observation = core.observe();

  assert.equal(observation.lessonId, '04');
  assert.deepEqual(observation.state.projects, [{
    id: 'p-100',
    tenantId: 't-100',
    name: 'Mini Project',
    members: [
      { subjectId: 'user-100', role: 'owner' },
      { subjectId: 'user-200', role: 'viewer' },
    ],
  }]);
  assert.equal(observation.implementation.policyDecisionPoint, 'project-core');
  assert.equal(observation.implementation.policyEnforcementPoint, 'project-app');
  assert.equal(observation.state.audit.retainedEntryCount, 0);
});

test('runtime outcomes preserve the Lesson 01 trace-05 and trace-06 status contract', () => {
  const traces = new Map(getLesson01Exercise().traces.map((trace) => [trace.id, trace]));
  const ownerResult = deletion(createLesson04ProjectCore(), 'user-100');
  const viewerResult = deletion(createLesson04ProjectCore(), 'user-200');

  assert.equal(traces.get('trace-05').response.outcome, 'operation-allowed');
  assert.equal(ownerResult.status, traces.get('trace-05').response.status);
  assert.equal(traces.get('trace-06').response.outcome, 'operation-denied');
  assert.equal(viewerResult.status, traces.get('trace-06').response.status);
});

test('Alice owner receives 204, the project is deleted, and the decision is audited', () => {
  const core = createLesson04ProjectCore();
  const result = deletion(core, 'user-100');

  assert.deepEqual(result, {
    ok: true,
    status: 204,
    code: 'PROJECT_DELETED',
  });
  assert.equal(result instanceof Promise, false);
  assert.deepEqual(core.observe().state.projects, []);
  assert.deepEqual(core.readAudit().entries, [{
    subject: 'user-100',
    resource: 'p-100',
    action: 'project:delete',
    decision: 'allow',
    status: 204,
    reason: 'project-owner',
  }]);
});

test('Bob viewer receives 403 without mutation and the denial is audited', () => {
  const core = createLesson04ProjectCore();
  const result = deletion(core, 'user-200');

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    code: 'PROJECT_DELETE_FORBIDDEN',
    message: 'Forbidden.',
  });
  assert.deepEqual(core.observe().state.projects.map(({ id }) => id), ['p-100']);
  assert.deepEqual(core.readAudit().entries[0], {
    subject: 'user-200',
    resource: 'p-100',
    action: 'project:delete',
    decision: 'deny',
    status: 403,
    reason: 'insufficient-project-role',
  });
});

test('a second delete is concealed as 404 and cannot repeat the mutation', () => {
  const core = createLesson04ProjectCore();
  assert.equal(deletion(core, 'user-100').status, 204);
  assert.deepEqual(deletion(core, 'user-100'), {
    ok: false,
    status: 404,
    code: 'PROJECT_NOT_FOUND',
    message: 'Project not found.',
  });
  assert.deepEqual(core.observe().state.projects, []);
  assert.deepEqual(core.readAudit().entries.map(({ status }) => status), [204, 404]);
});

test('project deletion and audit append roll back together when a transaction cannot audit', () => {
  const store = createProjectCoreStore();

  assert.throws(() => store.transact((transaction) => {
    assert.equal(transaction.deleteProject('p-100'), true);
    transaction.appendAudit({
      subject: 'user-100',
      resource: 'p-100',
      action: 'project:delete',
      decision: 'allow',
      status: 204,
      reason: 'credential=must-not-be-recorded',
    });
  }), /audit\.reason/u);
  assert.deepEqual(store.snapshot().projects.map(({ id }) => id), ['p-100']);
  assert.equal(store.auditSnapshot().retainedEntryCount, 0);

  assert.throws(() => store.transact((transaction) => {
    transaction.deleteProject('p-100');
  }), /exactly one audit entry/u);
  assert.deepEqual(store.snapshot().projects.map(({ id }) => id), ['p-100']);
});

test('commit rejects every mismatch between the audited decision and the project mutation', () => {
  const store = createProjectCoreStore({
    seed: {
      subjects: [
        { id: 'user-100', tenantId: 't-100', displayName: 'Alice' },
        { id: 'user-200', tenantId: 't-100', displayName: 'Bob' },
      ],
      projects: [
        {
          id: 'p-100',
          tenantId: 't-100',
          name: 'First Project',
          members: [{ subjectId: 'user-100', role: 'owner' }],
        },
        {
          id: 'p-200',
          tenantId: 't-100',
          name: 'Second Project',
          members: [{ subjectId: 'user-100', role: 'owner' }],
        },
      ],
    },
  });
  const allowAudit = (resource = 'p-100') => ({
    subject: 'user-100',
    resource,
    action: 'project:delete',
    decision: 'allow',
    status: 204,
    reason: 'project-owner',
  });
  const denyAudit = () => ({
    subject: 'user-200',
    resource: 'p-100',
    action: 'project:delete',
    decision: 'deny',
    status: 403,
    reason: 'insufficient-project-role',
  });
  const assertRolledBack = () => {
    assert.deepEqual(store.snapshot().projects.map(({ id }) => id), ['p-100', 'p-200']);
    assert.equal(store.auditSnapshot().retainedEntryCount, 0);
  };

  assert.throws(() => store.transact((transaction) => {
    transaction.appendAudit(allowAudit());
  }), /allowed project delete must mutate exactly one project/u);
  assertRolledBack();

  assert.throws(() => store.transact((transaction) => {
    transaction.deleteProject('p-100');
    transaction.appendAudit(denyAudit());
  }), /denied project delete must not mutate/u);
  assertRolledBack();

  assert.throws(() => store.transact((transaction) => {
    transaction.deleteProject('p-100');
    transaction.appendAudit(allowAudit('p-999'));
  }), /must mutate its audited resource/u);
  assertRolledBack();

  assert.throws(() => store.transact((transaction) => {
    transaction.deleteProject('p-100');
    transaction.deleteProject('p-200');
    transaction.appendAudit(allowAudit());
  }), /may mutate at most one project/u);
  assertRolledBack();

  assert.throws(() => store.transact((transaction) => {
    transaction.appendAudit({
      ...denyAudit(),
      decision: 'allow',
    });
  }), /audit\.decision does not match audit\.status/u);
  assertRolledBack();
});

test('a closed transaction draft cannot mutate committed state later', () => {
  const store = createProjectCoreStore();
  let captured;
  store.transact((transaction) => {
    captured = transaction;
    transaction.appendAudit({
      subject: 'user-200',
      resource: 'p-100',
      action: 'project:delete',
      decision: 'deny',
      status: 403,
      reason: 'insufficient-project-role',
    });
  });

  assert.throws(() => captured.deleteProject('p-100'), /draft is closed/u);
  assert.deepEqual(store.snapshot().projects.map(({ id }) => id), ['p-100']);
  assert.equal(store.auditSnapshot().retainedEntryCount, 1);
});

test('authentication is a PEP precondition and project-core never manufactures a 401', () => {
  const core = createLesson04ProjectCore();
  for (const principal of [null, undefined, {}, 'user-100']) {
    assert.throws(
      () => core.deleteProject({ principal, resourceId: 'p-100' }),
      /principal/u,
    );
  }
  assert.equal(core.readAudit().retainedEntryCount, 0);
  assert.deepEqual(core.observe().state.projects.map(({ id }) => id), ['p-100']);
  assert.deepEqual(Object.keys(core).sort(), ['deleteProject', 'observe', 'readAudit', 'reset']);
});

test('reset restores the seed and independent instances never share mutations or audit', () => {
  const first = createLesson04ProjectCore();
  const second = createLesson04ProjectCore();

  deletion(first, 'user-100');
  assert.deepEqual(first.observe().state.projects, []);
  assert.deepEqual(second.observe().state.projects.map(({ id }) => id), ['p-100']);
  assert.equal(second.readAudit().retainedEntryCount, 0);

  assert.deepEqual(first.reset(), {
    ok: true,
    status: 204,
    code: 'PROJECT_CORE_RESET',
  });
  assert.deepEqual(first.observe().state.projects.map(({ id }) => id), ['p-100']);
  assert.equal(first.readAudit().retainedEntryCount, 0);
});
