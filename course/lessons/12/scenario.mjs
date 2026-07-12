import { decodeBase32, generateTotp } from '../../../packages/totp/totp.mjs';
import { LESSON_12_INITIAL_TIME_MS } from '../../../apps/project-app/lessons/12/http-handler.mjs';
import { ScenarioClientError, scenarioRequest, withFreshScenario } from '../../runner/scenario-client.mjs';

const IDENTIFIER = 'alice@example.com';
const PASSWORD = 'alice-password-for-lesson-02';
const PERIOD_SECONDS = 30;

function expect(condition, message) {
  if (!condition) throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', message);
}

function cookiePair(setCookie, name) {
  expect(typeof setCookie === 'string' && !/[\r\n]/u.test(setCookie), `${name} cookie was not issued`);
  const pair = setCookie.split(';', 1)[0];
  expect(new RegExp(`^${name}=[A-Za-z0-9_-]{43}$`, 'u').test(pair), `${name} cookie is not canonical`);
  return pair;
}

function cookieProperties(setCookie) {
  return {
    httpOnly: /; HttpOnly(?:;|$)/u.test(setCookie),
    sameSite: /; SameSite=Lax(?:;|$)/u.test(setCookie) ? 'Lax' : 'other',
    path: /; Path=\/(?:;|$)/u.test(setCookie) ? '/' : 'other',
    secure: /; Secure(?:;|$)/u.test(setCookie),
    domainOmitted: !/; Domain=/iu.test(setCookie),
  };
}

function nextPeriod(timeMs) {
  return (Math.floor(timeMs / (PERIOD_SECONDS * 1000)) + 1) * PERIOD_SECONDS * 1000;
}

function acceptedWindowCodes(secret, timeMs) {
  return new Set([-1, 0, 1].map((offset) => generateTotp({
    secret,
    timeMs: timeMs + offset * PERIOD_SECONDS * 1000,
  })));
}

function definitelyWrong(secret, timeMs, start = 0) {
  const accepted = acceptedWindowCodes(secret, timeMs);
  for (let value = start; value < 1_000_000; value += 1) {
    const candidate = String(value).padStart(6, '0');
    if (!accepted.has(candidate)) return candidate;
  }
  throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'no invalid TOTP candidate exists');
}

function expiredOutsideWindow(secret, timeMs) {
  const accepted = acceptedWindowCodes(secret, timeMs);
  for (let steps = 2; steps < 100; steps += 1) {
    const candidate = generateTotp({
      secret,
      timeMs: timeMs - steps * PERIOD_SECONDS * 1000,
    });
    if (!accepted.has(candidate)) return candidate;
  }
  throw new ScenarioClientError('SCENARIO_EXPECTATION_FAILED', 'no expired TOTP candidate exists');
}

async function passwordStep(origin, scenarioId, signal) {
  const result = await scenarioRequest(origin, '/api/lessons/12/login/password', {
    method: 'POST',
    scenarioId,
    json: { identifier: IDENTIFIER, password: PASSWORD },
    signal,
  });
  expect(result.status === 200 && result.body?.code === 'PASSWORD_FACTOR_VERIFIED', 'password factor failed');
  expect(result.body?.sessionIssued === false, 'password-only step issued an application session');
  return {
    response: result,
    cookie: cookiePair(result.setCookie, 'course_mfa_pre_auth'),
  };
}

async function complete(origin, scenarioId, cookie, method, code, signal) {
  return scenarioRequest(origin, '/api/lessons/12/login/second-factor', {
    method: 'POST',
    scenarioId,
    cookie,
    json: { method, code },
    signal,
  });
}

async function advanceClock(origin, scenarioId, timestampMs, signal) {
  const result = await scenarioRequest(origin, '/__course/lessons/12/clock', {
    method: 'POST', scenarioId, json: { timestampMs }, signal,
  });
  expect(result.status === 200 && result.body?.currentTimeMs === timestampMs, 'logical clock advance failed');
}

