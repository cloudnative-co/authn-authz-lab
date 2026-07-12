import { canonicalJson } from '../../runner/canonical.mjs';
import { ScenarioClientError, scenarioRequest, withFreshScenario } from '../../runner/scenario-client.mjs';

const ACCOUNTS = Object.freeze({
  alice: Object.freeze({ identifier: 'alice.04@example.test', password: 'alice-password-for-lesson-04' }),
  bob: Object.freeze({ identifier: 'bob.04@example.test', password: 'bob-password-for-lesson-04' }),
  carol: Object.freeze({ identifier: 'carol.04@example.test', password: 'carol-password-for-lesson-04' }),
  dave: Object.freeze({ identifier: 'dave.04@example.test', password: 'dave-password-for-lesson-04' }),
});

function requireResponse(response, status, code) {
  if (response.status !== status || (code !== null && response.body?.code !== code)) {
    throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 04 runtime expectation failed');
  }
  return response;
}

function cookiePair(setCookie) {
  if (typeof setCookie !== 'string' || /[\r\n]/u.test(setCookie)) {
    throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 04 did not issue a cookie');
  }
  const pair = setCookie.split(';', 1)[0];
  if (!/^course04_session=[A-Za-z0-9_-]{43}$/u.test(pair)) {
    throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 04 cookie is not canonical');
  }
  return pair;
}

async function login(origin, scenarioId, account, signal) {
  const preAuth = requireResponse(await scenarioRequest(origin, '/api/lessons/04/pre-auth', {
    method: 'POST', scenarioId, signal,
  }), 201, 'PRE_AUTH_SESSION_CREATED');
  const authenticated = requireResponse(await scenarioRequest(origin, '/api/lessons/04/login', {
    method: 'POST',
    scenarioId,
    cookie: cookiePair(preAuth.setCookie),
    json: account,
    signal,
  }), 200, 'AUTHENTICATED');
  return cookiePair(authenticated.setCookie);
}

function remove(origin, scenarioId, resourceId, cookie, signal, headers = {}) {
  return scenarioRequest(origin, `/api/lessons/04/projects/${resourceId}`, {
    method: 'DELETE', scenarioId, cookie, signal, headers,
  });
}

async function observe(origin, scenarioId, signal) {
  const response = await scenarioRequest(origin, '/__course/lessons/04/observe', {
    scenarioId, signal,
  });
  if (response.status !== 200 || response.body?.lessonId !== '04') {
    throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 04 observation failed');
  }
  return response.body;
}

function exactAuditFields(entries) {
  const expected = ['action', 'decision', 'reason', 'resource', 'status', 'subject'];
  return entries.every((entry) => {
    const actual = Object.keys(entry).sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  });
}

export async function runLesson04Scenario({ origin, signal } = {}) {
  return withFreshScenario({ origin, lessonId: '04', signal }, async (scenarioId) => {
    const anonymous = requireResponse(
      await remove(origin, scenarioId, 'p-100', undefined, signal),
      403,
      'SESSION_UNAVAILABLE',
    );
    const beforePolicy = await observe(origin, scenarioId, signal);
    if (beforePolicy.audit.retainedEntryCount !== 0) {
      throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'PEP rejection reached project-core');
    }

    const bobCookie = await login(origin, scenarioId, ACCOUNTS.bob, signal);
    const viewer = requireResponse(
      await remove(origin, scenarioId, 'p-100', bobCookie, signal, {
        'x-principal-id': 'user-100',
        'x-project-role': 'owner',
        'x-tenant-id': 't-100',
      }),
      403,
      'PROJECT_DELETE_FORBIDDEN',
    );
    const afterViewer = await observe(origin, scenarioId, signal);

    const carolCookie = await login(origin, scenarioId, ACCOUNTS.carol, signal);
    const outsider = requireResponse(
      await remove(origin, scenarioId, 'p-100', carolCookie, signal),
      404,
      'PROJECT_NOT_FOUND',
    );
    const missing = requireResponse(
      await remove(origin, scenarioId, 'p-999', carolCookie, signal),
      404,
      'PROJECT_NOT_FOUND',
    );

    const daveCookie = await login(origin, scenarioId, ACCOUNTS.dave, signal);
    const crossTenant = requireResponse(
      await remove(origin, scenarioId, 'p-100', daveCookie, signal),
      404,
      'PROJECT_NOT_FOUND',
    );

    const aliceCookie = await login(origin, scenarioId, ACCOUNTS.alice, signal);
    const owner = requireResponse(
      await remove(origin, scenarioId, 'p-100', aliceCookie, signal),
      204,
      null,
    );
    const repeated = requireResponse(
      await remove(origin, scenarioId, 'p-100', aliceCookie, signal),
      404,
      'PROJECT_NOT_FOUND',
    );
    const final = await observe(origin, scenarioId, signal);

    const concealedEqual = canonicalJson(outsider.body) === canonicalJson(crossTenant.body)
      && canonicalJson(crossTenant.body) === canonicalJson(missing.body)
      && canonicalJson(missing.body) === canonicalJson(repeated.body);
    const serialized = JSON.stringify(final);
    const redacted = !Object.values(ACCOUNTS).some(({ identifier, password }) => (
      serialized.includes(identifier) || serialized.includes(password)
    ));

    return {
      schemaVersion: 1,
      lessonId: '04',
      evidenceBasis: 'project-app-runtime-http-cookie-project-core',
      runtimeEvidence: true,
      wireEvidence: true,
      enforcement: {
        anonymousStatus: anonymous.status,
        anonymousCode: anonymous.body.code,
        wwwAuthenticateAbsent: anonymous.wwwAuthenticate === null,
        unauthenticatedAuditCount: beforePolicy.audit.retainedEntryCount,
        principalSource: 'cookie-session',
        roleAndTenantSource: 'project-core-source-of-record',
        callerRoleHeadersAccepted: viewer.status !== 403,
      },
      owner: {
        status: owner.status,
        projectPresentAfter: final.state.projects.some(({ id }) => id === 'p-100'),
        auditDecision: final.audit.entries.at(-2)?.decision,
        auditStatus: final.audit.entries.at(-2)?.status,
      },
      viewer: {
        status: viewer.status,
        code: viewer.body.code,
        projectPresentAfter: afterViewer.state.projects.some(({ id }) => id === 'p-100'),
        auditDecision: afterViewer.audit.entries.at(-1)?.decision,
        auditStatus: afterViewer.audit.entries.at(-1)?.status,
      },
      concealment: {
        outsiderStatus: outsider.status,
        crossTenantStatus: crossTenant.status,
        missingStatus: missing.status,
        repeatedDeleteStatus: repeated.status,
        responsesEqual: concealedEqual,
      },
      audit: {
        retainedEntryCount: final.audit.retainedEntryCount,
        statuses: final.audit.entries.map(({ status }) => status),
        exactPolicyFields: exactAuditFields(final.audit.entries),
        redacted,
        bounded: final.audit.maxEntries === 64,
      },
    };
  });
}
