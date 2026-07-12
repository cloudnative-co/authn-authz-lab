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
} from './course/portable-course-fixture.js';
import { lesson02AnswerKey } from '../course/lessons/02/assessment.mjs';
import { lesson03AnswerKey } from '../course/lessons/03/assessment.mjs';
import { runCli } from '../course/runner/main.mjs';
import { stopOwnedProcess } from '../course/runner/process.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

async function synchronize(root) {
  const child = spawn(process.execPath, [
    'scripts/sync-course-contract.mjs',
    '--source', 'curriculum/course-source.snapshot.json',
    '--source-label', 'articles/series/auth-authz/curriculum.json',
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
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-lesson-02-03-e2e-'));
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
  const resources = new Map(manifest.resources.map((resource) => [resource.id, resource]));
  const port = manifest.ports.find(({ id }) => id === 'project-app-http');
  const lock = manifest.locks.find(({ id }) => id === 'lock:course');
  assert.deepEqual(
    port.lessonIds,
    manifest.lessons.filter(({ portIds }) => portIds.includes(port.id)).map(({ id }) => id),
  );
  for (const resourceId of ['directory:lab-state', 'project-app']) {
    assert.deepEqual(
      resources.get(resourceId).lessonIds,
      manifest.lessons.filter(({ resourceIds }) => resourceIds.includes(resourceId)).map(({ id }) => id),
    );
  }
  for (const [lessonId, resourceId] of [
    ['02', 'data:lesson-02-workspace'],
    ['03', 'data:lesson-03-workspace'],
  ]) {
    assert.deepEqual(resources.get(resourceId), {
      id: resourceId,
      type: 'data',
      ownership: 'course-created',
      locator: `.lab/submissions/${lessonId}`,
      resetPolicy: 'recreate-template',
      purgePolicy: 'remove-owned-only',
      lessonIds: [lessonId],
    });
    assert.equal(lock.resourceIds.includes(resourceId), true);
    const lesson = manifest.lessons.find(({ id }) => id === lessonId);
    assert.deepEqual(lesson.portIds, ['project-app-http']);
    assert.deepEqual(lesson.resourceIds, ['directory:lab-state', 'project-app', resourceId]);
    assert.deepEqual(lesson.lockIds, ['lock:course']);
    for (const sourceFile of [
      `course/lessons/${lessonId}/README.md`,
      `course/lessons/${lessonId}/assessment.mjs`,
      `course/lessons/${lessonId}/assessment.yaml`,
      `course/lessons/${lessonId}/runner.mjs`,
      `course/lessons/${lessonId}/scenario.mjs`,
      `course/lessons/${lessonId}/workspace.mjs`,
      'course/lessons/registry.mjs',
      'course/runner/project-app-runtime.mjs',
      'course/runner/runtime-lesson.mjs',
      'course/runner/scenario-client.mjs',
      'test/lesson-02-03-runner-e2e.test.js',
    ]) assert.equal(lesson.sourceFiles.includes(sourceFile), true, `${lessonId} misses ${sourceFile}`);
  }
  port.port = await availablePort();
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

async function assertNoSensitivePersistence(root) {
  const paths = [
    resolve(root, '.lab/submissions/02/runtime.json'),
    resolve(root, '.lab/submissions/03/runtime.json'),
  ];
  const evidenceRoot = resolve(root, '.lab/evidence');
  for (const epoch of await readdir(evidenceRoot)) {
    for (const name of await readdir(resolve(evidenceRoot, epoch))) {
      paths.push(resolve(evidenceRoot, epoch, name));
    }
  }
  for (const directory of ['journal', 'logs']) {
    const rootPath = resolve(root, '.lab', directory);
    for (const name of await readdir(rootPath)) paths.push(resolve(rootPath, name));
  }
  const combined = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n');
  for (const forbidden of [
    'alice@example.com', 'unknown-user@example.com', 'user-alice',
    'alice-password-for-lesson-02', 'incorrect-training-password',
    'course_session=', 'set-cookie', 'x-course-scenario-id', '$course-scrypt$',
  ]) assert.equal(combined.includes(forbidden), false, `persisted forbidden value: ${forbidden}`);
}

test('Lesson 02 and 03 run independently over one managed project-app with fresh checks', async () => {
  const root = await createFixture();
  try {
    assert.equal((await command(root, ['doctor'])).result.status, 'pass');
    assert.equal((await command(root, ['setup'])).result.status, 'pass');

    let sharedPid = null;
    for (const lessonId of ['03', '02']) {
      assert.equal((await command(root, ['lesson', lessonId, 'doctor'])).result.status, 'pass');
      assert.equal((await command(root, ['lesson', lessonId, 'setup'])).result.status, 'pass');
      const afterSetup = await currentProcess(root);
      if (sharedPid === null) sharedPid = afterSetup.record.pid;
      else assert.equal(afterSetup.record.pid, sharedPid);
      assert.equal((await command(root, ['lesson', lessonId, 'demo'])).result.status, 'pass');
      assert.equal((await command(root, ['lesson', lessonId, 'observe'])).result.status, 'pass');
      const incomplete = await command(root, ['lesson', lessonId, 'check']);
      assert.equal(incomplete.exitCode, 10);
      assert.equal(incomplete.result.reasonCode, `CHECK_LESSON${lessonId}_SUBMISSION_INVALID`);
      const answer = lessonId === '02' ? lesson02AnswerKey() : lesson03AnswerKey();
      const misconception = structuredClone(answer);
      if (lessonId === '02') {
        misconception.answers['AA02-C3'].rateLimitScope = 'global-kdf-concurrency-defense';
      } else {
        misconception.answers['AA03-C2'].loginRotation = 'reuse-pre-auth-token';
      }
      await writeFile(
        resolve(root, `.lab/submissions/${lessonId}/submission.json`),
        `${JSON.stringify(misconception, null, 2)}\n`,
      );
      const failed = await command(root, ['lesson', lessonId, 'check']);
      assert.equal(failed.exitCode, 10);
      assert.equal(failed.result.status, 'fail');
      assert.match(failed.result.evidenceId, /^evidence-/u);
      await writeFile(
        resolve(root, `.lab/submissions/${lessonId}/submission.json`),
        `${JSON.stringify(answer, null, 2)}\n`,
      );
      const first = await command(root, ['lesson', lessonId, 'check']);
      const second = await command(root, ['lesson', lessonId, 'check']);
      assert.equal(first.result.status, 'pass');
      assert.equal(second.result.status, 'pass');
      assert.deepEqual(first.result.checkIds, lessonId === '02'
        ? ['AA02-C1', 'AA02-C2', 'AA02-C3']
        : ['AA03-C1', 'AA03-C2', 'AA03-C3', 'AA03-C4']);
      assert.notEqual(first.result.evidenceId, second.result.evidenceId);
    }

    await assertNoSensitivePersistence(root);
    const sharedBefore = await currentProcess(root);
    const lesson03Answer = await readFile(resolve(root, '.lab/submissions/03/submission.json'), 'utf8');
    assert.equal((await command(root, ['lesson', '02', 'reset'])).result.status, 'pass');
    const sharedAfter = await currentProcess(root);
    assert.notEqual(sharedAfter.pointer.generationId, sharedBefore.pointer.generationId);
    assert.notEqual(sharedAfter.control.shutdownToken, sharedBefore.control.shutdownToken);
    assert.equal(
      await readFile(resolve(root, '.lab/submissions/03/submission.json'), 'utf8'),
      lesson03Answer,
    );
    const reset02 = JSON.parse(await readFile(resolve(root, '.lab/submissions/02/submission.json'), 'utf8'));
    assert.match(JSON.stringify(reset02), /TODO/u);

    assert.equal((await command(root, ['lesson', '03', 'stop'])).result.status, 'pass');
    const restarted = await command(root, ['lesson', '03', 'setup']);
    assert.equal(restarted.result.status, 'pass');
    const purged = await command(root, ['lesson', '03', 'purge', '--yes']);
    assert.equal(purged.result.status, 'pass', JSON.stringify(purged.result));
    assert.equal(purged.result.diagnostics.find(({ id }) => id === 'resources.remaining').actual, '0');
    await assert.rejects(lstat(resolve(root, '.lab')), (error) => error.code === 'ENOENT');
  } finally {
    await emergencyStop(root);
    await rm(root, { recursive: true, force: true });
  }
});
