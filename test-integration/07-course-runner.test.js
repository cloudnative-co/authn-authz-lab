import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { cp, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { lesson07AnswerKey } from '../course/lessons/07/assessment.mjs';
import { runBoundedCommand } from '../course/runner/managed-compose.mjs';
import { runCli } from '../course/runner/main.mjs';

const RUN_DOCKER = process.env.COURSE_TEST_DOCKER === '1';
const repositoryRoot = resolve(import.meta.dirname, '..');

function dockerEnvironment() {
  const environment = {};
  for (const name of [
    'PATH', 'HOME', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR',
  ]) {
    if (typeof process.env[name] === 'string') environment[name] = process.env[name];
  }
  return environment;
}

async function docker(root, args) {
  const result = await runBoundedCommand('docker', args, {
    cwd: root,
    env: dockerEnvironment(),
    timeoutMs: 60_000,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  assert.equal(result.code, 0, `docker command failed: ${args[0]}`);
  assert.equal(result.signal, null);
  return result;
}

async function createFixture(projectAppPort) {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-lesson-07-runner-'));
  for (const entry of [
    'apps', 'course', 'curriculum', 'docker', 'packages', 'scripts', 'services', 'test',
    'test-integration',
  ]) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry), { recursive: true });
  }
  for (const entry of ['README.md', 'course.mjs', 'course-lock.json', 'package.json', 'package-lock.json']) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry));
  }
  await symlink(resolve(repositoryRoot, 'node_modules'), resolve(root, 'node_modules'), 'dir');
  const manifestPath = resolve(root, 'curriculum/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.ports.find(({ id }) => id === 'project-app-http').port = projectAppPort;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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

async function filesBelow(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => (
      error.code === 'ENOENT' ? [] : Promise.reject(error)
    ));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  await visit(root);
  return output;
}

async function managedRecord(root) {
  return JSON.parse(await readFile(resolve(root, '.lab/containers/kerberos-lab/record.json'), 'utf8'));
}

async function removeProject(root, projectName) {
  if (!projectName) return;
  const containers = (await docker(root, [
    'ps', '--all', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}',
  ])).stdout.trim().split(/\r?\n/u).filter(Boolean);
  for (const id of containers) await docker(root, ['rm', '--force', id]).catch(() => {});
  const networks = (await docker(root, [
    'network', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}',
  ])).stdout.trim().split(/\r?\n/u).filter(Boolean);
  for (const id of networks) await docker(root, ['network', 'rm', id]).catch(() => {});
  const volumes = (await docker(root, [
    'volume', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Name}}',
  ])).stdout.trim().split(/\r?\n/u).filter(Boolean);
  for (const name of volumes) await docker(root, ['volume', 'rm', name]).catch(() => {});
}

async function assertProjectAbsent(root, projectName) {
  for (const args of [
    ['ps', '--all', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}'],
    ['network', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}'],
    ['volume', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Name}}'],
  ]) assert.equal((await docker(root, args)).stdout.trim(), '');
}

async function startProjectAppPortSentinel() {
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = server.address();
  return {
    port,
    connections: () => connections,
    close: () => new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => error ? rejectPromise(error) : resolvePromise());
    }),
  };
}

