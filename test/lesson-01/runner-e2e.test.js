import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { cp, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  copyPortableCourseReferences,
  linkFixtureRuntimeDependencies,
} from '../course/portable-course-fixture.js';
import { getLesson01AssessmentReference } from '../../course/lessons/01/domain.mjs';
import { runCli } from '../../course/runner/main.mjs';
import { probeTcpPort } from '../../course/runner/port.mjs';
import { stopOwnedProcess } from '../../course/runner/process.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function listen(server, port = 0) {
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, '127.0.0.1', resolvePromise);
  });
  return server.address().port;
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise());
  });
}

async function createFixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-lesson-01-e2e-'));
  for (const entry of ['apps', 'course', 'curriculum', 'packages', 'scripts', 'services', 'test']) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry), { recursive: true });
  }
  for (const entry of ['README.md', 'course.mjs', 'course-lock.json', 'package.json', 'package-lock.json']) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry));
  }
  await copyPortableCourseReferences(repositoryRoot, root);
  await linkFixtureRuntimeDependencies(repositoryRoot, root);

  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const manifestPath = resolve(root, 'curriculum/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.ports.find(({ id }) => id === 'project-app-http').port = port;
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
  return { root, port };
}

function outputBuffer() {
  return {
    value: '',
    write(chunk) {
      this.value += String(chunk);
    },
  };
}

async function command(root, arguments_) {
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const exitCode = await runCli([...arguments_, '--json'], { repoRoot: root, stdout, stderr });
  assert.equal(stderr.value, '');
  return { exitCode, result: JSON.parse(stdout.value) };
}

async function currentProcessState(root) {
  const resourceRoot = resolve(root, '.lab/processes/project-app');
  const pointer = JSON.parse(await readFile(resolve(resourceRoot, 'current.json'), 'utf8'));
  const generationRoot = resolve(resourceRoot, 'generations', pointer.generationId);
  return {
    pointer,
    record: JSON.parse(await readFile(resolve(generationRoot, 'record.json'), 'utf8')),
    control: JSON.parse(await readFile(resolve(generationRoot, 'control.json'), 'utf8')),
  };
}

function correctSubmission() {
  const reference = getLesson01AssessmentReference();
  return {
    schemaVersion: 1,
    lessonId: '01',
    answers: Object.entries(reference.traceClassifications).map(([traceId, classification]) => ({
      traceId,
      classification,
    })),
    verifiers: Object.entries(reference.expectedVerifiers).map(([boundary, verifier]) => ({
      boundary,
      verifier,
    })),
  };
}

