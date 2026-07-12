import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { createLabConfig } from '../../apps/oauth-lab/config.mjs';
import { createAuthorizationServer } from '../../apps/oauth-lab/authorization-server.mjs';
import { pkceChallenge, randomOpaque } from '../../apps/oauth-lab/crypto.mjs';
import { createEvidenceRecorder } from '../../apps/oauth-lab/evidence.mjs';
import { createOAuthLab } from '../../apps/oauth-lab/lab.mjs';
import { TRAINING_RESOURCE_OWNER } from '../../apps/oauth-lab/resource-owner.mjs';
import { createResourceServer } from '../../apps/oauth-lab/resource-server.mjs';
import { createLabScenarioRegistry } from '../../apps/oauth-lab/scenario-registry.mjs';
import { createCookieJarUserAgent, runBrowserAuthorizationFlow } from '../../apps/oauth-lab/user-agent.mjs';
import { evaluateLesson10Submission, lesson10AnswerKey } from '../../course/lessons/10/assessment.mjs';
import { runLesson10Scenario } from '../../course/lessons/10/scenario.mjs';
import { evaluateLesson11Submission, lesson11AnswerKey } from '../../course/lessons/11/assessment.mjs';
import { runLesson11Scenario } from '../../course/lessons/11/scenario.mjs';
import { createOAuthLabScenarioControl } from '../../course/lessons/10/managed-lab.mjs';
import { startManagedNode, stopManagedProcess } from '../../course/runner/managed-process.mjs';
import { probeTcpPort } from '../../course/runner/port.mjs';
import {
  fixtureRepository,
  liveProcesses,
  startOptions,
  waitUntilGone,
} from '../course/managed-process-fixture.js';

function refFrom(html) {
  return /name="ref" value="([A-Za-z0-9_-]{43})"/u.exec(html)?.[1];
}

async function managedLab() {
  const token = randomOpaque();
  const identity = {
    pid: process.pid,
    installId: 'oauth-test-install',
    runId: randomOpaque().slice(0, 22),
  };
  identity.instanceId = `${identity.installId}.${identity.runId}`;
  let lab;
  lab = await createOAuthLab({
    control: { identity, shutdownToken: token, onShutdown: async () => lab.stop() },
  });
  await lab.start();
  const headers = (scenarioId = null) => ({
    'x-course-instance-id': identity.instanceId,
    'x-course-control-token': token,
    ...(scenarioId ? { 'x-course-scenario-id': scenarioId } : {}),
  });
  const scenarioControl = Object.freeze({
    async create(profile) {
      const response = await fetch(`${lab.config.issuer}/__course/scenarios`, {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ profile }),
      });
      return (await response.json()).scenario_id;
    },
    async evidence(id) {
      return (await (await fetch(`${lab.config.issuer}/__course/scenarios`, {
        headers: headers(id),
      })).json()).events;
    },
    async remove(id) {
      await fetch(`${lab.config.issuer}/__course/scenarios`, {
        method: 'DELETE', headers: headers(id),
      });
    },
  });
  return { lab, scenarioControl };
}

async function beginGrant(config, { scope, responseType = 'code', redirectUri = config.oidcRedirectUri } = {}) {
  const ua = createCookieJarUserAgent();
  const verifier = randomOpaque();
  const state = randomOpaque();
  const nonce = randomOpaque();
  const authorize = new URL('/oauth/authorize', config.issuer);
  for (const [name, value] of Object.entries({
    response_type: responseType,
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
    ...(scope.includes('openid') ? { nonce } : {}),
  })) authorize.searchParams.set(name, value);
  const loginPage = await ua.request(authorize);
  const ref = refFrom(await loginPage.text());
  const login = await ua.request(`${config.issuer}/interaction/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ref, ...TRAINING_RESOURCE_OWNER }),
  });
  const consentPage = await ua.request(login.headers.get('location'));
  const consentRef = refFrom(await consentPage.text());
  return { ua, verifier, state, nonce, login, consentRef };
}

async function grantCode(config, options) {
  const pending = await beginGrant(config, options);
  const consent = await pending.ua.request(`${config.issuer}/interaction/consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ref: pending.consentRef, decision: 'allow' }),
  });
  return { ...pending, code: new URL(consent.headers.get('location')).searchParams.get('code') };
}

