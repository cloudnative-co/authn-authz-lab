import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { createLesson07ProtocolAdapter } from '../course/lessons/07/protocol-adapter.mjs';
import { runLesson07Scenario } from '../course/lessons/07/scenario.mjs';
import { runBoundedCommand } from '../course/runner/managed-compose.mjs';

const RUN_DOCKER = process.env.COURSE_TEST_DOCKER === '1';
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const COMPOSE_FILE = 'docker/kerberos/compose.yml';

let secretDirectory;
let password;
let installId;
let projectName;
let environment;

function dockerEnvironment(extra = {}) {
  const value = {};
  for (const name of [
    'PATH', 'HOME', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR',
  ]) {
    if (typeof process.env[name] === 'string') value[name] = process.env[name];
  }
  return { ...value, ...extra };
}

function composeArgs(command, args = []) {
  return ['compose', '--project-name', projectName, '--file', COMPOSE_FILE, command, ...args];
}

async function docker(args, options = {}) {
  return runBoundedCommand('docker', args, {
    cwd: REPO_ROOT,
    env: environment,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxOutputBytes: options.maxOutputBytes ?? 1024 * 1024,
    stdin: options.stdin ?? null,
    signal: options.signal,
  });
}

before(async () => {
  if (!RUN_DOCKER) return;
  installId = randomBytes(16).toString('hex');
  projectName = `aa07it-${installId.slice(0, 16)}`;
  secretDirectory = await mkdtemp(join(tmpdir(), 'auth-authz-l07-it-'));
  password = randomBytes(24).toString('base64url');
  await writeFile(join(secretDirectory, 'kdc-master-password'), randomBytes(24).toString('base64url'), { mode: 0o600 });
  await writeFile(join(secretDirectory, 'alice-password'), password, { mode: 0o600 });
  environment = dockerEnvironment({
    COURSE_INSTALL_ID: installId,
    LESSON07_SECRET_DIR: secretDirectory,
  });

  const built = await docker(composeArgs('build', ['kdc', 'app', 'client']), {
    timeoutMs: 10 * 60_000,
    maxOutputBytes: 8 * 1024 * 1024,
  });
  assert.equal(built.code, 0, 'Lesson 07 images must build');
  const started = await docker(composeArgs('up', ['--detach', '--wait', '--wait-timeout', '60', 'client']), {
    timeoutMs: 90_000,
  });
  assert.equal(started.code, 0, 'Lesson 07 services must become healthy');
});

after(async () => {
  if (!RUN_DOCKER) return;
  if (environment && projectName) {
    await docker(composeArgs('down', ['--volumes', '--remove-orphans']), { timeoutMs: 60_000 }).catch(() => {});
  }
  if (secretDirectory) await rm(secretDirectory, { recursive: true, force: true });
});

