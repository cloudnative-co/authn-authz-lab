import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  authenticateDirectoryLogin,
  LESSON_08_SUCCESSFUL_LOGIN_OPERATIONS,
} from '../../docker/samba-ad/app/directory-login-flow.mjs';

const PRINCIPAL = 'alice@AD.EXAMPLE.TEST';
const PASSWORD = 'runtime-only-password-for-lesson-08';

function fixture({ user = { dn: 'CN=Alice', disabled: false }, rejectPassword = false } = {}) {
  const calls = [];
  return {
    calls,
    operations: {
      async bindService() {
        calls.push('service-bind');
      },
      async searchUser(principal) {
        calls.push(`user-search:${principal}`);
        return user;
      },
      async bindResolvedUser(dn, password) {
        calls.push(`user-bind:${dn}`);
        if (password !== PASSWORD || rejectPassword) throw new Error('invalid credentials');
      },
      async searchGroups(dn) {
        calls.push(`group-search:${dn}`);
        return ['CourseAppViewer', 'Engineering'];
      },
      mapRoles(groups) {
        calls.push(`map:${groups.join(',')}`);
        return ['viewer'];
      },
    },
  };
}

test('successful login fixes the actual bind-search-bind-search order', async () => {
  const harness = fixture();
  const result = await authenticateDirectoryLogin({
    principal: PRINCIPAL,
    password: PASSWORD,
    ...harness.operations,
  });

  assert.equal(result.authenticated, true);
  assert.deepEqual(result.operations, LESSON_08_SUCCESSFUL_LOGIN_OPERATIONS);
  assert.deepEqual(harness.calls, [
    'service-bind',
    `user-search:${PRINCIPAL}`,
    'user-bind:CN=Alice',
    'group-search:CN=Alice',
    'map:CourseAppViewer,Engineering',
  ]);
  assert.deepEqual(result.state.roles, ['viewer']);
});

test('wrong or unknown credentials never progress to group search', async () => {
  const wrong = fixture({ rejectPassword: true });
  const wrongResult = await authenticateDirectoryLogin({
    principal: PRINCIPAL,
    password: PASSWORD,
    ...wrong.operations,
  });
  assert.equal(wrongResult.authenticated, false);
  assert.deepEqual(wrong.calls, [
    'service-bind',
    `user-search:${PRINCIPAL}`,
    'user-bind:CN=Alice',
  ]);

  const unknown = fixture({ user: null });
  const unknownResult = await authenticateDirectoryLogin({
    principal: 'unknown@AD.EXAMPLE.TEST',
    password: PASSWORD,
    ...unknown.operations,
  });
  assert.equal(unknownResult.authenticated, false);
  assert.deepEqual(unknown.calls, [
    'service-bind',
    'user-search:unknown@AD.EXAMPLE.TEST',
  ]);
});

test('empty input is rejected before any directory operation', async () => {
  const harness = fixture();
  const result = await authenticateDirectoryLogin({
    principal: '',
    password: '',
    ...harness.operations,
  });
  assert.equal(result.authenticated, false);
  assert.deepEqual(result.operations, []);
  assert.deepEqual(harness.calls, []);
});