async function token(config, grant, extra = {}) {
  return fetch(`${config.issuer}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...extra.headers },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      redirect_uri: config.oidcRedirectUri,
      code: grant.code,
      code_verifier: grant.verifier,
    }),
  });
}

async function rawRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    request.end(options.body);
  });
}

async function oauthManagedOptions(fixture, label) {
  const wrapper = resolve(fixture.repoRoot, `oauth-lab-${label}.mjs`);
  const main = pathToFileURL(resolve(import.meta.dirname, '../../apps/oauth-lab/main.mjs')).href;
  await writeFile(wrapper, `await import(${JSON.stringify(main)});\n`, { mode: 0o600 });
  const options = await startOptions(fixture, label);
  options.scriptPath = wrapper;
  options.origin = 'http://127.0.0.1:4100';
  options.stdoutPath = resolve(
    fixture.context.stateRoot, 'logs', `oauth-lab-${options.runId}.stdout.log`,
  );
  options.stderrPath = resolve(
    fixture.context.stateRoot, 'logs', `oauth-lab-${options.runId}.stderr.log`,
  );
  options.timeoutMs = 5_000;
  return options;
}

async function readOauthPair(fixture) {
  const resource = resolve(fixture.context.stateRoot, 'processes', 'oauth-lab');
  const pointer = JSON.parse(await readFile(resolve(resource, 'current.json'), 'utf8'));
  const generation = resolve(resource, 'generations', pointer.generationId);
  const optional = (name) => readFile(resolve(generation, name), 'utf8')
    .then(JSON.parse)
    .catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  return {
    intent: await optional('intent.json'),
    record: await optional('record.json'),
    control: await optional('control.json'),
  };
}

function oauthFoundation(fixture) {
  const entries = [
    ['oauth-authorization-server-http', 4100],
    ['oauth-client-http', 4101],
    ['oauth-resource-api-http', 4102],
  ].map(([id, port]) => [id, {
    id,
    host: '127.0.0.1',
    port,
    protocol: 'http',
    resourceId: 'oauth-lab',
  }]);
  return {
    repositoryRealpath: fixture.repoRoot,
    manifest: { resources: [{ id: 'oauth-lab', type: 'process' }] },
    indexes: { ports: new Map(entries) },
  };
}

test('Lesson 10 actual HTTP scenario is repeatable and satisfies both checks', async () => {
  const { lab, scenarioControl } = await managedLab();
  let first;
  let second;
  try {
    first = await runLesson10Scenario({ config: lab.config, scenarioControl });
    second = await runLesson10Scenario({ config: lab.config, scenarioControl });
  } finally {
    await lab.stop();
  }
  assert.deepEqual(second, first);
  assert.equal(first.topology.originsSeparated, true);
  assert.equal(first.success.resourceAuthorized, true);
  assert.equal(first.rejections.stateMismatchStatus, 400);
  assert.equal(first.rejections.pkceMismatchStatus, 400);
  assert.equal(first.rejections.codeReplayRejected, true);
  assert.equal(first.rejections.unregisteredRedirectLocationAbsent, true);
  assert.equal(first.bearer.missingStatus, 401);
  assert.equal(first.bearer.insufficientScopeStatus, 403);
  assert.equal(first.introspection.serverSurvived, true);
  assert.equal(first.safety.secretsOmitted, true);
  assert.equal(evaluateLesson10Submission(lesson10AnswerKey(), first).status, 'pass');
});

test('Lesson 11 actual HTTP scenario rejects each one-fault ID Token and is repeatable', async () => {
  const { lab, scenarioControl } = await managedLab();
  let first;
  let second;
  try {
    first = await runLesson11Scenario({ config: lab.config, scenarioControl });
    second = await runLesson11Scenario({ config: lab.config, scenarioControl });
  } finally {
    await lab.stop();
  }
  assert.deepEqual(second, first);
  assert.equal(first.success.authenticatedPage, true);
  assert.equal(first.success.idTokenDelivery, 'backchannel-token-response-only');
  assert.equal(Object.values(first.rejections).every(({ rejectedByNormalCallback }) => rejectedByNormalCallback), true);
  assert.equal(first.cookieBoundary.duplicateSessionCookieRejected, true);
  assert.equal(first.safety.secretsOmitted, true);
  assert.equal(evaluateLesson11Submission(lesson11AnswerKey(), first).status, 'pass');
});

test('discovery declares a public client and ID Token email follows the email scope', async () => {
  const lab = await createOAuthLab();
  await lab.start();
  try {
    const metadata = await (await fetch(`${lab.config.issuer}/.well-known/openid-configuration`)).json();
    assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
    assert.deepEqual(metadata.grant_types_supported, ['authorization_code']);
    assert.equal(metadata.authorization_response_iss_parameter_supported, true);

    const grant = await grantCode(lab.config, { scope: 'openid profile:read' });
    const rejectedAuth = await token(lab.config, grant, {
      headers: { authorization: 'Basic Zm9vOmJhcg==' },
    });
    assert.equal(rejectedAuth.status, 400);
    assert.equal((await rejectedAuth.json()).error, 'invalid_request');
    const accepted = await token(lab.config, grant);
    assert.equal(accepted.status, 200);
    const tokenBody = await accepted.json();
    const jwks = await (await fetch(metadata.jwks_uri)).json();
    const verified = await jwtVerify(tokenBody.id_token, createLocalJWKSet(jwks), {
      algorithms: ['RS256'], issuer: lab.config.issuer, audience: lab.config.clientId,
    });
    assert.equal(typeof verified.payload.sub, 'string');
    assert.ok(verified.payload.sub.length > 0);
    assert.equal(verified.payload.email, undefined);
  } finally {
    await lab.stop();
  }
});

test('authorization errors use the trusted redirect boundary and interaction cookies fail closed', async () => {
  const lab = await createOAuthLab();
  await lab.start();
  try {
    const base = new URL('/oauth/authorize', lab.config.issuer);
    const fields = {
      response_type: 'token', client_id: lab.config.clientId, redirect_uri: lab.config.oauthRedirectUri,
      scope: 'project:read', state: randomOpaque(), code_challenge: randomOpaque(), code_challenge_method: 'S256',
    };
    for (const [name, value] of Object.entries(fields)) base.searchParams.set(name, value);
    const trustedError = await fetch(base, { redirect: 'manual' });
    assert.equal(trustedError.status, 302);
    const trustedLocation = new URL(trustedError.headers.get('location'));
    assert.equal(trustedLocation.origin + trustedLocation.pathname, lab.config.oauthRedirectUri);
    assert.equal(trustedLocation.searchParams.get('error'), 'unsupported_response_type');
    assert.equal(trustedLocation.searchParams.get('iss'), lab.config.issuer);

    base.searchParams.set('response_type', 'code');
    base.searchParams.set('redirect_uri', 'http://127.0.0.1:4998/callback');
    const untrusted = await fetch(base, { redirect: 'manual' });
    assert.equal(untrusted.status, 400);
    assert.equal(untrusted.headers.get('location'), null);

    base.searchParams.set('redirect_uri', lab.config.oauthRedirectUri);
    base.searchParams.append('client_id', lab.config.clientId);
    const ambiguousClient = await fetch(base, { redirect: 'manual' });
    assert.equal(ambiguousClient.status, 400);
    assert.equal(ambiguousClient.headers.get('location'), null);

    const pending = await beginGrant(lab.config, { scope: 'openid profile:read' });
    const cookieValue = pending.login.headers.get('set-cookie').split(';', 1)[0];
    const duplicateCookie = await fetch(pending.login.headers.get('location'), {
      headers: { cookie: `${cookieValue}; ${cookieValue}` },
    });
    assert.equal(duplicateCookie.status, 200);
    const duplicateBody = await duplicateCookie.text();
    assert.match(duplicateBody, /Authorization Serverへだけ送信/u);
    const malformedCookie = await fetch(pending.login.headers.get('location'), {
      headers: { cookie: 'course_as_session=%%%' },
    });
    assert.equal(malformedCookie.status, 200);
    assert.equal(await malformedCookie.text(), duplicateBody);
    const oversizedCookie = await fetch(pending.login.headers.get('location'), {
      headers: { cookie: `course_as_session=${'A'.repeat(4100)}` },
    });
    assert.equal(oversizedCookie.status, 200);
    assert.equal(await oversizedCookie.text(), duplicateBody);

    const duplicateDecision = await pending.ua.request(`${lab.config.issuer}/interaction/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `ref=${encodeURIComponent(pending.consentRef)}&decision=allow&decision=deny`,
    });
    assert.equal(duplicateDecision.status, 400);

    const rpMissing = await fetch(`${lab.config.clientOrigin}/me`);
    const rpMalformed = await fetch(`${lab.config.clientOrigin}/me`, {
      headers: { cookie: 'course_rp_session=%%%' },
    });
    const rpOversized = await fetch(`${lab.config.clientOrigin}/me`, {
      headers: { cookie: `course_rp_session=${'A'.repeat(4100)}` },
    });
    assert.deepEqual([rpMissing.status, rpMalformed.status, rpOversized.status], [403, 403, 403]);
    assert.equal(await rpMalformed.text(), await rpMissing.text());

    const duplicateAuthorization = await rawRequest(`${lab.config.apiOrigin}/api/projects`, {
      method: 'GET',
      headers: { authorization: [`Bearer ${randomOpaque()}`, `Bearer ${randomOpaque()}`] },
    });
    assert.equal(duplicateAuthorization.status, 401);
    assert.match(duplicateAuthorization.headers['www-authenticate'], /invalid_token/u);
  } finally {
    await lab.stop();
  }
});

