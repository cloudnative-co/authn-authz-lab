import { ScenarioClientError, scenarioRequest, withFreshScenario } from '../../runner/scenario-client.mjs';

const TRAINING_IDENTIFIER = 'alice@example.com';
const TRAINING_PASSWORD = 'alice-password-for-lesson-02';
const TRAINING_SUBJECT = 'user-alice';

function cookiePair(setCookie) {
  if (typeof setCookie !== 'string' || /[\r\n]/u.test(setCookie)) {
    throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 03 did not issue a cookie');
  }
  const pair = setCookie.split(';', 1)[0];
  if (!/^course_session=[A-Za-z0-9_-]{43}$/u.test(pair)) {
    throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 03 cookie is not canonical');
  }
  return pair;
}

function cookieAttributes(setCookie) {
  return {
    httpOnly: /; HttpOnly(?:;|$)/u.test(setCookie),
    sameSite: /; SameSite=Lax(?:;|$)/u.test(setCookie) ? 'Lax' : 'other',
    path: /; Path=\/(?:;|$)/u.test(setCookie) ? '/' : 'other',
    domainOmitted: !/; Domain=/iu.test(setCookie),
    secure: /; Secure(?:;|$)/u.test(setCookie),
  };
}

async function createAuthenticated(origin, scenarioId, signal) {
  const preAuth = await scenarioRequest(origin, '/api/lessons/03/pre-auth', {
    method: 'POST', scenarioId, signal,
  });
  if (preAuth.status !== 201 || preAuth.body?.code !== 'PRE_AUTH_SESSION_CREATED') {
    throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'pre-auth session was not created');
  }
  const preAuthCookie = cookiePair(preAuth.setCookie);
  const login = await scenarioRequest(origin, '/api/lessons/03/login', {
    method: 'POST',
    scenarioId,
    cookie: preAuthCookie,
    json: { identifier: TRAINING_IDENTIFIER, password: TRAINING_PASSWORD },
    signal,
  });
  if (login.status !== 200 || login.body?.code !== 'AUTHENTICATED') {
    throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'authenticated session was not created');
  }
  const authenticatedCookie = cookiePair(login.setCookie);
  return { preAuth, preAuthCookie, login, authenticatedCookie };
}

async function currentStatus(origin, scenarioId, cookie, signal) {
  return (await scenarioRequest(origin, '/api/lessons/03/me', {
    scenarioId, cookie, signal,
  })).status;
}

export async function runLesson03Scenario({ origin, signal } = {}) {
  return withFreshScenario({ origin, lessonId: '03', signal }, async (scenarioId) => {
    const rotated = await createAuthenticated(origin, scenarioId, signal);
    const attributes = cookieAttributes(rotated.login.setCookie);
    const tokenValue = rotated.authenticatedCookie.slice('course_session='.length);
    const tokenBytes = Buffer.from(tokenValue, 'base64url').byteLength;
    const oldStatus = await currentStatus(origin, scenarioId, rotated.preAuthCookie, signal);
    const currentStatusValue = await currentStatus(
      origin, scenarioId, rotated.authenticatedCookie, signal,
    );

    const observed = await scenarioRequest(origin, '/__course/lessons/03/observe', {
      scenarioId, signal,
    });
    if (observed.status !== 200 || observed.body?.lessonId !== '03') {
      throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 03 observation failed');
    }

    const logout = await scenarioRequest(origin, '/api/lessons/03/logout', {
      method: 'POST', scenarioId, cookie: rotated.authenticatedCookie, signal,
    });
    const postLogoutStatus = await currentStatus(
      origin, scenarioId, rotated.authenticatedCookie, signal,
    );

    const expiring = await createAuthenticated(origin, scenarioId, signal);
    const advanced = await scenarioRequest(origin, '/__course/lessons/03/clock', {
      method: 'POST',
      scenarioId,
      json: { timestampMs: expiring.login.body.expiresAt },
      signal,
    });
    if (advanced.status !== 200) {
      throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'lesson 03 clock advance failed');
    }
    const postExpiryStatus = await currentStatus(
      origin, scenarioId, expiring.authenticatedCookie, signal,
    );

    const revocable = await createAuthenticated(origin, scenarioId, signal);
    const revoked = await scenarioRequest(origin, '/__course/lessons/03/revoke-subject', {
      method: 'POST',
      scenarioId,
      json: { subjectId: TRAINING_SUBJECT },
      signal,
    });
    const postRevocationStatus = await currentStatus(
      origin, scenarioId, revocable.authenticatedCookie, signal,
    );
    const repeated = await scenarioRequest(origin, '/__course/lessons/03/revoke-subject', {
      method: 'POST',
      scenarioId,
      json: { subjectId: TRAINING_SUBJECT },
      signal,
    });
    const finalObservation = await scenarioRequest(origin, '/__course/lessons/03/observe', {
      scenarioId, signal,
    });
    if (finalObservation.status !== 200) {
      throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'final session observation failed');
    }

    const observation = observed.body;
    return {
      schemaVersion: 1,
      lessonId: '03',
      evidenceBasis: 'project-app-runtime-http-cookie',
      runtimeEvidence: true,
      wireEvidence: true,
      transport: {
        tokenBytes,
        opaqueToken: observation.implementation.sessionToken === 'opaque-256-bit-random',
        httpOnly: attributes.httpOnly,
        sameSite: attributes.sameSite,
        path: attributes.path,
        domainOmitted: attributes.domainOmitted,
        secure: attributes.secure,
        transportContext: observation.cookie.transportContext,
        browserEnforcementTested: false,
      },
      storage: {
        mode: observation.implementation.serverStorage,
        rawValuesExposed: observation.redaction.sessionTokens !== 'omitted',
        fullDigestsExposed: observation.redaction.fullTokenDigests !== 'omitted',
      },
      rotation: {
        observed: rotated.preAuthCookie !== rotated.authenticatedCookie
          && rotated.login.body.sessionRotated === true,
        priorHandleStatus: oldStatus,
        currentHandleStatus: currentStatusValue,
      },
      expiration: {
        mode: observation.implementation.expiration,
        postBoundaryStatus: postExpiryStatus,
      },
      logout: {
        status: logout.status,
        cleared: /; Max-Age=0(?:;|$)/u.test(logout.setCookie ?? ''),
        postLogoutStatus,
      },
      revocation: {
        firstCount: revoked.body?.revokedCount,
        postRevocationStatus,
        repeatedCount: repeated.body?.revokedCount,
      },
      trace: {
        recordStatuses: finalObservation.body.state.records.map(({ status }) => status).sort(),
        eventTypes: finalObservation.body.state.events.map(({ type }) => type),
        digestFingerprints: finalObservation.body.state.records.map(({ sessionFingerprint }) => (
          sessionFingerprint
        )),
      },
    };
  });
}
