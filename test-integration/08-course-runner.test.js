import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { cp, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { lesson08AnswerKey } from '../course/lessons/08/assessment.mjs';
import { runBoundedCommand } from '../course/runner/managed-compose.mjs';
import { runCli } from '../course/runner/main.mjs';

const RUN_DOCKER = process.env.COURSE_TEST_DOCKER === '1';
const repositoryRoot = resolve(import.meta.dirname, '..');

function dockerEnvironment() {
  const environment = {};
  for (const name of [
    'PATH', 'HOME', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR',
  ]) if (typeof process.env[name] === 'string') environment[name] = process.env[name];
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
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-lesson-08-runner-'));
  for (const entry of [
    'apps', 'course', 'curriculum', 'docker', 'packages', 'scripts', 'services', 'test',
    'test-integration',
  ]) await cp(resolve(repositoryRoot, entry), resolve(root, entry), { recursive: true });
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
  return JSON.parse(await readFile(
    resolve(root, '.lab/containers/identity-platform-lab/record.json'),
    'utf8',
  ));
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

test('Lesson 08 runner owns the Samba lab and completes a fresh JML assessment', {
  skip: !RUN_DOCKER,
  timeout: 25 * 60_000,
}, async () => {
  const sentinel = await startProjectAppPortSentinel();
  const root = await createFixture(sentinel.port);
  let projectName = null;
  try {
    assert.equal((await command(root, ['doctor'])).result.status, 'pass');
    assert.equal((await command(root, ['setup'])).result.status, 'pass');

    for (const action of ['doctor', 'setup', 'demo', 'observe']) {
      const outcome = await command(root, ['lesson', '08', action]);
      assert.equal(outcome.result.status, 'pass', `${action}: ${JSON.stringify(outcome.result)}`);
      assert.equal(sentinel.connections(), 0, `${action} touched the project-app port`);
    }

    await assert.rejects(lstat(resolve(root, '.lab/processes/project-app')), (error) => error.code === 'ENOENT');
    const runtime = JSON.parse(await readFile(resolve(root, '.lab/submissions/08/runtime.json'), 'utf8'));
    assert.equal(runtime.directory.transport, 'LDAPS');
    assert.equal(runtime.directory.caVerified, true);
    assert.deepEqual(runtime.directory.operations, [
      'service-bind',
      'structured-user-search',
      'resolved-user-bind',
      'structured-group-search',
      'explicit-group-to-role-mapping',
    ]);
    assert.equal(runtime.identity.stableIdPreservedAcrossMove, true);
    assert.deepEqual(runtime.joiner.sessionRole, ['viewer']);
    assert.deepEqual(runtime.mover.newSessionRole, ['editor']);
    assert.equal(runtime.leaver.disabledLoginGeneric, true);
    assert.equal(runtime.kerberos.tgtObservedByKlist, true);

    const submissionPath = resolve(root, '.lab/submissions/08/submission.json');
    await writeFile(submissionPath, `${JSON.stringify(lesson08AnswerKey(), null, 2)}\n`);
    const checked = await command(root, ['lesson', '08', 'check']);
    assert.equal(checked.result.status, 'pass', JSON.stringify(checked.result));
    assert.deepEqual(checked.result.checkIds, ['AA08-C1', 'AA08-C2']);
    assert.match(checked.result.evidenceId, /^evidence-/u);
    assert.equal(sentinel.connections(), 0, 'check touched the project-app port');

    const diagnosed = await command(root, ['lesson', '08', 'diagnose']);
    assert.equal(diagnosed.result.status, 'pass', JSON.stringify(diagnosed.result));

    let record = await managedRecord(root);
    projectName = record.composeProject;
    assert.deepEqual(record.expectedServices, ['app', 'client', 'dc']);
    assert.deepEqual(record.expectedNetworks, ['default']);
    assert.deepEqual(record.expectedVolumes, [
      'lesson08_ca_public',
      'lesson08_directory_data',
      'lesson08_samba_tls',
    ]);
    assert.deepEqual(record.publishedPorts, []);

    const persistedFiles = [];
    for (const directory of ['submissions/08', 'evidence', 'journal', 'logs']) {
      persistedFiles.push(...await filesBelow(resolve(root, '.lab', directory)));
    }
    const persisted = (await Promise.all(persistedFiles.map((path) => readFile(path, 'utf8')))).join('\n');
    for (const forbidden of [
      'CN=Alice Course,',
      'objectGUID::',
      'BEGIN PRIVATE KEY',
      'krbtgt/AD.EXAMPLE.TEST@AD.EXAMPLE.TEST\nValid starting',
    ]) assert.equal(persisted.includes(forbidden), false, `persisted forbidden value: ${forbidden}`);

    assert.equal((await command(root, ['lesson', '08', 'stop'])).result.status, 'pass');
    assert.equal((await command(root, ['lesson', '08', 'setup'])).result.status, 'pass');
    const reset = await command(root, ['lesson', '08', 'reset']);
    assert.equal(reset.result.status, 'pass', JSON.stringify(reset.result));
    assert.match(await readFile(submissionPath, 'utf8'), /TODO/u);

    record = await managedRecord(root);
    projectName = record.composeProject;
    const purged = await command(root, ['lesson', '08', 'purge', '--yes']);
    assert.equal(purged.result.status, 'pass', JSON.stringify(purged.result));
    assert.equal(purged.result.diagnostics.find(({ id }) => id === 'resources.remaining').actual, '0');
    assert.equal(sentinel.connections(), 0, 'Lesson 08 touched the project-app port');
    await assert.rejects(lstat(resolve(root, '.lab')), (error) => error.code === 'ENOENT');
    await assertProjectAbsent(root, projectName);
  } finally {
    await sentinel.close();
    await removeProject(root, projectName);
    await rm(root, { recursive: true, force: true });
  }
});
