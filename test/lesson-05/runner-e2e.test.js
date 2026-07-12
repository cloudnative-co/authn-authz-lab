import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { cp, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  copyPortableCourseReferences,
  linkFixtureRuntimeDependencies,
} from '../course/portable-course-fixture.js';
import { lesson05AnswerKey } from '../../course/lessons/05/assessment.mjs';
import { runCli } from '../../course/runner/main.mjs';
import { stopOwnedProcess } from '../../course/runner/process.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = server.address();
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise());
  });
  return port;
}

async function createFixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-lesson-05-e2e-'));
  for (const entry of ['apps', 'course', 'curriculum', 'packages', 'scripts', 'services', 'test']) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry), { recursive: true });
  }
  for (const entry of ['README.md', 'course.mjs', 'course-lock.json', 'package.json', 'package-lock.json']) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry));
  }
  await copyPortableCourseReferences(repositoryRoot, root);
  await linkFixtureRuntimeDependencies(repositoryRoot, root);
  const manifestPath = resolve(root, 'curriculum/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.ports.find(({ id }) => id === 'project-app-http').port = await availablePort();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const packagePath = resolve(root, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  packageJson.dependencies = {};
  packageJson.devDependencies = {};
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(resolve(root, 'package-lock.json'), `${JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: packageJson.name,
        version: packageJson.version,
        dependencies: {},
        devDependencies: {},
        engines: packageJson.engines,
      },
    },
  }, null, 2)}\n`);
  return root;
}

function outputBuffer() {
  return { value: '', write(chunk) { this.value += String(chunk); } };
}

async function command(root, arguments_) {
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const exitCode = await runCli([...arguments_, '--json'], { repoRoot: root, stdout, stderr });
  assert.equal(stderr.value, '');
  return { exitCode, result: JSON.parse(stdout.value) };
}

async function currentProcess(root) {
  const base = resolve(root, '.lab/processes/project-app');
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

test('Lesson 05 runner completes a fresh Basic exchange and redacts credentials', async () => {
  const root = await createFixture();
  try {
    assert.equal((await command(root, ['doctor'])).result.status, 'pass');
    assert.equal((await command(root, ['setup'])).result.status, 'pass');
    for (const action of ['doctor', 'setup', 'demo', 'observe']) {
      assert.equal((await command(root, ['lesson', '05', action])).result.status, 'pass');
    }

    const runtimePath = resolve(root, '.lab/submissions/05/runtime.json');
    const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
    assert.equal(runtime.challenge.absentStatus, 401);
    assert.equal(runtime.challenge.header, 'Basic realm="lesson-05", charset="UTF-8"');
    assert.equal(runtime.success.status, 200);
    assert.equal(runtime.success.setCookieAbsent, true);
    assert.equal(runtime.success.nextRequestWithoutHeaderStatus, 401);
    assert.equal(runtime.safety.redacted, true);

    const incomplete = await command(root, ['lesson', '05', 'check']);
    assert.equal(incomplete.exitCode, 10);
    assert.equal(incomplete.result.reasonCode, 'CHECK_LESSON05_SUBMISSION_INVALID');

    const submissionPath = resolve(root, '.lab/submissions/05/submission.json');
    const misconception = lesson05AnswerKey();
    misconception.answers['AA05-C2'].base64Security = 'encryption-protects-the-password';
    await writeFile(submissionPath, `${JSON.stringify(misconception, null, 2)}\n`);
    const rejected = await command(root, ['lesson', '05', 'check']);
    assert.equal(rejected.result.status, 'fail');
    assert.deepEqual(
      rejected.result.diagnostics.filter(({ status }) => status === 'fail').map(({ id }) => id),
      ['lesson05.aa05-c2'],
    );

    await writeFile(submissionPath, `${JSON.stringify(lesson05AnswerKey(), null, 2)}\n`);
    const checked = await command(root, ['lesson', '05', 'check']);
    assert.equal(checked.result.status, 'pass');
    assert.deepEqual(checked.result.checkIds, ['AA05-C1', 'AA05-C2']);
    assert.match(checked.result.evidenceId, /^evidence-/u);

    const current = await currentProcess(root);
    const persistedFiles = [runtimePath];
    for (const directory of ['evidence', 'journal', 'logs']) {
      persistedFiles.push(...await filesBelow(resolve(root, '.lab', directory)));
    }
    const persisted = (await Promise.all(
      persistedFiles.map((path) => readFile(path, 'utf8')),
    )).join('\n');
    for (const forbidden of [
      'basic.alice@example.test',
      'basic-password-for-lesson-05',
      'course05_session=',
      'x-course-scenario-id',
      'x-course-control-token',
      current.control.shutdownToken,
    ]) assert.equal(persisted.includes(forbidden), false, `persisted forbidden value: ${forbidden}`);

    assert.equal((await command(root, ['lesson', '05', 'reset'])).result.status, 'pass');
    assert.match(await readFile(submissionPath, 'utf8'), /TODO/u);
    assert.equal((await command(root, ['lesson', '05', 'stop'])).result.status, 'pass');
    assert.equal((await command(root, ['lesson', '05', 'setup'])).result.status, 'pass');
    const purged = await command(root, ['lesson', '05', 'purge', '--yes']);
    assert.equal(purged.result.status, 'pass', JSON.stringify(purged.result));
    assert.equal(purged.result.diagnostics.find(({ id }) => id === 'resources.remaining').actual, '0');
    await assert.rejects(lstat(resolve(root, '.lab')), (error) => error.code === 'ENOENT');
  } finally {
    await emergencyStop(root);
    await rm(root, { recursive: true, force: true });
  }
});