test('Lesson 07 executes real AS, TGS and GSSAPI rejection paths', { skip: !RUN_DOCKER }, async () => {
  const calls = [];
  const adapter = createLesson07ProtocolAdapter({
    executeOwnedService: async ({
      serviceName, argv, stdin, signal, timeoutMs, maxOutputBytes, acceptedExitCodes,
    }) => {
      calls.push({ serviceName, argv, stdinPresent: stdin !== null });
      const result = await docker(composeArgs('exec', ['--no-TTY', serviceName, ...argv]), {
        stdin, signal, timeoutMs, maxOutputBytes,
      });
      assert.ok(acceptedExitCodes.includes(result.code));
      return result;
    },
  });

  const runtime = await runLesson07Scenario({ adapter, password });
  assert.equal(runtime.normal.afterKinit.tgtPresent, true);
  assert.equal(runtime.normal.afterKinit.httpServiceTicketPresent, false);
  assert.equal(runtime.normal.challenge.status, 401);
  assert.equal(runtime.normal.challenge.scheme, 'Negotiate');
  assert.equal(runtime.normal.authenticated.status, 200);
  assert.equal(runtime.normal.authenticated.principal, 'alice@EXAMPLE.TEST');
  assert.equal(runtime.normal.afterServiceRequest.httpServiceTicketPresent, true);
  assert.equal(runtime.rejection.wrongSpn.reason, 'SERVICE_PRINCIPAL_UNKNOWN');
  assert.equal(runtime.rejection.clockSkew.reason, 'CLOCK_SKEW_REJECTED');
  assert.equal(runtime.rejection.staleKeytab.reason, 'ACCEPTOR_KEY_MISMATCH');
  assert.equal(runtime.rejection.staleKeytab.currentRestored, true);
  assert.equal(runtime.rejection.genericHttpSurface, true);
  assert.equal(runtime.protocol.generalSpnegoContinuationSupported, false);
  assert.equal(runtime.protocol.incompleteContextCount, 0);
  assert.equal(runtime.protocol.finalAcceptorTokenObserved, true);
  assert.equal(runtime.protocol.curlGssApi, true);
  assert.equal(runtime.protocol.curlSpnego, true);
  assert.equal(JSON.stringify(runtime).includes(password), false);

  const kinitCalls = calls.filter(({ argv }) => argv[0] === 'kinit');
  assert.ok(kinitCalls.length >= 3);
  assert.ok(kinitCalls.every(({ stdinPresent }) => stdinPresent));
  assert.ok(calls.every(({ argv }) => !argv.some((value) => value.includes(password))));
});

test('Lesson 07 Compose contract labels all owned resources and exposes no host port', { skip: !RUN_DOCKER }, async () => {
  const configured = await docker(composeArgs('config', ['--format', 'json']));
  assert.equal(configured.code, 0);
  const config = JSON.parse(configured.stdout);
  assert.deepEqual(Object.keys(config.services).sort(), ['app', 'client', 'kdc']);
  assert.ok(Object.values(config.services).every((service) => !service.ports));
  for (const service of Object.values(config.services)) {
    assert.equal(service.labels['io.cloudnative.course.id'], 'auth-authz');
    assert.equal(service.labels['io.cloudnative.course.install-id'], installId);
    assert.equal(service.labels['io.cloudnative.course.resource-id'], 'kerberos-lab');
  }
  assert.equal(config.networks.default.labels['io.cloudnative.course.resource-id'], 'kerberos-lab');
  assert.equal(config.networks.default.internal, true);
  assert.equal(config.volumes.lesson07_keytabs.labels['io.cloudnative.course.resource-id'], 'kerberos-lab');
  const keytabMount = config.services.app.volumes.find(({ target }) => target === '/keytabs');
  assert.equal(keytabMount.read_only, true);
  assert.equal(config.services.kdc.read_only, true);
  assert.equal(config.services.app.read_only, true);
  assert.equal(config.services.client.read_only, true);
  assert.ok(config.services.kdc.tmpfs.some((entry) => entry.startsWith('/var/lib/krb5kdc:')));
  assert.ok(config.services.app.tmpfs.some((entry) => entry.startsWith('/var/tmp:')));
  assert.ok(config.services.client.tmpfs.some((entry) => entry.startsWith('/tmp:')));
});

test('Lesson 07 service logs omit credentials, tokens and native errors', { skip: !RUN_DOCKER }, async () => {
  const logged = await docker(composeArgs('logs', ['--no-color', 'kdc', 'app', 'client']));
  assert.equal(logged.code, 0);
  assert.equal(logged.stdout.includes(password), false);
  assert.doesNotMatch(logged.stdout, /Authorization:\s*Negotiate/iu);
  assert.doesNotMatch(logged.stdout, /debugNativeError|Unspecified GSS failure/iu);
  assert.match(logged.stdout, /CLOCK_SKEW_REJECTED/iu);
  assert.match(logged.stdout, /ACCEPTOR_KEY_MISMATCH/iu);
});