test('authorization server records a post-response exception once without a second response', async () => {
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const asPort = blocker.address().port;
  await new Promise((resolve) => blocker.close(resolve));
  const config = createLabConfig({ asPort, clientPort: asPort + 1, apiPort: asPort + 2 });
  const events = [];
  let recordCalls = 0;
  const scenario = {
    idTokenFaultQueue: [],
    evidence: {
      record(event) {
        recordCalls += 1;
        if (recordCalls === 1) throw new Error('post-response recorder failure');
        events.push(event);
      },
    },
  };
  const authorization = await createAuthorizationServer({
    config,
    authenticate: async () => null,
    resourceSecret: randomOpaque(),
    scenarioRegistry: { fromRequest: () => scenario },
  });
  await new Promise((resolve) => authorization.server.listen(asPort, '127.0.0.1', resolve));
  try {
    const response = await fetch(`${config.issuer}/does-not-exist`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'not_found' });
    assert.equal(recordCalls, 2);
    assert.equal(events.length, 1);
    assert.equal(events[0].reason, 'INTERNAL_ERROR');
    assert.equal(events[0].status, 500);
  } finally {
    await new Promise((resolve) => authorization.server.close(resolve));
  }
});

test('empty subject is rejected after library validation and before app session issuance', async () => {
  const lab = await createOAuthLab({ idTokenFaultQueue: ['subject'] });
  await lab.start();
  try {
    const flow = await runBrowserAuthorizationFlow({ config: lab.config, lessonId: '11' });
    assert.equal(flow.statuses.callback, 400);
    const callback = lab.evidence().filter(({ path }) => path === '/oidc/callback').at(-1);
    assert.equal(callback.reason, 'ID_TOKEN_SUBJECT_REJECTED');
    assert.equal(callback.checks.idTokenValidated, false);
  } finally {
    await lab.stop();
  }
});