export async function runLesson12Scenario({ origin, signal } = {}) {
  return withFreshScenario({ origin, lessonId: '12', signal }, async (scenarioId) => {
    const enrollmentPassword = await scenarioRequest(
      origin,
      '/api/lessons/12/enrollment/password',
      {
        method: 'POST',
        scenarioId,
        json: { identifier: IDENTIFIER, password: PASSWORD },
        signal,
      },
    );
    expect(
      enrollmentPassword.status === 201
        && enrollmentPassword.body?.code === 'ENROLLMENT_PASSWORD_VERIFIED'
        && enrollmentPassword.body?.sessionIssued === false,
      'enrollment password gate failed',
    );
    const enrollmentCookie = cookiePair(
      enrollmentPassword.setCookie,
      'course_mfa_enrollment',
    );
    const enrollment = await scenarioRequest(origin, '/api/lessons/12/enrollment/start', {
      method: 'POST', scenarioId, cookie: enrollmentCookie, signal,
    });
    expect(enrollment.status === 200 && enrollment.body?.code === 'TOTP_ENROLLMENT_STARTED', 'TOTP enrollment did not start');
    const uri = new URL(enrollment.body.provisioningUri);
    expect(uri.protocol === 'otpauth:' && uri.hostname === 'totp', 'provisioning URI scheme or type is invalid');
    expect(uri.searchParams.get('issuer') === 'CloudNative Course', 'provisioning issuer is invalid');
    expect(uri.searchParams.get('algorithm') === 'SHA1', 'provisioning algorithm is invalid');
    expect(uri.searchParams.get('digits') === '6', 'provisioning digits are invalid');
    expect(uri.searchParams.get('period') === '30', 'provisioning period is invalid');
    expect(uri.searchParams.get('secret') === enrollment.body.secret, 'provisioning secret mismatch');
    const secret = decodeBase32(enrollment.body.secret);
    const confirmationCode = generateTotp({ secret, timeMs: LESSON_12_INITIAL_TIME_MS });
    const confirmed = await scenarioRequest(origin, '/api/lessons/12/enrollment/confirm', {
      method: 'POST',
      scenarioId,
      cookie: enrollmentCookie,
      json: { code: confirmationCode },
      signal,
    });
    expect(confirmed.status === 201 && confirmed.body?.code === 'TOTP_ENROLLED', 'TOTP confirmation failed');
    expect(
      Array.isArray(confirmed.body?.recoveryCodes)
        && confirmed.body.recoveryCodes.length === 4
        && new Set(confirmed.body.recoveryCodes).size === 4,
      'single-display recovery codes were not issued',
    );
    const recoveryCode = confirmed.body.recoveryCodes[0];

    const replayPreAuth = await passwordStep(origin, scenarioId, signal);
    const replayedConfirmation = await complete(
      origin,
      scenarioId,
      replayPreAuth.cookie,
      'totp',
      confirmationCode,
      signal,
    );
    expect(
      replayedConfirmation.status === 422
        && replayedConfirmation.body?.code === 'INVALID_SECOND_FACTOR',
      'same-counter TOTP replay was not rejected generically',
    );

    let currentTimeMs = nextPeriod(LESSON_12_INITIAL_TIME_MS);
    await advanceClock(origin, scenarioId, currentTimeMs, signal);
    let currentCode = generateTotp({ secret, timeMs: currentTimeMs });
    const authenticated = await complete(
      origin,
      scenarioId,
      replayPreAuth.cookie,
      'totp',
      currentCode,
      signal,
    );
    expect(authenticated.status === 200 && authenticated.body?.code === 'MFA_AUTHENTICATED', 'TOTP login failed');
    const sessionCookie = cookiePair(authenticated.setCookie, 'course_mfa_session');
    const sessionProperties = cookieProperties(authenticated.setCookie);
    const me = await scenarioRequest(origin, '/api/lessons/12/me', {
      scenarioId, cookie: sessionCookie, signal,
    });
    expect(
      me.status === 200
        && me.body?.authenticationMethods?.join('+') === 'password+totp',
      'MFA application session was not usable',
    );

    const genericPreAuth = await passwordStep(origin, scenarioId, signal);
    const expiredCode = expiredOutsideWindow(secret, currentTimeMs);
    const expired = await complete(
      origin,
      scenarioId,
      genericPreAuth.cookie,
      'totp',
      expiredCode,
      signal,
    );
    const wrong = await complete(
      origin,
      scenarioId,
      genericPreAuth.cookie,
      'totp',
      definitelyWrong(secret, currentTimeMs),
      signal,
    );
    expect(
      expired.status === 422
        && wrong.status === 422
        && JSON.stringify(expired.body) === JSON.stringify(wrong.body),
      'wrong and expired TOTP results were distinguishable',
    );
    currentTimeMs = nextPeriod(currentTimeMs);
    await advanceClock(origin, scenarioId, currentTimeMs, signal);
    currentCode = generateTotp({ secret, timeMs: currentTimeMs });
    const recoveredAfterFailures = await complete(
      origin,
      scenarioId,
      genericPreAuth.cookie,
      'totp',
      currentCode,
      signal,
    );
    expect(recoveredAfterFailures.status === 200, 'valid TOTP did not clear failed attempts');

    const recoveryPreAuth = await passwordStep(origin, scenarioId, signal);
    const recoveryLogin = await complete(
      origin,
      scenarioId,
      recoveryPreAuth.cookie,
      'recovery-code',
      recoveryCode,
      signal,
    );
    expect(
      recoveryLogin.status === 200
        && recoveryLogin.body?.authenticationMethods?.join('+') === 'password+recovery-code',
      'recovery-code login failed',
    );
    const recoveryReplayPreAuth = await passwordStep(origin, scenarioId, signal);
    const recoveryReplay = await complete(
      origin,
      scenarioId,
      recoveryReplayPreAuth.cookie,
      'recovery-code',
      recoveryCode,
      signal,
    );
    const secondFailure = await complete(
      origin,
      scenarioId,
      recoveryReplayPreAuth.cookie,
      'totp',
      definitelyWrong(secret, currentTimeMs),
      signal,
    );
    const rateLimited = await complete(
      origin,
      scenarioId,
      recoveryReplayPreAuth.cookie,
      'totp',
      definitelyWrong(secret, currentTimeMs, 1),
      signal,
    );
    expect(recoveryReplay.status === 422 && secondFailure.status === 422, 'generic recovery replay rejection failed');
    expect(
      rateLimited.status === 429
        && rateLimited.body?.code === 'SECOND_FACTOR_RATE_LIMITED'
        && rateLimited.retryAfter === '30',
      'second-factor rate limit failed',
    );

    const observed = await scenarioRequest(origin, '/__course/lessons/12/observe', {
      scenarioId, signal,
    });
    expect(observed.status === 200 && observed.body?.lessonId === '12', 'MFA observation failed');
    const observation = observed.body;
    return {
      schemaVersion: 1,
      lessonId: '12',
      evidenceBasis: 'project-app-runtime-http-rfc6238',
      runtimeEvidence: true,
      wireEvidence: true,
      enrollment: {
        passwordGateStatus: enrollmentPassword.status,
        passwordGateSessionIssued: enrollmentPassword.body.sessionIssued,
        provisioningUri: {
          scheme: uri.protocol,
          type: uri.hostname,
          issuerPresent: uri.searchParams.has('issuer'),
          secretPresentOnEnrollmentResponse: uri.searchParams.has('secret'),
          algorithm: uri.searchParams.get('algorithm'),
          digits: Number(uri.searchParams.get('digits')),
          period: Number(uri.searchParams.get('period')),
          rawUriOmitted: true,
          rawSecretOmitted: true,
        },
        confirmationStatus: confirmed.status,
        recoveryCodesIssued: confirmed.body.recoveryCodes.length,
        rawRecoveryCodesOmitted: true,
      },
      authentication: {
        passwordStepStatus: replayPreAuth.response.status,
        passwordStepSessionIssued: replayPreAuth.response.body.sessionIssued,
        replayedConfirmationStatus: replayedConfirmation.status,
        secondFactorStatus: authenticated.status,
        methods: authenticated.body.authenticationMethods,
        applicationSessionStatus: me.status,
        sessionCookie: sessionProperties,
      },
      failureHandling: {
        expiredStatus: expired.status,
        wrongStatus: wrong.status,
        genericBodiesEqual: JSON.stringify(expired.body) === JSON.stringify(wrong.body),
        recoveryFirstStatus: recoveryLogin.status,
        recoveryReplayStatus: recoveryReplay.status,
        rateLimitStatus: rateLimited.status,
        retryAfterSeconds: Number(rateLimited.retryAfter),
      },
      implementation: observation.implementation,
      configuration: observation.configuration,
      state: {
        factorCount: observation.state.factors.length,
        recoveryCodesUsed: observation.state.factors[0]?.recoveryCodesUsed,
        replayStateStored: observation.state.factors[0]?.replayStateStored,
        eventTypes: observation.state.events.map(({ type }) => type),
      },
      redaction: observation.redaction,
      limitations: observation.limitations,
    };
  });
}
