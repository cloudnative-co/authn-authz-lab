import { DEFAULT_LAB_CONFIG } from '../../../apps/oauth-lab/config.mjs';
import { pkceChallenge, randomOpaque } from '../../../apps/oauth-lab/crypto.mjs';
import { TRAINING_RESOURCE_OWNERS } from '../../../apps/oauth-lab/resource-owner.mjs';
import { runBrowserAuthorizationFlow } from '../../../apps/oauth-lab/user-agent.mjs';

function owner(subject) {
  const result = TRAINING_RESOURCE_OWNERS.find((candidate) => candidate.subject === subject);
  if (!result) throw new Error(`training resource owner is missing: ${subject}`);
  return result;
}

function bodyHas(flow, marker) {
  return typeof flow.finalBody === 'string' && flow.finalBody.includes(`data-result="${marker}"`);
}

function status(flow) {
  return Number(flow.resourceStatus);
}

function secretFree(value) {
  const serialized = JSON.stringify(value);
  return !TRAINING_RESOURCE_OWNERS.some(({ identifier, password }) => (
    serialized.includes(identifier) || serialized.includes(password)
  )) && !serialized.includes('course_as_session=')
    && !serialized.includes('course_rp_session=');
}

async function flow(config, scenarioId, options = {}) {
  return runBrowserAuthorizationFlow({
    config,
    lessonId: '15',
    scenarioId,
    resourceOwner: owner(options.subject ?? 'user-100'),
    scope: options.scope ?? 'project:delete',
    projectId: options.projectId ?? 'p-100',
  });
}

async function invalidResourceIndicator(config, scenarioId, signal) {
  const target = new URL('/oauth/authorize', config.issuer);
  for (const [name, value] of Object.entries({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.apiRedirectUri,
    scope: 'project:delete',
    state: randomOpaque(),
    code_challenge: pkceChallenge(randomOpaque()),
    code_challenge_method: 'S256',
    resource: config.clientOrigin,
  })) target.searchParams.set(name, value);
  const response = await fetch(target, {
    redirect: 'manual',
    headers: { 'x-course-scenario-id': scenarioId },
    signal,
  });
  const location = response.headers.get('location');
  const redirected = location ? new URL(location) : null;
  return Object.freeze({
    status: response.status,
    trustedRedirect: redirected?.origin === config.clientOrigin,
    error: redirected?.searchParams.get('error') ?? null,
  });
}

export async function runLesson15Scenario({
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
  const scenarioId = await scenarioControl.create('lesson-15');
  const scenarioHeaders = { 'x-course-scenario-id': scenarioId };
  try {
    const missingBearer = await fetch(`${config.apiOrigin}/api/projects/p-100`, {
      method: 'DELETE', headers: scenarioHeaders, signal,
    });
    const wrongResource = await invalidResourceIndicator(config, scenarioId, signal);

    const malformed = await flow(config, scenarioId);
    const badSignature = await flow(config, scenarioId);
    const badIssuer = await flow(config, scenarioId);
    const badAudience = await flow(config, scenarioId);
    const expired = await flow(config, scenarioId);
    const wrongType = await flow(config, scenarioId);
    const idTokenConfusion = await flow(config, scenarioId);
    const missingClientId = await flow(config, scenarioId);
    const wrongClientId = await flow(config, scenarioId);
    const missingSubject = await flow(config, scenarioId);
    const missingJti = await flow(config, scenarioId);
    const missingIssuedAt = await flow(config, scenarioId);
    const missingScope = await flow(config, scenarioId);

    const insufficientScope = await flow(config, scenarioId, { scope: 'project:read' });
    const viewer = await flow(config, scenarioId, { subject: 'user-200' });
    const crossTenant = await flow(config, scenarioId, { subject: 'user-400' });
    const unknownProject = await flow(config, scenarioId, { projectId: 'p-999' });
    const ownerDelete = await flow(config, scenarioId);
    const traces = await scenarioControl.evidence(scenarioId);

    const invalidFlows = [
      malformed, badSignature, badIssuer, badAudience, expired, wrongType, idTokenConfusion,
      missingClientId, wrongClientId, missingSubject, missingJti, missingIssuedAt, missingScope,
    ];
    const resourceTraces = traces.filter(({ role }) => role === 'resource-api');
    const invalidTraceOrdering = resourceTraces
      .filter(({ status: observed }) => observed === 401)
      .every(({ checks }) => checks.tokenValidated === false
        && checks.scopeValidated === false
        && checks.policyEvaluated === false);

    const result = {
      schemaVersion: 1,
      lessonId: '15',
      evidenceBasis: 'three-origin-actual-http-rfc8707-rfc9068-jwks-project-core',
      runtimeEvidence: true,
      wireEvidence: true,
      topology: {
        authorizationServer: config.issuer,
        client: config.clientOrigin,
        resourceApi: config.apiOrigin,
        originsSeparated: new Set([config.issuer, config.clientOrigin, config.apiOrigin]).size === 3,
        resourceIndicator: config.audience,
        jwtValidation: 'rs256-remote-jwks-rfc9068-profile',
        policyDecisionPoint: 'project-core',
      },
      success: {
        authorizationStatus: ownerDelete.statuses.grant,
        callbackStatus: ownerDelete.statuses.callback,
        resourceStatus: status(ownerDelete),
        outcomeConfirmed: bodyHas(ownerDelete, 'project-deleted'),
        clientTreatment: 'opaque-forward-only',
        requiredClaims: ['iss', 'exp', 'aud', 'sub', 'client_id', 'iat', 'jti', 'scope'],
      },
      resourceIndicator: wrongResource,
      bearer: {
        missingStatus: missingBearer.status,
        missingChallenge: missingBearer.headers.get('www-authenticate'),
        invalidStatuses: invalidFlows.map(status),
        invalidChallenges: invalidFlows.map((item) => item.resourceChallenge),
        wrongTypeStatus: status(wrongType),
        idTokenConfusionStatus: status(idTokenConfusion),
        missingClaimsRejected: [
          missingClientId, missingSubject, missingJti, missingIssuedAt, missingScope,
        ].every((item) => status(item) === 401),
      },
      authorization: {
        insufficientScopeStatus: status(insufficientScope),
        insufficientScopeChallenge: insufficientScope.resourceChallenge,
        insufficientScopeOutcome: bodyHas(insufficientScope, 'scope-rejected'),
        viewerStatus: status(viewer),
        viewerOutcome: bodyHas(viewer, 'policy-rejected'),
        crossTenantStatus: status(crossTenant),
        crossTenantConcealed: bodyHas(crossTenant, 'resource-concealed'),
        unknownProjectStatus: status(unknownProject),
        unknownProjectConcealed: bodyHas(unknownProject, 'resource-concealed'),
        tokenChecksBeforePolicy: invalidTraceOrdering,
      },
      safety: {
        faultInjectionScope: 'runner-owned-fresh-scenario-only',
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
