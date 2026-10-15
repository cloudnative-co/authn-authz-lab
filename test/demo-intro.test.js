import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runIntroDemo, validateIntroEvidence } from '../scripts/demo-intro.mjs';

function evidence() {
  return {
    schemaVersion: 1,
    lessonId: '04',
    evidenceBasis: 'project-app-runtime-http-cookie-project-core',
    runtimeEvidence: true,
    wireEvidence: true,
    enforcement: { principalSource: 'cookie-session', callerRoleHeadersAccepted: false },
    viewer: { status: 403, projectPresentAfter: true },
    owner: { status: 204, projectPresentAfter: false },
  };
}

function harness({ initial = { status: 'absent' }, failAt, runtime = evidence(), onCommand, stopStatus = 'pass' } = {}) {
  const calls = [];
  const stdout = { value: '', write(chunk) { this.value += chunk; } };
  const stderr = { value: '', write(chunk) { this.value += chunk; } };
  let current = initial;
  const dependencies = {
    async command(args) {
      const action = args.join(' ');
      calls.push(action);
      if (action === 'lesson 04 setup') {
        current = { status: 'running', record: { instanceId: 'installation.intro-run' } };
      }
      await onCommand?.(action);
      return {
        exitCode: failAt === action ? 20 : 0,
        result: {
          runId: 'intro-run',
          status: failAt === action ? 'blocked' : 'pass',
          reasonCode: failAt === action ? 'EXPECTED_FAILURE' : null,
          recovery: [],
        },
      };
    },
    async inspectProcess() { return current; },
    async readRuntime() { calls.push('read runtime'); return runtime; },
    async stopOwned(runId) {
      calls.push(`stop owned ${runId}`);
      if (stopStatus === 'pass') current = { status: 'stopped' };
      return { status: stopStatus, reasonCode: stopStatus === 'pass' ? null : 'OWNERSHIP_CHANGED' };
    },
  };
  return { calls, stdout, stderr, dependencies, current: () => current };
}

test('intro prints verified HTTP results only after its process has stopped', async () => {
  const setup = harness();
  assert.equal(await runIntroDemo(setup), 0);
  assert.deepEqual(setup.calls, [
    'doctor', 'setup', 'lesson 04 doctor', 'lesson 04 setup', 'lesson 04 demo',
    'read runtime', 'stop owned intro-run',
  ]);
  assert.equal(setup.current().status, 'stopped');
  assert.match(setup.stdout.value, /Bob: HTTP 403/u);
  assert.match(setup.stdout.value, /Alice: HTTP 204/u);
  assert.equal(setup.stderr.value, '');
  assert.ok(setup.stdout.value.indexOf('lesson 04 stop') < setup.stdout.value.indexOf('Bob:'));
});

test('intro refuses to reuse or stop an existing shared project-app', async () => {
  const setup = harness({ initial: { status: 'running', record: { instanceId: 'installation.other-run' } } });
  assert.equal(await runIntroDemo(setup), 1);
  assert.deepEqual(setup.calls, ['doctor', 'setup']);
  assert.equal(setup.current().status, 'running');
  assert.match(setup.stderr.value, /既存の project-app/u);
});

test('intro does not start a lesson when prerequisites fail', async () => {
  const setup = harness({ failAt: 'doctor' });
  assert.equal(await runIntroDemo(setup), 20);
  assert.deepEqual(setup.calls, ['doctor']);
});

for (const action of ['lesson 04 setup', 'lesson 04 demo']) {
  test(`intro cleans up an owned process after ${action} fails`, async () => {
    const setup = harness({ failAt: action });
    assert.equal(await runIntroDemo(setup), 20);
    assert.equal(setup.calls.at(-1), 'stop owned intro-run');
    assert.equal(setup.calls.includes('read runtime'), false);
    assert.equal(setup.current().status, 'stopped');
    assert.doesNotMatch(setup.stdout.value, /Bob:|完了しました/u);
  });
}

test('intro rejects stale-looking or non-HTTP evidence and still stops its process', async () => {
  const setup = harness({ runtime: { ...evidence(), wireEvidence: false } });
  assert.equal(await runIntroDemo(setup), 1);
  assert.equal(setup.current().status, 'stopped');
  assert.doesNotMatch(setup.stdout.value, /Bob:/u);
});

test('intro reports cleanup failure instead of claiming successful completion', async () => {
  const setup = harness({ stopStatus: 'blocked' });
  assert.equal(await runIntroDemo(setup), 1);
  assert.match(setup.stderr.value, /OWNERSHIP_CHANGED/u);
  assert.doesNotMatch(setup.stdout.value, /Bob:|停止済み/u);
});

test('intro stops its process when interrupted between commands', async () => {
  const controller = new AbortController();
  const setup = harness({ onCommand(action) { if (action === 'lesson 04 demo') controller.abort(); } });
  assert.equal(await runIntroDemo({ ...setup, signal: controller.signal }), 130);
  assert.equal(setup.current().status, 'stopped');
  assert.doesNotMatch(setup.stdout.value, /Bob:/u);
});

test('intro does not print success if interrupted while reading its evidence', async () => {
  const controller = new AbortController();
  const setup = harness();
  setup.dependencies.readRuntime = async () => { controller.abort(); return evidence(); };
  assert.equal(await runIntroDemo({ ...setup, signal: controller.signal }), 130);
  assert.equal(setup.current().status, 'stopped');
  assert.doesNotMatch(setup.stdout.value, /Bob:/u);
});

test('HTTP status alone cannot pass the intro evidence checks', () => {
  for (const mutate of [
    (runtime) => { runtime.lessonId = '01'; },
    (runtime) => { runtime.runtimeEvidence = false; },
    (runtime) => { runtime.evidenceBasis = 'provided-case'; },
    (runtime) => { runtime.enforcement.callerRoleHeadersAccepted = true; },
    (runtime) => { runtime.viewer.projectPresentAfter = false; },
    (runtime) => { runtime.owner.projectPresentAfter = true; },
    (runtime) => { runtime.owner.status = 200; },
  ]) {
    const runtime = evidence();
    mutate(runtime);
    assert.throws(() => validateIntroEvidence(runtime), /期待値/u);
  }
});
