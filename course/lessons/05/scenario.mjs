import { canonicalJson } from '../../runner/canonical.mjs';
import { ScenarioClientError, scenarioRequest, withFreshScenario } from '../../runner/scenario-client.mjs';

const CHALLENGE = 'Basic realm="lesson-05", charset="UTF-8"';
const IDENTIFIER = 'basic.alice@example.test';
const PASSWORD = 'basic-password-for-lesson-05';

function authorization(userId, password) {
  return `Basic ${Buffer.from(`${userId}:${password}`, 'utf8').toString('base64')}`;
}

function requireResponse(response, status) {
  if (response.status !== status) {
    throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 05 runtime expectation failed');
  }
  return response;
}

export async function runLesson05Scenario({ origin, signal } = {}) {
  return withFreshScenario({ origin, lessonId: '05', signal }, async (scenarioId) => {
    const request = (value) => scenarioRequest(origin, '/api/lessons/05/basic/me', {
      scenarioId, authorization: value, signal,
    });
    const absent = requireResponse(await request(undefined), 401);
    const wrong = requireResponse(await request(authorization(IDENTIFIER, 'wrong-password')), 401);
    const success = requireResponse(await request(authorization(IDENTIFIER, PASSWORD)), 200);
    const absentAfterSuccess = requireResponse(await request(undefined), 401);
    const observed = requireResponse(await scenarioRequest(origin, '/__course/lessons/05/observe', {
      scenarioId, signal,
    }), 200);

    const challengeBodiesEqual = canonicalJson(absent.body) === canonicalJson(wrong.body)
      && canonicalJson(wrong.body) === canonicalJson(absentAfterSuccess.body);
    const observationText = JSON.stringify(observed.body);
    const redacted = ![
      IDENTIFIER,
      PASSWORD,
      authorization(IDENTIFIER, PASSWORD),
      Buffer.from(`${IDENTIFIER}:${PASSWORD}`, 'utf8').toString('base64'),
    ].some((secret) => observationText.includes(secret));

    return {
      schemaVersion: 1,
      lessonId: '05',
      evidenceBasis: 'project-app-runtime-http-basic',
      runtimeEvidence: true,
      wireEvidence: true,
      challenge: {
        absentStatus: absent.status,
        wrongStatus: wrong.status,
        header: absent.wwwAuthenticate,
        allFailureHeadersEqual: [wrong, absentAfterSuccess]
          .every(({ wwwAuthenticate }) => wwwAuthenticate === absent.wwwAuthenticate),
        allFailureBodiesEqual: challengeBodiesEqual,
      },
      success: {
        status: success.status,
        code: success.body?.code,
        principalId: success.body?.principal?.id,
        challengeAbsent: success.wwwAuthenticate === null,
        setCookieAbsent: success.setCookie === null,
        nextRequestWithoutHeaderStatus: absentAfterSuccess.status,
      },
      protocol: {
        scheme: observed.body?.implementation?.scheme,
        challengeMatchesRfc7617ExampleShape: absent.wwwAuthenticate === CHALLENGE,
        credentialEncoding: observed.body?.implementation?.credentialEncoding,
        authenticatesEveryRequest: observed.body?.implementation?.authenticatesEveryRequest,
        sessionIssuance: observed.body?.implementation?.sessionIssuance,
      },
      safety: {
        transportContext: observed.body?.implementation?.transportContext,
        productionRequirement: observed.body?.implementation?.productionRequirement,
        authorizationHeaderOmitted: observed.body?.redaction?.authorizationHeader === 'omitted',
        decodedCredentialsOmitted: observed.body?.redaction?.decodedUserPass === 'omitted',
        redacted,
        requestCount: observed.body?.counters?.requests,
        successCount: observed.body?.counters?.successes,
        challengeCount: observed.body?.counters?.challenges,
      },
    };
  });
}