test('Lesson 07 runner owns the Kerberos lab without touching the configured project-app port', {
  skip: !RUN_DOCKER,
  timeout: 20 * 60_000,
}, async () => {
  const sentinel = await startProjectAppPortSentinel();
  const root = await createFixture(sentinel.port);
  let projectName = null;
  try {
    assert.equal((await command(root, ['doctor'])).result.status, 'pass');
    assert.equal((await command(root, ['setup'])).result.status, 'pass');

    for (const action of ['doctor', 'setup', 'demo', 'observe']) {
      const outcome = await command(root, ['lesson', '07', action]);
      assert.equal(outcome.result.status, 'pass', `${action}: ${JSON.stringify(outcome.result)}`);
      assert.equal(sentinel.connections(), 0, `${action} touched the project-app port`);
    }

    await assert.rejects(lstat(resolve(root, '.lab/processes/project-app')), (error) => error.code === 'ENOENT');
    const runtime = JSON.parse(await readFile(resolve(root, '.lab/submissions/07/runtime.json'), 'utf8'));
    assert.equal(runtime.normal.afterKinit.tgtPresent, true);
    assert.equal(runtime.normal.afterKinit.httpServiceTicketPresent, false);
    assert.equal(runtime.normal.authenticated.status, 200);
    assert.equal(runtime.normal.afterServiceRequest.httpServiceTicketPresent, true);
    assert.equal(runtime.rejection.wrongSpn.reason, 'SERVICE_PRINCIPAL_UNKNOWN');
    assert.equal(runtime.rejection.clockSkew.reason, 'CLOCK_SKEW_REJECTED');
    assert.equal(runtime.rejection.staleKeytab.reason, 'ACCEPTOR_KEY_MISMATCH');
    assert.equal(runtime.rejection.staleKeytab.currentRestored, true);

    const submissionPath = resolve(root, '.lab/submissions/07/submission.json');
    await writeFile(submissionPath, `${JSON.stringify(lesson07AnswerKey(), null, 2)}\n`);
    const checked = await command(root, ['lesson', '07', 'check']);
    assert.equal(checked.result.status, 'pass', JSON.stringify(checked.result));
    assert.deepEqual(checked.result.checkIds, ['AA07-C1', 'AA07-C2']);
    assert.match(checked.result.evidenceId, /^evidence-/u);
    assert.equal(sentinel.connections(), 0, 'check touched the project-app port');

    const diagnosed = await command(root, ['lesson', '07', 'diagnose']);
    assert.equal(diagnosed.result.status, 'pass', JSON.stringify(diagnosed.result));
    assert.equal(sentinel.connections(), 0, 'diagnose touched the project-app port');

    let record = await managedRecord(root);
    projectName = record.composeProject;
    assert.deepEqual(record.expectedServices, ['app', 'client', 'kdc']);
    assert.deepEqual(record.expectedNetworks, ['default']);
    assert.deepEqual(record.expectedVolumes, ['lesson07_keytabs']);
    assert.deepEqual(record.publishedPorts, []);

    const persistedFiles = [];
    for (const directory of ['submissions/07', 'evidence', 'journal', 'logs']) {
      persistedFiles.push(...await filesBelow(resolve(root, '.lab', directory)));
    }
    const persisted = (await Promise.all(persistedFiles.map((path) => readFile(path, 'utf8')))).join('\n');
    for (const forbidden of [
      'alice-password-for-lesson-07',
      'Authorization: Negotiate',
      'Unspecified GSS failure',
      'BEGIN KEYTAB',
    ]) assert.equal(persisted.includes(forbidden), false, `persisted forbidden value: ${forbidden}`);

    const reset = await command(root, ['lesson', '07', 'reset']);
    assert.equal(reset.result.status, 'pass', JSON.stringify(reset.result));
    assert.match(await readFile(submissionPath, 'utf8'), /TODO/u);
    assert.equal(sentinel.connections(), 0, 'reset touched the project-app port');
    assert.equal((await command(root, ['lesson', '07', 'stop'])).result.status, 'pass');
    assert.equal(sentinel.connections(), 0, 'stop touched the project-app port');
    assert.equal((await command(root, ['lesson', '07', 'setup'])).result.status, 'pass');
    assert.equal(sentinel.connections(), 0, 'second setup touched the project-app port');

    record = await managedRecord(root);
    projectName = record.composeProject;
    const purged = await command(root, ['lesson', '07', 'purge', '--yes']);
    assert.equal(purged.result.status, 'pass', JSON.stringify(purged.result));
    assert.equal(purged.result.diagnostics.find(({ id }) => id === 'resources.remaining').actual, '0');
    assert.equal(sentinel.connections(), 0, 'purge touched the project-app port');
    await assert.rejects(lstat(resolve(root, '.lab')), (error) => error.code === 'ENOENT');
    await assertProjectAbsent(root, projectName);
  } finally {
    await sentinel.close();
    await removeProject(root, projectName);
    await rm(root, { recursive: true, force: true });
  }
});
