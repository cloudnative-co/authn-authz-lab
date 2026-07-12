import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLesson07ProtocolAdapter,
  Lesson07ProtocolError,
  lesson07ProtocolConstants,
} from '../../course/lessons/07/protocol-adapter.mjs';

const PASSWORD = 'lesson07-fake-password';

function result({ code = 0, stdout = '', stderr = '', signal = null } = {}) {
  return { code, stdout, stderr, signal };
}

test('kinit password is carried only by stdin and all commands use argv arrays', async () => {
  const calls = [];
  const adapter = createLesson07ProtocolAdapter({
    executeOwnedService: async (call) => {
      calls.push(call);
      return result();
    },
  });

  await adapter.acquireTgt(PASSWORD);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, ['kinit', 'alice@EXAMPLE.TEST']);
  assert.equal(calls[0].stdin, `${PASSWORD}\n`);
  assert.equal(calls[0].argv.some((value) => value.includes(PASSWORD)), false);
  assert.equal(calls[0].resourceId, 'kerberos-lab');
  assert.equal(calls[0].serviceName, 'client');
  assert.equal(calls[0].timeoutMs, lesson07ProtocolConstants.commandTimeoutMs);
  assert.equal(calls[0].maxOutputBytes, lesson07ProtocolConstants.commandOutputLimit);
  assert.deepEqual(calls[0].acceptedExitCodes, [0]);
});

test('invalid secrets are rejected before container execution', async () => {
  let called = false;
  const adapter = createLesson07ProtocolAdapter({
    executeOwnedService: async () => {
      called = true;
      return result();
    },
  });
  for (const password of ['', 'short', 'valid-password\nsecond', `valid-password\u0000tail`]) {
    await assert.rejects(() => adapter.acquireTgt(password), TypeError);
  }
  assert.equal(called, false);
});

test('command errors are fixed and never include captured output', async () => {
  const adapter = createLesson07ProtocolAdapter({
    executeOwnedService: async () => result({
      code: 1,
      stderr: `native detail ${PASSWORD}`,
    }),
  });
  await assert.rejects(
    () => adapter.acquireTgt(PASSWORD),
    (error) => error instanceof Lesson07ProtocolError
      && error.reasonCode === 'CONTAINER_COMMAND_FAILED'
      && !error.message.includes(PASSWORD),
  );
});

test('wrong SPN is classified at the TGS boundary without returning raw stderr', async () => {
  const adapter = createLesson07ProtocolAdapter({
    executeOwnedService: async ({ argv, acceptedExitCodes }) => {
      assert.deepEqual(argv, ['kvno', 'HTTP/missing.example.test@EXAMPLE.TEST']);
      assert.deepEqual(acceptedExitCodes, [0, 1]);
      return result({ code: 1, stderr: 'Server not found in Kerberos database' });
    },
  });
  assert.deepEqual(await adapter.requestWrongSpn(), {
    rejected: true,
    stage: 'TGS',
    reason: 'SERVICE_PRINCIPAL_UNKNOWN',
  });
});

test('keytab selector accepts only fixed roles', async () => {
  const calls = [];
  const adapter = createLesson07ProtocolAdapter({
    executeOwnedService: async (call) => {
      calls.push(call);
      return result();
    },
  });
  await adapter.selectKeytab('stale');
  assert.deepEqual(calls[0].argv, ['/usr/local/bin/keytab-select', 'stale']);
  await assert.rejects(() => adapter.selectKeytab('user-controlled'), TypeError);
});

test('clock offset is a fixed teaching case and signaled commands fail generically', async () => {
  const adapter = createLesson07ProtocolAdapter({
    executeOwnedService: async () => ({ code: null, signal: 'SIGTERM', stdout: '', stderr: '' }),
  });
  await assert.rejects(
    () => adapter.requestWithNegotiate({ clockOffset: '+1 year' }),
    TypeError,
  );
  await assert.rejects(
    () => adapter.requestWithNegotiate(),
    (error) => error instanceof Lesson07ProtocolError
      && error.reasonCode === 'CONTAINER_COMMAND_FAILED',
  );
});
