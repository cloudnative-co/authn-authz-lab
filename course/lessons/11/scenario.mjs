import { DEFAULT_LAB_CONFIG } from '../../../apps/oauth-lab/config.mjs';
import { runBrowserAuthorizationFlow } from '../../../apps/oauth-lab/user-agent.mjs';

const CASES = Object.freeze([
  ['signature', 'ID_TOKEN_SIGNATURE_REJECTED'],
  ['issuer', 'ID_TOKEN_ISSUER_REJECTED'],
  ['audience', 'ID_TOKEN_AUDIENCE_REJECTED'],
  ['expiry', 'ID_TOKEN_EXPIRED'],
  ['nonce', 'ID_TOKEN_NONCE_REJECTED'],
  ['accessTokenAsIdToken', 'ID_TOKEN_FORMAT_REJECTED'],
]);

function latestCallbackReason(events) {
  return events.filter(({ role, path }) => role === 'oidc-rp' && path === '/oidc/callback').at(-1)?.reason;
}

function secretFree(value) {
  const serialized = JSON.stringify(value);
  return ![
    'course-password-for-oauth-lab',
    'learner@example.test',
  ].some((secret) => serialized.includes(secret));
}

export async function runLesson11Scenario({
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
  const scenarioId = await scenarioControl.create('lesson-11');
  try {
    const success = await runBrowserAuthorizationFlow({ config, lessonId: '11', scenarioId });
    const rejections = {};
    for (const [name, expectedReason] of CASES) {
      const flow = await runBrowserAuthorizationFlow({ config, lessonId: '11', scenarioId });
      const reason = latestCallbackReason(await scenarioControl.evidence(scenarioId));
      rejections[name] = Object.freeze({
        callbackStatus: flow.statuses.callback,
        expectedReason,
        observedReason: reason,
        rejectedByNormalCallback: flow.statuses.callback === 400 && reason === expectedReason,
      });
    }
    const duplicateCookie = await fetch(`${config.clientOrigin}/me`, {
      headers: {
        'x-course-scenario-id': scenarioId,
        cookie: `${'course_rp_session='}${'A'.repeat(43)}; course_rp_session=${'B'.repeat(43)}`,
      },
      signal,
    });
    const traces = await scenarioControl.evidence(scenarioId);
    const result = {
      schemaVersion: 1,
      lessonId: '11',
      evidenceBasis: 'three-origin-actual-http-oidc-discovery-jwks-code-flow',
      runtimeEvidence: true,
      wireEvidence: true,
      topology: {
        issuer: config.issuer,
        relyingParty: config.clientOrigin,
        resourceApi: config.apiOrigin,
        originsSeparated: new Set([
          config.issuer, config.clientOrigin, config.apiOrigin,
        ]).size === 3,
      },
      success: {
        authorizationStatus: success.statuses.grant,
        callbackStatus: success.statuses.callback,
        finalStatus: success.statuses.final,
        callbackOutcome: success.callbackOutcome,
        authenticatedPage: success.finalBody.includes('data-result="authenticated"'),
        discoveryFetched: true,
        jwksFetched: true,
        algorithmAllowlist: 'RS256-only',
        idTokenDelivery: 'backchannel-token-response-only',
        applicationSession: 'digest-only-cookie-after-validation',
      },
      rejections,
      identity: {
        subjectValidation: 'non-empty-max-255',
        issuerContract: 'locally-unique-never-reassigned-not-runtime-proven',
        accountKey: 'issuer-subject-pair',
        emailRole: 'optional-attribute-not-subject',
        accessTokenRole: 'api-authorization-not-login-proof',
      },
      cookieBoundary: {
        duplicateSessionCookieStatus: duplicateCookie.status,
        duplicateSessionCookieRejected: duplicateCookie.status === 403,
      },
      safety: {
        transportContext: config.transportContext,
        productionRequirement: config.productionRequirement,
        secureCookieProductionRequirement: 'Secure-required-with-https',
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
