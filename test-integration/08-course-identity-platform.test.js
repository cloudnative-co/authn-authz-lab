import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { createLesson08ProtocolAdapter } from '../course/lessons/08/protocol-adapter.mjs';
import { runLesson08Scenario } from '../course/lessons/08/scenario.mjs';
import { runBoundedCommand } from '../course/runner/managed-compose.mjs';

const RUN_DOCKER = process.env.COURSE_TEST_DOCKER === '1';
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const COMPOSE_FILE = 'docker/samba-ad/compose.yml';

let secretDirectory;
let alicePassword;
let installId;
let projectName;
let environment;

function dockerEnvironment(extra = {}) {
  const value = {};
  for (const name of [
    'PATH', 'HOME', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR',
  ]) if (typeof process.env[name] === 'string') value[name] = process.env[name];
  return { ...value, ...extra };
}

function composeArgs(command, args = []) {
  return ['compose', '--project-name', projectName, '--file', COMPOSE_FILE, command, ...args];
}

async function docker(args, options = {}) {
  return runBoundedCommand('docker', args, {
    cwd: REPO_ROOT,
    env: environment,
    timeoutMs: options.timeoutMs ?? 60_000,
    maxOutputBytes: options.maxOutputBytes ?? 4 * 1024 * 1024,
    stdin: options.stdin ?? null,
    signal: options.signal,
  });
}

before(async () => {
  if (!RUN_DOCKER) return;
  installId = randomBytes(16).toString('hex');
  projectName = `aa08it-${installId.slice(0, 16)}`;
  secretDirectory = await mkdtemp(join(tmpdir(), 'auth-authz-l08-it-'));
  alicePassword = randomBytes(32).toString('base64url');
  const secrets = {
    'admin-password': randomBytes(32).toString('base64url'),
    'alice-password': alicePassword,
    'control-token': randomBytes(32).toString('base64url'),
    'service-password': randomBytes(32).toString('base64url'),
    'stable-id-key': randomBytes(32).toString('base64url'),
  };
  await Promise.all(Object.entries(secrets).map(([name, value]) => (
    writeFile(join(secretDirectory, name), value, { mode: 0o600 })
  )));
  environment = dockerEnvironment({
    COURSE_INSTALL_ID: installId,
    LESSON08_SECRET_DIR: secretDirectory,
  });

  const built = await docker(composeArgs('build', ['dc', 'app', 'client']), {
    timeoutMs: 15 * 60_000,
    maxOutputBytes: 16 * 1024 * 1024,
  });
  assert.equal(built.code, 0, built.stderr);
  const started = await docker(composeArgs('up', [
    '--detach', '--wait', '--wait-timeout', '120', 'client',
  ]), { timeoutMs: 150_000 });
  if (started.code !== 0) {
    const logs = await docker(composeArgs('logs', ['--no-color', 'dc', 'app', 'client']));
    assert.equal(started.code, 0, `${started.stderr}\n${logs.stdout}\n${logs.stderr}`);
  }
});

after(async () => {
  if (!RUN_DOCKER) return;
  if (environment && projectName) {
    await docker(composeArgs('down', ['--volumes', '--remove-orphans']), { timeoutMs: 60_000 })
      .catch(() => {});
  }
  if (secretDirectory) await rm(secretDirectory, { recursive: true, force: true });
});

test('Lesson 08 executes verified LDAPS, JML, session revalidation, and Kerberos against Samba', {
  skip: !RUN_DOCKER,
  timeout: 5 * 60_000,
}, async () => {
  const adapter = createLesson08ProtocolAdapter({
    executeOwnedService: async ({
      serviceName, argv, stdin, signal, timeoutMs, maxOutputBytes, acceptedExitCodes,
    }) => {
      const result = await docker(composeArgs('exec', ['--no-TTY', serviceName, ...argv]), {
        stdin, signal, timeoutMs, maxOutputBytes,
      });
      assert.ok(acceptedExitCodes.includes(result.code), result.stderr);
      return result;
    },
  });

  const runtime = await runLesson08Scenario({ adapter, password: alicePassword });
  assert.equal(runtime.implementation.sambaAdCompatibleDomainController, true);
  assert.equal(runtime.implementation.microsoftAdDsRuntime, false);
  assert.equal(runtime.implementation.freeIpaRuntime, false);
  assert.equal(runtime.directory.transport, 'LDAPS');
  assert.equal(runtime.directory.caVerified, true);
  assert.equal(runtime.directory.hostnameVerified, true);
  assert.deepEqual(runtime.directory.operations, [
    'service-bind',
    'structured-user-search',
    'resolved-user-bind',
    'structured-group-search',
    'explicit-group-to-role-mapping',
  ]);
  assert.equal(runtime.directory.serviceAccountWriteRejected, true);
  assert.equal(runtime.identity.stableIdPreservedAcrossMove, true);
  assert.equal(runtime.mapping.organizationGroupIgnored, 'Engineering');
  assert.deepEqual(runtime.joiner.sessionRole, ['viewer']);
  assert.deepEqual(runtime.mover.existingSessionRoleBeforeRevalidation, ['viewer']);
  assert.deepEqual(runtime.mover.newSessionRole, ['editor']);
  assert.equal(runtime.leaver.disabledLoginGeneric, true);
  assert.equal(runtime.leaver.existingSessionBeforeRevalidationStatus, 200);
  assert.equal(runtime.kerberos.tgtObservedByKlist, true);
  assert.equal(JSON.stringify(runtime).includes(alicePassword), false);
});

test('Lesson 08 Compose is internal, read-only, labeled, and publishes no host port', {
  skip: !RUN_DOCKER,
}, async () => {
  const configured = await docker(composeArgs('config', ['--format', 'json']));
  assert.equal(configured.code, 0, configured.stderr);
  const config = JSON.parse(configured.stdout);
  assert.deepEqual(Object.keys(config.services).sort(), ['app', 'client', 'dc']);
  assert.ok(Object.values(config.services).every((service) => !service.ports));
  assert.ok(Object.values(config.services).every((service) => service.read_only === true));
  assert.ok(Object.values(config.services).every((service) => (service.privileged ?? false) === false));
  assert.equal(config.networks.default.internal, true);
  for (const service of Object.values(config.services)) {
    assert.equal(service.labels['io.cloudnative.course.resource-id'], 'identity-platform-lab');
    assert.equal(service.labels['io.cloudnative.course.install-id'], installId);
  }
  assert.deepEqual(Object.keys(config.volumes).sort(), [
    'lesson08_ca_public',
    'lesson08_directory_data',
    'lesson08_samba_tls',
  ]);
  assert.equal(config.services.app.volumes.find(({ target }) => target === '/ca-public').read_only, true);
});

test('Lesson 08 logs omit runtime credentials and raw directory identifiers', {
  skip: !RUN_DOCKER,
}, async () => {
  const logs = await docker(composeArgs('logs', ['--no-color', 'dc', 'app', 'client']));
  assert.equal(logs.code, 0);
  assert.equal(logs.stdout.includes(alicePassword), false);
  for (const name of ['admin-password', 'service-password', 'stable-id-key', 'control-token']) {
    const secret = await readFile(join(secretDirectory, name), 'utf8');
    assert.equal(logs.stdout.includes(secret), false);
  }
  assert.doesNotMatch(logs.stdout, /objectGUID::|CN=Alice Course,/iu);
});
