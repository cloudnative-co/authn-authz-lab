import assert from 'node:assert/strict';
import { composeSecretReaderIdentity } from '../course/lessons/shared/compose-identity.mjs';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createLesson09ProtocolAdapter } from '../course/lessons/09/protocol-adapter.mjs';
import { runLesson09Scenario } from '../course/lessons/09/scenario.mjs';
import { runBoundedCommand } from '../course/runner/managed-compose.mjs';

const RUN_DOCKER = process.env.COURSE_TEST_DOCKER === '1';
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const COMPOSE_FILE = 'docker/saml/compose.yml';
let secretDirectory;
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
    signal: options.signal,
  });
}

before(async () => {
  if (!RUN_DOCKER) return;
  installId = randomBytes(16).toString('hex');
  projectName = `aa09it-${installId.slice(0, 16)}`;
  secretDirectory = await mkdtemp(join(tmpdir(), 'auth-authz-l09-it-'));
  await writeFile(join(secretDirectory, 'user-password'), 'course-password-for-saml-lab', { mode: 0o600 });
  await writeFile(join(secretDirectory, 'control-token'), randomBytes(32).toString('base64url'), { mode: 0o600 });
  environment = dockerEnvironment({
    ...composeSecretReaderIdentity(),
    COURSE_INSTALL_ID: installId,
    LESSON09_SECRET_DIR: secretDirectory,
  });
  const built = await docker(composeArgs('build', ['keycloak', 'sp', 'user-agent']), {
    timeoutMs: 10 * 60_000,
    maxOutputBytes: 16 * 1024 * 1024,
  });
  assert.equal(built.code, 0, built.stderr);
  const started = await docker(composeArgs('up', [
    '--detach', '--wait', '--wait-timeout', '120', 'user-agent',
  ]), { timeoutMs: 150_000 });
  if (started.code !== 0) {
    const logs = await docker(composeArgs('logs', ['--no-color', 'keycloak', 'sp', 'user-agent']));
    assert.equal(started.code, 0, `${started.stderr}\n${logs.stdout}\n${logs.stderr}`);
  }
});

after(async () => {
  if (!RUN_DOCKER) return;
  if (environment && projectName) {
    await docker(composeArgs('down', ['--volumes', '--remove-orphans']), { timeoutMs: 60_000 }).catch(() => {});
  }
  if (secretDirectory) await rm(secretDirectory, { recursive: true, force: true });
});

test('Lesson 09 completes actual Keycloak SSO and all signed one-fault rejections', {
  skip: !RUN_DOCKER,
  timeout: 4 * 60_000,
}, async () => {
  const executed = await docker(composeArgs('exec', [
    '--no-TTY', 'user-agent', 'node', 'client.mjs', 'scenario',
  ]), { timeoutMs: 120_000 });
  assert.equal(executed.code, 0, `${executed.stdout}\n${executed.stderr}`);
  const adapter = createLesson09ProtocolAdapter({
    executeOwnedService: async () => executed,
  });
  let runtime;
  try {
    runtime = await runLesson09Scenario({ adapter });
  } catch (error) {
    const logs = await docker(composeArgs('logs', ['--no-color', 'keycloak', 'sp', 'user-agent']));
    assert.fail(`${error.message}\n${logs.stdout}\n${logs.stderr}`);
  }
  assert.equal(runtime.actual.completed, true);
  assert.equal(runtime.actual.idpImplementation, 'Keycloak-26.7.0');
  assert.equal(runtime.conformance.caseCount, 11);
  assert.equal(runtime.conformance.allRejected, true);
  assert.equal(runtime.conformance.reasonsMatched, true);
  assert.equal(runtime.conformance.rejectedBeforeSession, true);
  assert.equal(JSON.stringify(runtime).includes('learner@example.test'), false);
  assert.equal(JSON.stringify(runtime).includes('course-password-for-saml-lab'), false);
});

test('Lesson 09 Compose is internal, read-only, labeled, and fixed to Keycloak digest', {
  skip: !RUN_DOCKER,
}, async () => {
  const configured = await docker(composeArgs('config', ['--format', 'json']));
  assert.equal(configured.code, 0);
  const config = JSON.parse(configured.stdout);
  assert.deepEqual(Object.keys(config.services).sort(), ['keycloak', 'sp', 'user-agent']);
  assert.ok(Object.values(config.services).every((service) => !service.ports));
  assert.ok(Object.values(config.services).every((service) => service.read_only === true));
  assert.equal(config.networks.default.internal, true);
  assert.equal(config.services.keycloak.user, `${process.getuid()}:0`);
  for (const name of ['sp', 'user-agent']) {
    assert.equal(config.services[name].user, `${process.getuid()}:${process.getgid()}`);
  }
  assert.match(
    await readFile(join(REPO_ROOT, 'docker/saml/keycloak/Dockerfile'), 'utf8'),
    /keycloak:26\.7\.0@sha256:2eb3cd316835/u,
  );
  for (const service of Object.values(config.services)) {
    assert.equal(service.labels['io.cloudnative.course.resource-id'], 'saml-lab');
    assert.equal(service.privileged ?? false, false);
  }
});

test('Lesson 09 logs omit credential and raw SAML material', { skip: !RUN_DOCKER }, async () => {
  const logs = await docker(composeArgs('logs', ['--no-color', 'keycloak', 'sp', 'user-agent']));
  assert.equal(logs.code, 0);
  const password = await readFile(join(secretDirectory, 'user-password'), 'utf8');
  assert.equal(logs.stdout.includes(password), false);
  assert.doesNotMatch(logs.stdout, /SAMLResponse=|<saml|lesson09_session=/iu);
});
