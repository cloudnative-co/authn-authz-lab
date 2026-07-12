import { canonicalJson } from '../../runner/canonical.mjs';
import { ScenarioClientError, scenarioRequest, withFreshScenario } from '../../runner/scenario-client.mjs';

const TRAINING_IDENTIFIER = 'alice@example.com';
const TRAINING_PASSWORD = 'alice-password-for-lesson-02';

function requireResponse(response, status, code) {
  if (response.status !== status || response.body?.code !== code) {
    throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 02 runtime expectation failed');
  }
  return response;
}

async function authenticate(origin, scenarioId, identifier, password, signal) {
  return scenarioRequest(origin, '/api/lessons/02/authenticate', {
    method: 'POST',
    scenarioId,
    json: { identifier, password },
    signal,
  });
}

export async function runLesson02Scenario({ origin, signal } = {}) {
  return withFreshScenario({ origin, lessonId: '02', signal }, async (scenarioId) => {
    const observed = await scenarioRequest(origin, '/__course/lessons/02/observe', {
      scenarioId,
      signal,
    });
    if (observed.status !== 200 || observed.body?.lessonId !== '02') {
      throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 02 observation failed');
    }

    const success = requireResponse(
      await authenticate(origin, scenarioId, TRAINING_IDENTIFIER, TRAINING_PASSWORD, signal),
      200,
      'AUTHENTICATED',
    );
    const wrong = requireResponse(
      await authenticate(origin, scenarioId, TRAINING_IDENTIFIER, 'incorrect-training-password', signal),
      422,
      'INVALID_CREDENTIALS',
    );
    const unknown = requireResponse(
      await authenticate(origin, scenarioId, 'unknown-user@example.com', 'incorrect-training-password', signal),
      422,
      'INVALID_CREDENTIALS',
    );
    const secondFailure = requireResponse(
      await authenticate(origin, scenarioId, TRAINING_IDENTIFIER, 'incorrect-training-password', signal),
      422,
      'INVALID_CREDENTIALS',
    );
    void secondFailure;
    const limited = requireResponse(
      await authenticate(origin, scenarioId, TRAINING_IDENTIFIER, 'incorrect-training-password', signal),
      429,
      'RATE_LIMITED',
    );
    const blockedCorrect = requireResponse(
      await authenticate(origin, scenarioId, TRAINING_IDENTIFIER, TRAINING_PASSWORD, signal),
      429,
      'RATE_LIMITED',
    );
    const otherIdentifier = requireResponse(
      await authenticate(origin, scenarioId, 'separate-rate-key@example.com', 'incorrect-training-password', signal),
      422,
      'INVALID_CREDENTIALS',
    );
    for (let index = 0; index < 5; index += 1) {
      requireResponse(
        await authenticate(origin, scenarioId, `capacity-${index}@example.com`, 'incorrect-training-password', signal),
        422,
        'INVALID_CREDENTIALS',
      );
    }
    const capacityExceeded = requireResponse(
      await authenticate(origin, scenarioId, 'capacity-rejected@example.com', 'incorrect-training-password', signal),
      503,
      'AUTHENTICATION_CAPACITY_EXCEEDED',
    );
    const capacityObservation = await scenarioRequest(origin, '/__course/lessons/02/observe', {
      scenarioId,
      signal,
    });
    if (capacityObservation.status !== 200 || capacityObservation.body?.rateLimit?.trackedIdentifiers !== 8) {
      throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 02 capacity observation failed');
    }
    const advanced = await scenarioRequest(origin, '/__course/lessons/02/clock', {
      method: 'POST',
      scenarioId,
      json: { timestampMs: 30_000 },
      signal,
    });
    if (advanced.status !== 200 || advanced.body?.currentTimeMs !== 30_000) {
      throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 02 clock advance failed');
    }
    const recovered = requireResponse(
      await authenticate(origin, scenarioId, TRAINING_IDENTIFIER, TRAINING_PASSWORD, signal),
      200,
      'AUTHENTICATED',
    );

    const observation = observed.body;
    const genericFailuresEqual = canonicalJson(wrong.body) === canonicalJson(unknown.body);
    return {
      schemaVersion: 1,
      lessonId: '02',
      evidenceBasis: 'project-app-runtime-http',
      runtimeEvidence: true,
      storage: {
        format: observation.seed.users[0].credential.format,
        passwordNormalization: 'NFC',
        algorithm: observation.kdf.algorithm,
        workFactor: { ...observation.kdf.defaultProfile },
        saltBytes: observation.seed.users[0].credential.saltBytes,
        samePasswordSaltsDiffer: observation.seed.dummySaltDemonstration.saltsDiffer,
        saltFingerprints: [
          observation.seed.dummySaltDemonstration.first.saltFingerprint,
          observation.seed.dummySaltDemonstration.second.saltFingerprint,
        ],
        plaintextRetained: observation.redaction.plaintextCredentials !== 'omitted',
        encodedCredentialsExposed: observation.redaction.encodedCredentials !== 'omitted',
        derivedKeysExposed: observation.redaction.derivedKeys !== 'omitted',
        passwordPolicyIsSeparate: observation.kdf.passwordPolicyIsSeparate,
      },
      authentication: {
        successStatus: success.status,
        successCode: success.body.code,
        sessionIssued: success.body.sessionIssued,
        wrongStatus: wrong.status,
        unknownStatus: unknown.status,
        genericFailuresEqual,
        unknownUserVerification: observation.implementation.unknownUserVerification,
      },
      rateLimit: {
        failureThreshold: observation.rateLimit.configuration.failureThreshold,
        maxTrackedIdentifiers: observation.rateLimit.configuration.maxTrackedIdentifiers,
        thresholdStatus: limited.status,
        thresholdCode: limited.body.code,
        retryAfterSeconds: Number(limited.retryAfter),
        blockedCorrectStatus: blockedCorrect.status,
        otherIdentifierStatus: otherIdentifier.status,
        trackedIdentifiersAtCapacity: capacityObservation.body.rateLimit.trackedIdentifiers,
        capacityStatus: capacityExceeded.status,
        capacityCode: capacityExceeded.body.code,
        capacityRetryAfterSeconds: Number(capacityExceeded.retryAfter),
        capacityBehavior: observation.rateLimit.capacityBehavior,
        scope: 'per-identifier',
        globalKdfConcurrencyDefense: false,
        recoveredStatus: recovered.status,
      },
    };
  });
}