test('introspection transport failure is 503 rather than an invalid-token 401', async () => {
  let mode = 'status';
  const fakeAs = createServer((request, response) => {
    if (mode === 'oversized') {
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.write('{"active":false,"padding":"');
      response.end(`${'x'.repeat(70 * 1024)}"}`);
      return;
    }
    response.statusCode = 500;
    response.end('unavailable');
  });
  await new Promise((resolve) => fakeAs.listen(0, '127.0.0.1', resolve));
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const apiPort = blocker.address().port;
  await new Promise((resolve) => blocker.close(resolve));
  const config = createLabConfig({ asPort: fakeAs.address().port, clientPort: apiPort + 1, apiPort });
  const evidence = createEvidenceRecorder();
  const resource = createResourceServer({
    config,
    evidence,
    resourceSecret: randomOpaque(),
    scenarioRegistry: createLabScenarioRegistry(),
  });
  await new Promise((resolve) => resource.server.listen(apiPort, '127.0.0.1', resolve));
  try {
    const response = await fetch(`${config.apiOrigin}/api/projects`, {
      headers: { authorization: `Bearer ${randomOpaque()}` },
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.equal(response.headers.get('www-authenticate'), null);
    assert.equal((await response.json()).error.code, 'TOKEN_VALIDATION_UNAVAILABLE');
    mode = 'oversized';
    const oversized = await fetch(`${config.apiOrigin}/api/projects`, {
      headers: { authorization: `Bearer ${randomOpaque()}` },
    });
    assert.equal(oversized.status, 503);
    assert.equal(oversized.headers.get('retry-after'), '1');
  } finally {
    await new Promise((resolve) => resource.server.close(resolve));
    await new Promise((resolve) => fakeAs.close(resolve));
  }
});

test('malformed active introspection scope is an invalid token rather than a granted scope', async () => {
  const malformedScopes = [
    ['array', ['project:read']],
    ['duplicate', 'project:read project:read'],
    ['invalid-character', 'project:read\\bad'],
    ['oversized', `project:read${'x'.repeat(512)}`],
  ];
  let scope = malformedScopes[0][1];
  const fakeAs = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      active: true,
      aud: config.audience,
      token_type: 'Bearer',
      sub: 'subject-1',
      client_id: 'course-browser-client',
      exp: Math.floor(Date.now() / 1000) + 60,
      scope,
    }));
  });
  await new Promise((resolve) => fakeAs.listen(0, '127.0.0.1', resolve));
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const apiPort = blocker.address().port;
  await new Promise((resolve) => blocker.close(resolve));
  const config = createLabConfig({ asPort: fakeAs.address().port, clientPort: apiPort + 1, apiPort });
  const resource = createResourceServer({
    config,
    resourceSecret: randomOpaque(),
    scenarioRegistry: createLabScenarioRegistry(),
  });
  await new Promise((resolve) => resource.server.listen(apiPort, '127.0.0.1', resolve));
  try {
    for (const [label, malformed] of malformedScopes) {
      scope = malformed;
      const response = await fetch(`${config.apiOrigin}/api/projects`, {
        headers: { authorization: `Bearer ${randomOpaque()}` },
      });
      assert.equal(response.status, 401, label);
      assert.match(response.headers.get('www-authenticate'), /invalid_token/u, label);
      assert.equal((await response.json()).error.code, 'INVALID_TOKEN', label);
    }
  } finally {
    await new Promise((resolve) => resource.server.close(resolve));
    await new Promise((resolve) => fakeAs.close(resolve));
  }
});

