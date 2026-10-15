import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { lesson06AnswerKey } from '../course/lessons/06/assessment.mjs';
import { DEFAULT_STATE_ROOT, loadCourseFoundation } from '../course/runner/lifecycle.mjs';
import {
  execManagedComposeService,
  runBoundedCommand,
  stopManagedComposeProjects,
} from '../course/runner/managed-compose.mjs';
import { runCli } from '../course/runner/main.mjs';
import { stopOwnedProcess } from '../course/runner/process.mjs';
import { scenarioRequest, withFreshScenario } from '../course/runner/scenario-client.mjs';

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

async function docker(root, args, { acceptedExitCodes = [0], stdin = null } = {}) {
  const result = await runBoundedCommand('docker', args, {
    cwd: root,
    env: dockerEnvironment(),
    stdin,
    timeoutMs: 60_000,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  assert.ok(acceptedExitCodes.includes(result.code), `docker command failed with ${result.code}`);
  assert.equal(result.signal, null);
  return result;
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
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-lesson-06-e2e-'));
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
  const projectPort = await availablePort();
  let ldapPort = await availablePort();
  while (ldapPort === projectPort) ldapPort = await availablePort();
  manifest.ports.find(({ id }) => id === 'project-app-http').port = projectPort;
  manifest.ports.find(({ id }) => id === 'lesson-06-ldap-tcp').port = ldapPort;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, projectPort, ldapPort };
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

async function emergencyStopProcess(root) {
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

async function managedRecord(root) {
  return JSON.parse(await readFile(
    resolve(root, '.lab/containers/ldap-directory/record.json'),
    'utf8',
  ));
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

async function assertProjectAbsent(root, projectName) {
  for (const args of [
    ['ps', '--all', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}'],
    ['network', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}'],
    ['volume', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Name}}'],
  ]) {
    const result = await docker(root, args);
    assert.equal(result.stdout.trim(), '');
  }
}

async function emergencyRemoveProject(root, projectName) {
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

test('Lesson 06 course runner owns a real OpenLDAP lifecycle and protocol', {
  skip: !RUN_DOCKER,
  timeout: 20 * 60_000,
}, async () => {
  const fixture = await createFixture();
  const { root, projectPort } = fixture;
  let stateRoot = resolve(root, DEFAULT_STATE_ROOT);
  const origin = `http://127.0.0.1:${projectPort}`;
  let projectName = null;
  try {
    const fixtureFoundation = await loadCourseFoundation({ repoRoot: root });
    stateRoot = resolve(fixtureFoundation.repositoryRealpath, DEFAULT_STATE_ROOT);
    const doctor = await command(root, ['doctor']);
    assert.equal(doctor.result.status, 'pass', JSON.stringify(doctor.result));
    const courseSetup = await command(root, ['setup']);
    assert.equal(courseSetup.result.status, 'pass', JSON.stringify(courseSetup.result));
    const lessonDoctor = await command(root, ['lesson', '06', 'doctor']);
    assert.equal(lessonDoctor.result.status, 'pass', JSON.stringify(lessonDoctor.result));

    const setup = await command(root, ['lesson', '06', 'setup']);
    assert.equal(setup.result.status, 'pass', JSON.stringify(setup.result));
    assert.ok(setup.result.durationMs < 15 * 60_000);
    const demo = await command(root, ['lesson', '06', 'demo']);
    assert.equal(demo.result.status, 'pass', JSON.stringify(demo.result));
    const observed = await command(root, ['lesson', '06', 'observe']);
    assert.equal(observed.result.status, 'pass', JSON.stringify(observed.result));

    const runtime = JSON.parse(await readFile(resolve(root, '.lab/submissions/06/runtime.json'), 'utf8'));
    assert.equal(runtime.actualProtocol, true);
    assert.equal(runtime.evidenceBasis, 'fresh-project-app-to-real-openldap');
    assert.equal(runtime.success.directoryDn, 'uid=alice,ou=people,dc=example,dc=test');
    assert.deepEqual(runtime.success.groups, ['engineering', 'security']);
    assert.deepEqual(
      runtime.protocol.successOperations.map(({ kind }) => kind),
      ['bind', 'search', 'bind', 'search'],
    );
    assert.equal(runtime.failures.genericFailuresEqual, true);
    assert.equal(runtime.failures.wwwAuthenticateAbsent, true);
    assert.equal(runtime.protocol.emptyNetworkReached, false);
    assert.equal(runtime.protocol.injectionFilterConstruction, 'structured-equality-filter');
    assert.equal(runtime.protocol.injectionFilterEscaped, true);
    assert.equal(runtime.safety.redacted, true);

    const incomplete = await command(root, ['lesson', '06', 'check']);
    assert.equal(incomplete.exitCode, 10);
    assert.equal(incomplete.result.reasonCode, 'CHECK_LESSON06_SUBMISSION_INVALID');
    const submissionPath = resolve(root, '.lab/submissions/06/submission.json');
    await writeFile(submissionPath, `${JSON.stringify(lesson06AnswerKey(), null, 2)}\n`);
    const checked = await command(root, ['lesson', '06', 'check']);
    assert.equal(checked.result.status, 'pass');
    assert.deepEqual(checked.result.checkIds, ['AA06-C1', 'AA06-C2']);
    assert.match(checked.result.evidenceId, /^evidence-/u);

    const record = await managedRecord(root);
    projectName = record.composeProject;
    assert.equal(record.status, 'running');
    assert.deepEqual(record.expectedServices, ['ldap']);
    assert.deepEqual(record.expectedNetworks, ['default']);
    assert.deepEqual(record.expectedVolumes, []);
    const containerId = record.containers[0].containerId;
    const inspected = JSON.parse((await docker(root, ['inspect', '--type', 'container', containerId])).stdout)[0];
    assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(Object.keys(inspected.HostConfig.Tmpfs).sort(), [
      '/etc/ldap/slapd.d', '/run/slapd', '/tmp', '/var/lib/ldap',
    ]);
    assert.equal(inspected.NetworkSettings.Ports['389/tcp'][0].HostIp, '127.0.0.1');
    const networkId = record.networks[0].networkId;
    const network = JSON.parse((await docker(root, ['network', 'inspect', networkId])).stdout)[0];
    assert.equal(network.Internal, false);
    const diff = (await docker(root, ['diff', containerId])).stdout;
    assert.doesNotMatch(diff, /\/tmp\/slapd\.conf|\/tmp\/seed\.ldif|\/var\/lib\/ldap|\/etc\/ldap\/slapd\.d/u);

    await withFreshScenario({ origin, lessonId: '06' }, async (scenarioId) => {
      const decomposed = await scenarioRequest(origin, '/api/lessons/06/directory/authenticate', {
        method: 'POST',
        scenarioId,
        json: {
          identifier: 'alice@example.com',
          password: 'Cafe\u0301-password-for-lesson-06',
        },
      });
      assert.equal(decomposed.status, 422);
      assert.equal(decomposed.body.code, 'DIRECTORY_AUTH_FAILED');
      assert.equal(decomposed.wwwAuthenticate, null);
    });

    const servicePassword = await readFile(
      resolve(root, '.lab/containers/ldap-directory/service-password'),
      'utf8',
    );
    const denied = await execManagedComposeService({
      stateRoot,
      repoRoot: root,
      resourceId: 'ldap-directory',
      serviceName: 'ldap',
      argv: [
        'ldapmodify', '-x', '-H', 'ldap://127.0.0.1:389',
        '-D', 'uid=course-search,ou=service,dc=example,dc=test',
        '-y', '/run/secrets/ldap_service_password',
      ],
      stdin: [
        'dn: uid=alice,ou=people,dc=example,dc=test',
        'changetype: modify',
        'replace: displayName',
        'displayName: Modified Alice',
        '',
      ].join('\n'),
      acceptedExitCodes: [50],
    });
    assert.equal(denied.code, 50);
    assert.match(denied.stderr, /Insufficient access/u);
    const readOnlyRootfs = await execManagedComposeService({
      stateRoot,
      repoRoot: root,
      resourceId: 'ldap-directory',
      serviceName: 'ldap',
      argv: ['sh', '-c', 'touch /root/course-write-probe'],
      acceptedExitCodes: [1],
    });
    assert.equal(readOnlyRootfs.code, 1);
    assert.match(readOnlyRootfs.stderr, /Read-only file system/u);

    await stopManagedComposeProjects({
      stateRoot,
      repoRoot: root,
      resourceIds: ['ldap-directory'],
      remove: false,
    });
    await withFreshScenario({ origin, lessonId: '06' }, async (scenarioId) => {
      const unavailable = await scenarioRequest(origin, '/api/lessons/06/directory/authenticate', {
        method: 'POST',
        scenarioId,
        json: {
          identifier: 'alice@example.com',
          password: 'Café-password-for-lesson-06',
        },
      });
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.body.code, 'DIRECTORY_UNAVAILABLE');
      assert.equal(unavailable.retryAfter, '1');
      assert.equal(unavailable.wwwAuthenticate, null);
    });
    assert.equal((await command(root, ['lesson', '06', 'setup'])).result.status, 'pass');

    const sensitiveFiles = [];
    for (const directory of ['submissions/06', 'evidence', 'journal', 'logs']) {
      sensitiveFiles.push(...await filesBelow(resolve(root, '.lab', directory)));
    }
    const persisted = (await Promise.all(
      sensitiveFiles.map((path) => readFile(path, 'utf8')),
    )).join('\n');
    for (const forbidden of [
      'alice@example.com',
      'Café-password-for-lesson-06',
      'Cafe\u0301-password-for-lesson-06',
      'wrong-password-for-lesson-06',
      servicePassword,
      'x-course-scenario-id',
      'x-course-control-token',
    ]) assert.equal(persisted.includes(forbidden), false, `persisted forbidden value: ${forbidden}`);
    const logsContainerId = (await managedRecord(root)).containers[0].containerId;
    const logs = (await docker(root, ['logs', logsContainerId])).stdout;
    assert.equal(logs.includes(servicePassword), false);
    assert.equal(logs.includes('Café-password-for-lesson-06'), false);

    const beforeStop = await managedRecord(root);
    assert.equal((await command(root, ['lesson', '06', 'stop'])).result.status, 'pass');
    assert.equal((await managedRecord(root)).status, 'stopped');
    assert.equal((await command(root, ['lesson', '06', 'setup'])).result.status, 'pass');
    const beforeResetRecord = await managedRecord(root);
    assert.equal(beforeResetRecord.status, 'running');
    assert.equal(beforeResetRecord.containers.length, beforeStop.containers.length);

    const beforeResetSecret = await readFile(
      resolve(root, '.lab/containers/ldap-directory/service-password'),
      'utf8',
    );
    assert.equal((await command(root, ['lesson', '06', 'reset'])).result.status, 'pass');
    const afterReset = await managedRecord(root);
    assert.notEqual(afterReset.containers[0].containerId, beforeResetRecord.containers[0].containerId);
    assert.notEqual(
      await readFile(resolve(root, '.lab/containers/ldap-directory/service-password'), 'utf8'),
      beforeResetSecret,
    );
    assert.equal((await command(root, ['lesson', '06', 'demo'])).result.status, 'pass');

    await writeFile(
      resolve(root, 'docker/ldap/compose.yml'),
      `${await readFile(resolve(root, 'docker/ldap/compose.yml'), 'utf8')}\n# source-drift cleanup probe\n`,
    );
    const purged = await command(root, ['purge', '--yes']);
    assert.equal(purged.result.status, 'pass', JSON.stringify(purged.result));
    assert.equal(purged.result.diagnostics.find(({ id }) => id === 'resources.remaining').actual, '0');
    await assert.rejects(lstat(resolve(root, '.lab')), (error) => error.code === 'ENOENT');
    await assertProjectAbsent(root, projectName);
  } finally {
    await emergencyStopProcess(root).catch(() => {});
    await emergencyRemoveProject(root, projectName).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
