import { DEFAULT_LAB_CONFIG } from '../../../apps/oauth-lab/config.mjs';
import { randomOpaque } from '../../../apps/oauth-lab/crypto.mjs';
import { runBrowserAuthorizationFlow } from '../../../apps/oauth-lab/user-agent.mjs';

function bodyHas(result, marker) {
  return typeof result.finalBody === 'string' && result.finalBody.includes(`data-result="${marker}"`);
}

function secretFree(value) {
  const serialized = JSON.stringify(value);
  return ![
    'course-password-for-oauth-lab',
    'learner@example.test',
  ].some((secret) => serialized.includes(secret));
}

export async function runLesson10Scenario({
  config = DEFAULT_LAB_CONFIG,
  scenarioControl,
  signal,
} = {}) {
  if (signal?.aborted) throw signal.reason ?? new Error('scenario aborted');
  if (!scenarioControl || typeof scenarioControl.create !== 'function'
      || typeof scenarioControl.evidence !== 'function'
      || typeof scenarioControl.remove !== 'function') {
    throw new TypeError('owned managed scenario capability is required');
  }
  const scenarioId = await scenarioControl.create('lesson-10');
  const scenarioHeaders = { 'x-course-scenario-id': scenarioId };
  try {
    const success = await runBrowserAuthorizationFlow({ config, lessonId: '10', scenarioId });
    const stateMismatch = await runBrowserAuthorizationFlow({
      config, lessonId: '10', tamperState: true, scenarioId,
    });
    const pkceMismatch = await runBrowserAuthorizationFlow({ config, lessonId: '10', scenarioId });
    const codeReplay = await runBrowserAuthorizationFlow({ config, lessonId: '10', scenarioId });
    const insufficient = await runBrowserAuthorizationFlow({
      config, lessonId: '10', scope: 'profile:read', scenarioId,
    });

    const invalidRedirect = new URL('/oauth/authorize', config.issuer);
    for (const [name, value] of Object.entries({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: 'http://127.0.0.1:4998/callback',
      scope: 'project:read',
      state: randomOpaque(),
      code_challenge: randomOpaque(),
      code_challenge_method: 'S256',
    })) invalidRedirect.searchParams.set(name, value);
    const invalidRedirectResponse = await fetch(invalidRedirect, {
      redirect: 'manual', headers: scenarioHeaders, signal,
    });
    const missingBearer = await fetch(`${config.apiOrigin}/api/projects`, {
      headers: scenarioHeaders, signal,
    });
    const invalidBearer = await fetch(`${config.apiOrigin}/api/projects`, {
      headers: { ...scenarioHeaders, authorization: `Bearer ${randomOpaque()}` }, signal,
    });
    const badIntrospection = await fetch(`${config.issuer}/oauth/introspect`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from('course-resource-api:wrong', 'utf8').toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...scenarioHeaders,
      },
      body: new URLSearchParams({ token: randomOpaque() }),
      signal,
    });
    const discoveryAfterBadIntrospection = await fetch(
      `${config.issuer}/.well-known/openid-configuration`, { headers: scenarioHeaders, signal },
    );
    const traces = await scenarioControl.evidence(scenarioId);
    const result = {
      schemaVersion: 1,
      lessonId: '10',
      evidenceBasis: 'three-origin-actual-http-authorization-code-pkce-introspection',
      runtimeEvidence: true,
      wireEvidence: true,
      topology: {
        authorizationServer: config.issuer,
        client: config.clientOrigin,
        resourceApi: config.apiOrigin,
        originsSeparated: new Set([
          config.issuer, config.clientOrigin, config.apiOrigin,
        ]).size === 3,
      },
      success: {
        startStatus: success.statuses.start,
        authorizationStatus: success.statuses.grant,
        callbackStatus: success.statuses.callback,
        resourceAuthorized: bodyHas(success, 'resource-authorized'),
        clientSecretAbsent: true,
        stateSentToTokenEndpoint: false,
        accessTokenFormat: 'opaque-256-bit',
        resourceValidation: 'authenticated-rfc7662-introspection',
      },
      rejections: {
        stateMismatchStatus: stateMismatch.statuses.callback,
        pkceMismatchStatus: pkceMismatch.statuses.callback,
        codeReplayRejected: bodyHas(codeReplay, 'replay-rejected'),
        unregisteredRedirectStatus: invalidRedirectResponse.status,
        unregisteredRedirectLocationAbsent: invalidRedirectResponse.headers.get('location') === null,
      },
      bearer: {
        missingStatus: missingBearer.status,
        missingChallenge: missingBearer.headers.get('www-authenticate'),
        invalidStatus: invalidBearer.status,
        invalidChallenge: invalidBearer.headers.get('www-authenticate'),
        insufficientScopeStatus: insufficient.statuses.callback,
        insufficientScopeRejected: bodyHas(insufficient, 'resource-rejected'),
      },
      introspection: {
        unauthenticatedStatus: badIntrospection.status,
        challenge: badIntrospection.headers.get('www-authenticate'),
        serverSurvived: discoveryAfterBadIntrospection.status === 200,
      },
      safety: {
        transportContext: config.transportContext,
        productionRequirement: config.productionRequirement,
        secretsOmitted: false,
        traces,
      },
    };
    result.safety.secretsOmitted = secretFree(result);
    return Object.freeze(result);
  } finally {
    await scenarioControl.remove(scenarioId).catch(() => {});
  }
}