test('one managed process owns all three origins and isolated scenarios do not affect manual browser state', async () => {
  const fixture = await fixtureRepository();
  const options = await oauthManagedOptions(fixture, 'three-origin');
  const started = await startManagedNode({
    stateRoot: fixture.context.stateRoot,
    repoRoot: fixture.repoRoot,
    resourceId: 'oauth-lab',
    allowedResourceIds: ['oauth-lab'],
    startOptions: options,
  });
  liveProcesses.set(started.record.pid, started.record);
  try {
    const health = await Promise.all([4100, 4101, 4102].map(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/__course/health`);
      assert.equal(response.status, 200);
      return response.json();
    }));
    assert.deepEqual(health.map(({ pid }) => pid), [
      started.record.pid, started.record.pid, started.record.pid,
    ]);
    assert.deepEqual(health.map(({ instanceId }) => instanceId), [
      started.record.instanceId, started.record.instanceId, started.record.instanceId,
    ]);
    assert.deepEqual(health.slice(1).map(({ role }) => role), ['oauth-client', 'resource-api']);
    assert.equal((await fetch('http://127.0.0.1:4101/start')).status, 200);
    assert.equal((await fetch('http://127.0.0.1:4102/api/projects')).status, 401);
    const scenarioControl = createOAuthLabScenarioControl({
      foundation: oauthFoundation(fixture),
      stateRoot: fixture.context.stateRoot,
    });
    const config = createLabConfig();
    const manualBefore = await runBrowserAuthorizationFlow({ config, lessonId: '11' });
    assert.equal(manualBefore.statuses.final, 200);
    for (let index = 0; index < 270; index += 1) {
      assert.equal((await fetch('http://127.0.0.1:4100/__course/health')).status, 200);
    }
    const runtime = await runLesson11Scenario({ config, scenarioControl });
    assert.equal(Object.values(runtime.rejections).every((item) => item.rejectedByNormalCallback), true);
    assert.equal(runtime.safety.traces.every(({ path }) => !path.startsWith('/__course/')), true);
    const manualAfter = await runBrowserAuthorizationFlow({ config, lessonId: '11' });
    assert.equal(manualAfter.statuses.final, 200);
    const unauthorizedControl = await fetch('http://127.0.0.1:4100/__course/scenarios', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ profile: 'lesson-11' }),
    });
    assert.equal(unauthorizedControl.status, 403);
  } finally {
    const stopped = await stopManagedProcess({
      stateRoot: fixture.context.stateRoot,
      repoRoot: fixture.repoRoot,
      resourceId: 'oauth-lab',
      allowedResourceIds: ['oauth-lab'],
    });
    assert.ok(['stopped', 'safe-noop'].includes(stopped.status));
    await waitUntilGone(started.record.pid);
    liveProcesses.delete(started.record.pid);
  }
  for (const port of [4100, 4101, 4102]) {
    assert.equal((await probeTcpPort({ host: '127.0.0.1', port })).available, true);
  }
});

test('third-origin bind failure closes the first two listeners and leaves the foreign listener untouched', async () => {
  const foreign = createServer((request, response) => {
    response.statusCode = 204;
    response.end();
  });
  await new Promise((resolve) => foreign.listen(4102, '127.0.0.1', resolve));
  const fixture = await fixtureRepository();
  const options = await oauthManagedOptions(fixture, 'partial-bind');
  try {
    await assert.rejects(startManagedNode({
      stateRoot: fixture.context.stateRoot,
      repoRoot: fixture.repoRoot,
      resourceId: 'oauth-lab',
      allowedResourceIds: ['oauth-lab'],
      startOptions: options,
    }), (error) => ['PROCESS_START_FAILED', 'PROCESS_START_PERSIST_FAILED'].includes(error.reasonCode));
    assert.equal((await probeTcpPort({ host: '127.0.0.1', port: 4100 })).available, true);
    assert.equal((await probeTcpPort({ host: '127.0.0.1', port: 4101 })).available, true);
    assert.equal((await fetch('http://127.0.0.1:4102/')).status, 204);
    const pair = await readOauthPair(fixture);
    assert.equal(pair.intent.status, 'aborted');
    assert.equal(pair.control.status, 'retired');
    assert.equal(pair.control.shutdownToken, null);
    if (pair.record) assert.equal(pair.record.status, 'stopped');
  } finally {
    await new Promise((resolve) => foreign.close(resolve));
  }
});
