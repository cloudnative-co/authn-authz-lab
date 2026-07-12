import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { lesson15AnswerKey } from '../../course/lessons/15/assessment.mjs';
import { stopOwnedProcess } from '../../course/runner/process.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function fixtureRepository() {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-lesson-15-e2e-'));
  for (const entry of [
    'apps', 'course', 'curriculum', 'docker', 'packages', 'scripts', 'services', 'test', 'test-integration',
  ]) await cp(resolve(repositoryRoot, entry), resolve(root, entry), { recursive: true });
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
    record: JSON.parse(await readFile(resolve(generation, 'record.json'), 'utf8')),
    control: JSON.parse(await readFile(resolve(generation, 'control.json'), 'utf8')),
  };
}

async function emergencyStop(root) {
  try {
    const current = await currentProcess(root);
    if (current.record.status === 'running' && current.control.status === 'active') {
      await stopOwnedProcess({
        record: current.record, shutdownToken: current.control.shutdownToken, timeoutMs: 2_000,
      });
    }
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

test('Lesson 15 completes the documented course lifecycle with fresh JWT and policy checks', async () => {
  const root = await fixtureRepository();
  try {
    assert.equal((await command(root, ['doctor'])).result.status, 'pass');
    assert.equal((await command(root, ['setup'])).result.status, 'pass');
    for (const action of ['doctor', 'setup', 'demo', 'observe']) {
      const outcome = await command(root, ['lesson', '15', action]);
      assert.equal(outcome.result.status, 'pass', `${action}: ${JSON.stringify(outcome.result)}`);
    }
    const incomplete = await command(root, ['lesson', '15', 'check']);
    assert.equal(incomplete.exitCode, 10);
    assert.equal(incomplete.result.reasonCode, 'CHECK_LESSON15_SUBMISSION_INVALID');
    await writeFile(
      resolve(root, '.lab/submissions/15/submission.json'),
      `${JSON.stringify(lesson15AnswerKey(), null, 2)}\n`,
    );
    const first = await command(root, ['lesson', '15', 'check']);
    const second = await command(root, ['lesson', '15', 'check']);
    assert.equal(first.result.status, 'pass', JSON.stringify(first.result));
    assert.equal(second.result.status, 'pass', JSON.stringify(second.result));
    assert.deepEqual(first.result.checkIds, ['AA15-C1', 'AA15-C2', 'AA15-C3']);
    assert.notEqual(first.result.evidenceId, second.result.evidenceId);

    const files = [];
    for (const directory of ['submissions', 'evidence', 'journal', 'logs']) {
      files.push(...await filesBelow(resolve(root, '.lab', directory)));
    }
    const persisted = (await Promise.all(files.map((path) => readFile(path, 'utf8')))).join('\n');
    for (const forbidden of [
      'course-password-for-oauth-lab', 'x-course-control-token', 'x-course-scenario-id',
      'course_as_session=', 'course_rp_session=', '"access_token"', '"code_verifier"',
    ]) assert.equal(persisted.includes(forbidden), false, forbidden);
    assert.doesNotMatch(persisted, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u);
    assert.equal((await command(root, ['lesson', '15', 'stop'])).result.status, 'pass');
  } finally {
    await emergencyStop(root);
    await rm(root, { recursive: true, force: true });
  }
});
