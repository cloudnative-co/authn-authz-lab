import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ProcessControlError, readLinuxProcessMaterial, waitForOwnedProcessExit,
} from '../../course/runner/process.mjs';

const pid = 1234;
const support = { status: 'supported', profile: 'linux' };
const record = {
  pid, instanceId: 'test-install.exit-run', origin: 'http://127.0.0.1:65535',
  startFingerprint: `sha256:${'1'.repeat(64)}`,
};
const missing = () => Object.assign(new Error('missing proc file'), { code: 'ENOENT' });
const denied = () => Object.assign(new Error('permission denied'), { code: 'EACCES' });

function stat(state = 'S', starttime = '100') {
  return `${pid} (node (worker)) ${[state, ...Array(18).fill('0'), starttime, '0'].join(' ')}\n`;
}

function proc({ states = [stat(), stat()], command = Buffer.from('node\0app.mjs\0'), executable = '/usr/bin/node', boot = 'boot-id\n' } = {}) {
  let index = 0;
  let commandRead = false;
  const reads = [];
  const value = (item) => { if (item instanceof Error) throw item; return item; };
  return {
    reads,
    async readFile(path) {
      reads.push(path);
      if (path === `/proc/${pid}/stat`) return value(states[Math.min(index++, states.length - 1)]);
      if (path === '/proc/sys/kernel/random/boot_id') return value(boot);
      assert.equal(path, `/proc/${pid}/cmdline`);
      commandRead = true;
      return value(command);
    },
    async readlink(path) {
      assert.equal(commandRead, true, 'exe must be read after cmdline');
      reads.push(path);
      assert.equal(path, `/proc/${pid}/exe`);
      return value(executable);
    },
  };
}

test('Linux fingerprint material retains its format and brackets reads with process starttime', async () => {
  const reader = proc();
  assert.deepEqual(await readLinuxProcessMaterial(pid, 'linux', reader), {
    profile: 'linux', startedAt: 'boot-id:100', executable: '/usr/bin/node', arguments: ['node', 'app.mjs'],
  });
  assert.equal(reader.reads[0], `/proc/${pid}/stat`);
  assert.equal(reader.reads.at(-1), `/proc/${pid}/stat`);
});

test('an empty cmdline is recognized as exited only after stat proves zombie, dead, or absent', async () => {
  for (const after of [stat('Z'), stat('X'), missing()]) {
    for (const executable of ['/usr/bin/node', missing()]) {
      assert.equal(await readLinuxProcessMaterial(pid, 'linux', proc({
        states: [stat('S'), after], command: Buffer.alloc(0), executable,
      })), null);
    }
  }
  const zombie = proc({ states: [stat('Z')] });
  assert.equal(await readLinuxProcessMaterial(pid, 'linux', zombie), null);
  assert.deepEqual(zombie.reads, [`/proc/${pid}/stat`]);
});

test('a live process with empty cmdline or missing exe remains unverified', async () => {
  await assert.rejects(readLinuxProcessMaterial(pid, 'linux', proc({ command: Buffer.alloc(0) })),
    (error) => error.reasonCode === 'FINGERPRINT_COMMAND_LINE_EMPTY');
  await assert.rejects(readLinuxProcessMaterial(pid, 'linux', proc({ executable: missing() })),
    (error) => error.reasonCode === 'FINGERPRINT_PROCESS_MATERIAL_MISSING');
  await assert.rejects(readLinuxProcessMaterial(pid, 'linux', proc({ command: missing() })),
    (error) => error.reasonCode === 'FINGERPRINT_PROCESS_MATERIAL_MISSING');
});

test('Linux fingerprint rejects PID reuse, malformed stat, permissions, and missing global boot id', async () => {
  await assert.rejects(readLinuxProcessMaterial(pid, 'linux', proc({ states: [stat('S', '100'), stat('S', '101')] })),
    (error) => error.reasonCode === 'FINGERPRINT_RACE');
  for (const reader of [
    proc({ states: [stat(), 'invalid'] }), proc({ states: [stat(), denied()] }),
    proc({ executable: denied() }), proc({ command: denied() }), proc({ boot: missing() }), proc({ boot: '' }),
    proc({ command: missing(), executable: denied() }),
  ]) {
    await assert.rejects(readLinuxProcessMaterial(pid, 'linux', reader),
      (error) => error.reasonCode === 'FINGERPRINT_UNAVAILABLE');
  }
});

test('exit wait reobserves pre-zombie teardown and does not succeed until stat proves exit', async () => {
  const observations = [
    proc({ command: Buffer.alloc(0) }),
    proc({ command: Buffer.alloc(0), executable: missing() }),
    proc(),
    proc({ states: [stat('S'), stat('Z')], command: Buffer.alloc(0), executable: missing() }),
  ];
  let count = 0;
  const result = await waitForOwnedProcessExit({
    record, platformSupport: support, timeoutMs: 500, retryIntervalMs: 1,
    fingerprintCapture: async () => {
      const material = await readLinuxProcessMaterial(pid, 'linux', observations[count++]);
      return material === null ? null : record.startFingerprint;
    },
  });
  assert.deepEqual(result, { status: 'exited' });
  assert.equal(count, 4);
});

test('exit wait never treats persistent missing process material as proof of exit', async () => {
  let count = 0;
  assert.deepEqual(await waitForOwnedProcessExit({
    record, platformSupport: support, timeoutMs: 25, retryIntervalMs: 1,
    fingerprintCapture: async () => {
      count += 1;
      await readLinuxProcessMaterial(pid, 'linux', proc({ command: Buffer.alloc(0) }));
      assert.fail('live empty cmdline must not yield a fingerprint');
    },
  }), { status: 'blocked', reasonCode: 'PROCESS_FINGERPRINT_UNVERIFIABLE' });
  assert.ok(count >= 1);
});

test('exit wait immediately rejects permission or identity-read failures without retrying', async () => {
  for (const reasonCode of ['FINGERPRINT_UNAVAILABLE', 'FINGERPRINT_RACE']) {
    let count = 0;
    assert.deepEqual(await waitForOwnedProcessExit({
      record, platformSupport: support, timeoutMs: 500,
      fingerprintCapture: async () => { count += 1; throw new ProcessControlError(reasonCode, 'unverified'); },
    }), { status: 'blocked', reasonCode: 'PROCESS_FINGERPRINT_UNVERIFIABLE' });
    assert.equal(count, 1);
  }
});

test('exit wait respects cancellation while teardown cannot yet be proven', async () => {
  const controller = new AbortController();
  await assert.rejects(waitForOwnedProcessExit({
    record, platformSupport: support, timeoutMs: 500, signal: controller.signal,
    fingerprintCapture: async () => {
      controller.abort();
      throw new ProcessControlError('FINGERPRINT_COMMAND_LINE_EMPTY', 'unverified');
    },
  }), (error) => error.reasonCode === 'OPERATION_ABORTED');
});
