import { canonicalJson } from '../../runner/canonical.mjs';
import { ScenarioClientError, scenarioRequest, withFreshScenario } from '../../runner/scenario-client.mjs';

const IDENTIFIER = 'alice@example.com';
const PASSWORD = 'Café-password-for-lesson-06';
const INJECTION = '*)(uid=*';

function requireResponse(response, status, code) {
  if (response.status !== status || response.body?.code !== code) {
    throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'Lesson 06 runtime expectation failed');
  }
  return response;
}

function authenticate(origin, scenarioId, identifier, password, signal) {
  return scenarioRequest(origin, '/api/lessons/06/directory/authenticate', {
    method: 'POST',
    scenarioId,
    json: { identifier, password },
    signal,
  });
}

export async function runLesson06Scenario({ origin, signal } = {}) {
  return withFreshScenario({ origin, lessonId: '06', signal }, async (scenarioId) => {
    const success = requireResponse(
      await authenticate(origin, scenarioId, IDENTIFIER, PASSWORD, signal),
      200,
      'DIRECTORY_AUTHENTICATED',
    );
    const wrong = requireResponse(
      await authenticate(origin, scenarioId, IDENTIFIER, 'wrong-password-for-lesson-06', signal),
      422,
      'DIRECTORY_AUTH_FAILED',
    );
    const unknown = requireResponse(
      await authenticate(origin, scenarioId, 'unknown@example.com', 'unknown-password', signal),
      422,
      'DIRECTORY_AUTH_FAILED',
    );
    const empty = requireResponse(
      await authenticate(origin, scenarioId, IDENTIFIER, '', signal),
      422,
      'DIRECTORY_AUTH_FAILED',
    );
    const injection = requireResponse(
      await authenticate(origin, scenarioId, INJECTION, 'injection-password', signal),
      422,
      'DIRECTORY_AUTH_FAILED',
    );
    const observed = await scenarioRequest(origin, '/__course/lessons/06/observe', {
      scenarioId,
      signal,
    });
    if (observed.status !== 200 || observed.body?.lessonId !== '06') {
      throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'Lesson 06 observation failed');
    }
    const traces = observed.body.traces;
    if (!Array.isArray(traces) || traces.length !== 5) {
      throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'Lesson 06 trace count is invalid');
    }
    const genericFailuresEqual = [unknown, empty, injection]
      .every((response) => canonicalJson(response.body) === canonicalJson(wrong.body));
    const noChallenge = [wrong, unknown, empty, injection]
      .every(({ wwwAuthenticate }) => wwwAuthenticate === null);
    const persisted = JSON.stringify({ observation: observed.body, responses: [
      success.body, wrong.body, unknown.body, empty.body, injection.body,
    ] });
    const redacted = ![
      IDENTIFIER,
      PASSWORD,
      'wrong-password-for-lesson-06',
      'unknown@example.com',
      'unknown-password',
      INJECTION,
      'injection-password',
    ].some((value) => persisted.includes(value));

    return Object.freeze({
      schemaVersion: 1,
      lessonId: '06',
      evidenceBasis: 'fresh-project-app-to-real-openldap',
      runtimeEvidence: true,
      actualProtocol: true,
      success: {
        status: success.status,
        code: success.body.code,
        principalId: success.body.principal?.id,
        directoryDn: success.body.principal?.directoryDn,
        groups: success.body.principal?.groups,
      },
      failures: {
        wrongStatus: wrong.status,
        unknownStatus: unknown.status,
        emptyStatus: empty.status,
        injectionStatus: injection.status,
        genericFailuresEqual,
        wwwAuthenticateAbsent: noChallenge,
      },
      protocol: {
        implementation: observed.body.implementation,
        successOperations: traces[0].operations,
        wrongOperations: traces[1].operations,
        unknownOperations: traces[2].operations,
        emptyNetworkReached: traces[3].networkReached,
        injectionNetworkReached: traces[4].networkReached,
        injectionFilterConstruction: traces[4].filterConstruction,
        injectionFilterEscaped: traces[4].filterEscaped,
        injectionOutcome: traces[4].outcome,
      },
      safety: {
        redacted,
        rawIdentifierOmitted: observed.body.redaction?.rawIdentifier === 'omitted',
        passwordOmitted: observed.body.redaction?.password === 'omitted',
        bindPasswordOmitted: observed.body.redaction?.bindPassword === 'omitted',
        containerControlOmitted: observed.body.redaction?.connectionControl === 'omitted',
        attempts: observed.body.counters?.attempts,
        networkAttempts: observed.body.counters?.networkAttempts,
      },
    });
  });
}
