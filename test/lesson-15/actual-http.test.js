import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { createOAuthLab } from '../../apps/oauth-lab/lab.mjs';
import { pkceChallenge, randomOpaque } from '../../apps/oauth-lab/crypto.mjs';
import { TRAINING_RESOURCE_OWNERS } from '../../apps/oauth-lab/resource-owner.mjs';
import { createCookieJarUserAgent } from '../../apps/oauth-lab/user-agent.mjs';
import { evaluateLesson15Submission, lesson15AnswerKey } from '../../course/lessons/15/assessment.mjs';
import { runLesson15Scenario } from '../../course/lessons/15/scenario.mjs';

function hiddenReference(html) {
  return /name="ref" value="([A-Za-z0-9_-]{43})"/u.exec(html)?.[1] ?? null;
}

async function managedLab() {
  const shutdownToken = randomOpaque();
  const identity = {
    pid: process.pid,
    installId: 'lesson-15-test',
    runId: randomOpaque().slice(0, 22),
  };
  identity.instanceId = `${identity.installId}.${identity.runId}`;
  let lab;
  lab = await createOAuthLab({
    control: { identity, shutdownToken, onShutdown: async () => lab.stop() },
  });
  await lab.start();
  const controlHeaders = (scenarioId = null) => ({
    'x-course-instance-id': identity.instanceId,
    'x-course-control-token': shutdownToken,
    ...(scenarioId ? { 'x-course-scenario-id': scenarioId } : {}),
  });
  const scenarioControl = Object.freeze({
    async create(profile) {
      const response = await fetch(`${lab.config.issuer}/__course/scenarios`, {
        method: 'POST',
        headers: { ...controlHeaders(), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ profile }),
      });
      assert.equal(response.status, 201);
      return (await response.json()).scenario_id;
    },
    async evidence(id) {
      return (await (await fetch(`${lab.config.issuer}/__course/scenarios`, {
        headers: controlHeaders(id),
      })).json()).events;
    },
    async remove(id) {
      const response = await fetch(`${lab.config.issuer}/__course/scenarios`, {
        method: 'DELETE', headers: controlHeaders(id),
      });
      assert.equal(response.status, 204);
    },
  });
  return { lab, scenarioControl };
}

async function obtainJwtAccessToken(config) {
  const userAgent = createCookieJarUserAgent();
  const verifier = randomOpaque();
  const authorize = new URL('/oauth/authorize', config.issuer);
  for (const [name, value] of Object.entries({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.apiRedirectUri,
    scope: 'project:delete',
    state: randomOpaque(),
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
    resource: config.audience,
  })) authorize.searchParams.set(name, value);
  const interaction = await userAgent.request(authorize);
  const reference = hiddenReference(await interaction.text());
  const alice = TRAINING_RESOURCE_OWNERS.find(({ subject }) => subject === 'user-100');
  const login = await userAgent.request(`${config.issuer}/interaction/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ref: reference, identifier: alice.identifier, password: alice.password,
    }),
  });
  const consent = await userAgent.request(login.headers.get('location'));
  const consentReference = hiddenReference(await consent.text());
  const granted = await userAgent.request(`${config.issuer}/interaction/consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ref: consentReference, decision: 'allow' }),
  });
  const code = new URL(granted.headers.get('location')).searchParams.get('code');
  const token = await fetch(`${config.issuer}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.apiRedirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
      resource: config.audience,
    }),
  });
  assert.equal(token.status, 200);
  return (await token.json()).access_token;
}

test('actual Authorization Code flow issues an RFC 9068 shaped token and Resource API verifies it through JWKS', async () => {
  const { lab } = await managedLab();
  try {
    const accessToken = await obtainJwtAccessToken(lab.config);
    assert.deepEqual(decodeProtectedHeader(accessToken), {
      alg: 'RS256', typ: 'at+jwt', kid: 'course-op-rs256-1',
    });
    const jwks = await (await fetch(`${lab.config.issuer}/oauth/jwks`)).json();
    const verified = await jwtVerify(accessToken, createLocalJWKSet(jwks), {
      algorithms: ['RS256'], issuer: lab.config.issuer, audience: lab.config.audience,
    });
    assert.equal(verified.payload.sub, 'user-100');
    assert.equal(verified.payload.client_id, lab.config.clientId);
    assert.equal(verified.payload.scope, 'project:delete');
    for (const claim of ['iss', 'exp', 'aud', 'sub', 'client_id', 'iat', 'jti', 'scope']) {
      assert.equal(Object.hasOwn(verified.payload, claim), true, claim);
    }
    const resource = await fetch(`${lab.config.apiOrigin}/api/projects/p-100`, {
      method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(resource.status, 204);
  } finally {
    await lab.stop();
  }
});

test('fresh Lesson 15 scenarios reject one fault at a time before project policy and are repeatable', async () => {
  const { lab, scenarioControl } = await managedLab();
  try {
    const first = await runLesson15Scenario({ config: lab.config, scenarioControl });
    const second = await runLesson15Scenario({ config: lab.config, scenarioControl });
    assert.deepEqual(second, first);
    assert.equal(evaluateLesson15Submission(lesson15AnswerKey(), first).status, 'pass');
    assert.deepEqual(first.bearer.invalidStatuses, Array(13).fill(401));
    assert.equal(first.authorization.insufficientScopeStatus, 403);
    assert.equal(first.authorization.viewerStatus, 403);
    assert.equal(first.authorization.crossTenantStatus, 404);
    assert.equal(first.authorization.unknownProjectStatus, 404);
    assert.equal(first.success.resourceStatus, 204);
    assert.equal(first.authorization.tokenChecksBeforePolicy, true);
    assert.equal(first.safety.secretsOmitted, true);

    const reasons = first.safety.traces
      .filter(({ role }) => role === 'resource-api')
      .map(({ reason }) => reason);
    assert.deepEqual(reasons, [
      'BEARER_REQUIRED',
      'TOKEN_FORMAT_REJECTED',
      'TOKEN_SIGNATURE_REJECTED',
      'TOKEN_ISSUER_REJECTED',
      'TOKEN_AUDIENCE_REJECTED',
      'TOKEN_EXPIRED',
      'TOKEN_TYPE_REJECTED',
      'TOKEN_TYPE_REJECTED',
      ...Array(6).fill('TOKEN_CLAIMS_REJECTED'),
      'INSUFFICIENT_SCOPE',
      'PROJECT_DELETE_FORBIDDEN',
      'RESOURCE_CONCEALED',
      'RESOURCE_CONCEALED',
      'PROJECT_DELETED',
    ]);
  } finally {
    await lab.stop();
  }
});
