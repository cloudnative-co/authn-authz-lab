import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { cp, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  copyPortableCourseReferences,
  linkFixtureRuntimeDependencies,
} from '../course/portable-course-fixture.js';
import { lesson04AnswerKey } from '../../course/lessons/04/assessment.mjs';
import { runCli } from '../../course/runner/main.mjs';
import { stopOwnedProcess } from '../../course/runner/process.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function synchronize(root) {
  const child = spawn(process.execPath, [
    'scripts/sync-course-contract.mjs',
    '--source', 'curriculum/course-source.snapshot.json',
    '--source-label', 'articles/series/authn-authz/curriculum.json',
    '--output-root', root,
  ], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(chunk));
  const [code, signal] = await once(child, 'exit');
  assert.equal(code, 0, `contract sync failed: signal=${signal} ${Buffer.concat(errors).toString('utf8')}`);
}

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
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-lesson-04-e2e-'));
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
  await synchronize(root);
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

async function assertNoSensitivePersistence(root, controlToken) {
  const paths = [resolve(root, '.lab/submissions/04/runtime.json')];
  for (const directory of ['evidence', 'journal', 'logs']) {
    paths.push(...await filesBelow(resolve(root, '.lab', directory)));
  }
  const combined = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n');
  for (const forbidden of [
    'alice.04@example.test',
    'bob.04@example.test',
    'carol.04@example.test',
    'dave.04@example.test',
    'password-for-lesson-04',
    'course04_session=',
    'set-cookie',
    'x-course-scenario-id',
    'x-course-control-token',
    'x-project-role',
    controlToken,
  ]) assert.equal(combined.includes(forbidden), false, `persisted forbidden value: ${forbidden}`);
}

test('Lesson 04 runner completes a fresh policy scenario without changing Lesson 03 work', async () => {
  const root = await createFixture();
  try {
    const manifest = JSON.parse(await readFile(resolve(root, 'curriculum/manifest.json'), 'utf8'));
    const port = manifest.ports.find(({ id }) => id === 'project-app-http');
    const resources = new Map(manifest.resources.map((resource) => [resource.id, resource]));
    const lock = manifest.locks.find(({ id }) => id === 'lock:course');
    const lesson = manifest.lessons.find(({ id }) => id === '04');
    assert.deepEqual(
      port.lessonIds,
      manifest.lessons.filter(({ portIds }) => portIds.includes(port.id)).map(({ id }) => id),
    );
    assert.deepEqual(resources.get('data:lesson-04-workspace'), {
      id: 'data:lesson-04-workspace',
      type: 'data',
      ownership: 'course-created',
      locator: '.lab/submissions/04',
      resetPolicy: 'recreate-template',
      purgePolicy: 'remove-owned-only',
      lessonIds: ['04'],
    });
    assert.equal(lock.resourceIds.includes('data:lesson-04-workspace'), true);
    assert.deepEqual(lesson.portIds, ['project-app-http']);
    assert.deepEqual(
      lesson.resourceIds,
      ['directory:lab-state', 'project-app', 'data:lesson-04-workspace'],
    );
    assert.deepEqual(lesson.lockIds, ['lock:course']);

    assert.equal((await command(root, ['doctor'])).result.status, 'pass');
    assert.equal((await command(root, ['setup'])).result.status, 'pass');
    assert.equal((await command(root, ['lesson', '03', 'setup'])).result.status, 'pass');
    const lesson03SubmissionPath = resolve(root, '.lab/submissions/03/submission.json');
    const lesson03Submission = await readFile(lesson03SubmissionPath, 'utf8');

    for (const [action, expected] of [
      ['doctor', 'pass'],
      ['setup', 'pass'],
      ['demo', 'pass'],
      ['observe', 'pass'],
    ]) {
      assert.equal((await command(root, ['lesson', '04', action])).result.status, expected);
    }
    const storedRuntime = JSON.parse(await readFile(
      resolve(root, '.lab/submissions/04/runtime.json'),
      'utf8',
    ));
    assert.equal(storedRuntime.enforcement.unauthenticatedAuditCount, 0);
    assert.equal(storedRuntime.enforcement.callerRoleHeadersAccepted, false);
    assert.deepEqual(storedRuntime.audit.statuses, [403, 404, 404, 404, 204, 404]);

    const incomplete = await command(root, ['lesson', '04', 'check']);
    assert.equal(incomplete.exitCode, 10);
    assert.equal(incomplete.result.reasonCode, 'CHECK_LESSON04_SUBMISSION_INVALID');

    const misconception = lesson04AnswerKey();
    misconception.answers['AA04-C3'].concealmentPolicy = 'different-response-by-resource-existence';
    const submissionPath = resolve(root, '.lab/submissions/04/submission.json');
    await writeFile(submissionPath, `${JSON.stringify(misconception, null, 2)}\n`);
    const failed = await command(root, ['lesson', '04', 'check']);
    assert.equal(failed.exitCode, 10);
    assert.equal(failed.result.status, 'fail');
    assert.match(failed.result.evidenceId, /^evidence-/u);
    assert.deepEqual(
      failed.result.diagnostics.filter(({ status }) => status === 'fail').map(({ id }) => id),
      ['lesson04.aa04-c3'],
    );

    await writeFile(submissionPath, `${JSON.stringify(lesson04AnswerKey(), null, 2)}\n`);
    const first = await command(root, ['lesson', '04', 'check']);
    const second = await command(root, ['lesson', '04', 'check']);
    assert.equal(first.result.status, 'pass');
    assert.equal(second.result.status, 'pass');
    assert.deepEqual(first.result.checkIds, ['AA04-C1', 'AA04-C2', 'AA04-C3', 'AA04-C4']);
    assert.notEqual(first.result.evidenceId, second.result.evidenceId);

    const beforeReset = await currentProcess(root);
    assert.equal((await command(root, ['lesson', '04', 'reset'])).result.status, 'pass');
    const afterReset = await currentProcess(root);
    assert.notEqual(afterReset.pointer.generationId, beforeReset.pointer.generationId);
    assert.notEqual(afterReset.control.shutdownToken, beforeReset.control.shutdownToken);
    assert.equal(await readFile(lesson03SubmissionPath, 'utf8'), lesson03Submission);
    assert.match(await readFile(submissionPath, 'utf8'), /TODO/u);

    assert.equal((await command(root, ['lesson', '04', 'demo'])).result.status, 'pass');
    await assertNoSensitivePersistence(root, afterReset.control.shutdownToken);
    assert.equal((await command(root, ['lesson', '04', 'stop'])).result.status, 'pass');
    assert.equal((await command(root, ['lesson', '04', 'setup'])).result.status, 'pass');
    const purged = await command(root, ['lesson', '04', 'purge', '--yes']);
    assert.equal(purged.result.status, 'pass', JSON.stringify(purged.result));
    assert.equal(purged.result.diagnostics.find(({ id }) => id === 'resources.remaining').actual, '0');
    await assert.rejects(lstat(resolve(root, '.lab')), (error) => error.code === 'ENOENT');
  } finally {
    await emergencyStop(root);
    await rm(root, { recursive: true, force: true });
  }
});