async function emergencyStop(root) {
  try {
    const current = await currentProcessState(root);
    if (current.record.status !== 'running'
        || current.control.status !== 'active'
        || typeof current.control.shutdownToken !== 'string') return;
    await stopOwnedProcess({
      record: current.record,
      shutdownToken: current.control.shutdownToken,
      timeoutMs: 2_000,
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function waitForPort(port, available, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probeTcpPort({ host: '127.0.0.1', port })).available === available) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.fail(`port ${port} did not become ${available ? 'available' : 'occupied'}`);
}

test('lesson 01 completes from course setup through evidence, reset, stop, and purge', async () => {
  const fixture = await createFixture();
  let blocker = null;
  try {
    assert.equal((await command(fixture.root, ['doctor'])).result.status, 'pass');
    assert.equal((await command(fixture.root, ['setup'])).result.status, 'pass');

    blocker = createServer();
    await listen(blocker, fixture.port);
    const occupied = await command(fixture.root, ['lesson', '01', 'doctor']);
    assert.equal(occupied.exitCode, 20);
    assert.equal(occupied.result.reasonCode, 'PREREQUISITE_PORT_IN_USE');
    await close(blocker);
    blocker = null;

    assert.equal((await command(fixture.root, ['lesson', '01', 'doctor'])).result.status, 'pass');
    const setup = await command(fixture.root, ['lesson', '01', 'setup']);
    assert.equal(setup.result.status, 'pass');
    const crashed = await currentProcessState(fixture.root);
    process.kill(crashed.record.pid, 'SIGKILL');
    await waitForPort(fixture.port, true);
    const crashDiagnosis = await command(fixture.root, ['lesson', '01', 'diagnose']);
    assert.equal(crashDiagnosis.result.status, 'blocked');
    assert.equal(crashDiagnosis.result.reasonCode, 'PROCESS_NOT_RUNNING');
    assert.equal((await command(fixture.root, ['lesson', '01', 'setup'])).result.status, 'pass');
    assert.equal((await command(fixture.root, ['lesson', '01', 'demo'])).result.status, 'pass');
    assert.equal((await command(fixture.root, ['lesson', '01', 'observe'])).result.status, 'pass');

    const incomplete = await command(fixture.root, ['lesson', '01', 'check']);
    assert.equal(incomplete.exitCode, 10);
    assert.equal(incomplete.result.reasonCode, 'CHECK_LESSON01_SUBMISSION_INVALID');

    const submissionPath = resolve(fixture.root, '.lab/submissions/01/submission.json');
    await writeFile(submissionPath, '{not-json\n');
    const invalidJson = await command(fixture.root, ['lesson', '01', 'check']);
    assert.equal(invalidJson.exitCode, 10);
    assert.equal(invalidJson.result.reasonCode, 'CHECK_LESSON01_SUBMISSION_INVALID');
    await rm(submissionPath);
    const missingObservation = await command(fixture.root, ['lesson', '01', 'observe']);
    assert.equal(missingObservation.exitCode, 20);
    assert.equal(missingObservation.result.reasonCode, 'PREREQUISITE_LESSON_WORKSPACE_MISSING');
    assert.match(missingObservation.result.recovery.join(' '), /lesson 01 setup/);
    const missing = await command(fixture.root, ['lesson', '01', 'check']);
    assert.equal(missing.exitCode, 10);
    assert.equal(missing.result.reasonCode, 'CHECK_LESSON01_SUBMISSION_INVALID');
    assert.match(missing.result.recovery.join(' '), /lesson 01 reset/);
    assert.equal((await command(fixture.root, ['lesson', '01', 'reset'])).result.status, 'pass');

    await writeFile(submissionPath, `${JSON.stringify(correctSubmission(), null, 2)}\n`);
    const checked = await command(fixture.root, ['lesson', '01', 'check']);
    assert.equal(checked.exitCode, 0);
    assert.equal(checked.result.status, 'pass');
    assert.match(checked.result.evidenceId, /^evidence-/);
    const stateAfterCheck = JSON.parse(await readFile(resolve(fixture.root, '.lab/state.json'), 'utf8'));
    assert.ok(stateAfterCheck.lessons.find(({ id }) => id === '01').evidenceIds.includes(checked.result.evidenceId));

    const firstProcess = await currentProcessState(fixture.root);
    const reset = await command(fixture.root, ['lesson', '01', 'reset']);
    assert.equal(reset.result.status, 'pass');
    const secondProcess = await currentProcessState(fixture.root);
    assert.notEqual(secondProcess.pointer.generationId, firstProcess.pointer.generationId);
    assert.notEqual(secondProcess.control.shutdownToken, firstProcess.control.shutdownToken);
    const resetSubmission = JSON.parse(await readFile(submissionPath, 'utf8'));
    assert.ok(resetSubmission.answers.every(({ classification }) => classification === 'TODO'));

    assert.equal((await command(fixture.root, ['lesson', '01', 'stop'])).result.status, 'pass');
    assert.equal((await probeTcpPort({ host: '127.0.0.1', port: fixture.port })).available, true);
    const purged = await command(fixture.root, ['purge', '--yes']);
    assert.equal(purged.result.status, 'pass');
    assert.equal(purged.result.diagnostics.find(({ id }) => id === 'resources.remaining').actual, '0');
    await assert.rejects(lstat(resolve(fixture.root, '.lab')), (error) => error.code === 'ENOENT');
  } finally {
    await close(blocker);
    await emergencyStop(fixture.root);
    await rm(fixture.root, { recursive: true, force: true });
  }
});
