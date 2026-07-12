import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { lesson10AnswerKey } from '../../course/lessons/10/assessment.mjs';
import { lesson11AnswerKey } from '../../course/lessons/11/assessment.mjs';
import { stopOwnedProcess } from '../../course/runner/process.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function createFixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-lesson-10-11-e2e-'));
  for (const entry of [
    'apps', 'course', 'curriculum', 'docker', 'packages', 'scripts', 'services', 'test', 'test-integration',
  ]) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry), { recursive: true });
  }
  for (const entry of ['README.md', 'course.mjs', 'course-lock.json', 'package.json', 'package-lock.json']) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry));
  }
  await symlink(resolve(repositoryRoot, 'node_modules'), resolve(root, 'node_modules'), 'dir');
  return root;
}

async function command(root, arguments_) {
  const child = spawn(process.execPath, ['course.mjs', ...arguments_, '--json'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const [exitCode, signal] = await once(child, 'exit');
  assert.equal(signal, null);
  assert.equal(Buffer.concat(stderr).toString('utf8'), '');
  return { exitCode, result: JSON.parse(Buffer.concat(stdout).toString('utf8')) };
}

async function currentProcess(root) {
  const base = resolve(root, '.lab/processes/oauth-lab');
  const pointer = JSON.parse(await readFile(resolve(base, 'current.json'), 'utf8'));
  const generation = resolve(base, 'generations', pointer.generationId);
  return {
    pointer,
    record: JSON.parse(await readFile(resolve(generation, 'record.json'), 'utf8')),
    control: JSON.parse(await readFile(resolve(generation, 'control.json'), 'utf8')),
  };
}

async function emergencyStop(root) {
  try {
    const current = await currentProcess(root);
    if (current.record.status !== 'running' || current.control.status !== 'active') return;
    await stopOwnedProcess({
      record: current.record,
      shutdownToken: current.control.shutdownToken,
      timeoutMs: 2_000,
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function filesBelow(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files;
}

async function assertNoSensitiveEvidence(root) {
  const files = [];
  for (const directory of ['submissions', 'evidence', 'journal', 'logs']) {
    files.push(...await filesBelow(resolve(root, '.lab', directory)));
  }
  const persisted = (await Promise.all(files.map((path) => readFile(path, 'utf8')))).join('\n');
  for (const forbidden of [
    'course-password-for-oauth-lab',
    'x-course-control-token',
    'x-course-scenario-id',
    'course_as_session=',
    'course_rp_session=',
    '"access_token"',
    '"id_token"',
    '"code_verifier"',
  ]) assert.equal(persisted.includes(forbidden), false, `persisted forbidden value: ${forbidden}`);
  assert.doesNotMatch(persisted, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u);
}

test('Lesson 10 and 11 complete the documented course.mjs lifecycle over one owned three-origin lab', async () => {
  const root = await createFixture();
  try {
    const doctor = await command(root, ['doctor']);
    assert.equal(doctor.result.status, 'pass', JSON.stringify(doctor.result));
    const setup = await command(root, ['setup']);
    assert.equal(setup.result.status, 'pass', JSON.stringify(setup.result));

    for (const [lessonId, answerKey] of [
      ['10', lesson10AnswerKey],
      ['11', lesson11AnswerKey],
    ]) {
      for (const action of ['doctor', 'setup', 'demo', 'observe']) {
        const outcome = await command(root, ['lesson', lessonId, action]);
        assert.equal(outcome.result.status, 'pass', `${lessonId} ${action}: ${JSON.stringify(outcome.result)}`);
      }
      const current = await currentProcess(root);
      assert.equal(current.record.resourceId, 'oauth-lab');
      const health = await Promise.all([4100, 4101, 4102].map(async (port) => (
        (await fetch(`http://127.0.0.1:${port}/__course/health`)).json()
      )));
      assert.deepEqual(health.map(({ pid }) => pid), [
        current.record.pid, current.record.pid, current.record.pid,
      ]);
      assert.deepEqual(health.map(({ instanceId }) => instanceId), [
        current.record.instanceId, current.record.instanceId, current.record.instanceId,
      ]);

      const incomplete = await command(root, ['lesson', lessonId, 'check']);
      assert.equal(incomplete.exitCode, 10);
      assert.equal(incomplete.result.reasonCode, `CHECK_LESSON${lessonId}_SUBMISSION_INVALID`);
      await writeFile(
        resolve(root, `.lab/submissions/${lessonId}/submission.json`),
        `${JSON.stringify(answerKey(), null, 2)}\n`,
      );
      const first = await command(root, ['lesson', lessonId, 'check']);
      const second = await command(root, ['lesson', lessonId, 'check']);
      assert.equal(first.result.status, 'pass');
      assert.equal(second.result.status, 'pass');
      assert.deepEqual(first.result.checkIds, [`AA${lessonId}-C1`, `AA${lessonId}-C2`]);
      assert.notEqual(first.result.evidenceId, second.result.evidenceId);
      assert.equal((await command(root, ['lesson', lessonId, 'stop'])).result.status, 'pass');
    }

    await assertNoSensitiveEvidence(root);
    assert.equal((await command(root, ['lesson', '11', 'setup'])).result.status, 'pass');
    const beforeReset = await currentProcess(root);
    assert.equal((await command(root, ['lesson', '11', 'reset'])).result.status, 'pass');
    const afterReset = await currentProcess(root);
    assert.notEqual(afterReset.pointer.generationId, beforeReset.pointer.generationId);
    assert.match(await readFile(resolve(root, '.lab/submissions/11/submission.json'), 'utf8'), /TODO/u);
    const purged = await command(root, ['lesson', '11', 'purge', '--yes']);
    assert.equal(purged.result.status, 'pass', JSON.stringify(purged.result));
    assert.equal(purged.result.diagnostics.find(({ id }) => id === 'resources.remaining').actual, '0');
    await assert.rejects(lstat(resolve(root, '.lab')), (error) => error.code === 'ENOENT');
  } finally {
    await emergencyStop(root);
    await rm(root, { recursive: true, force: true });
  }
});
