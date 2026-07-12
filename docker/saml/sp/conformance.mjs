import { buildSignedFixture } from '../../../packages/saml-strict/fixture.mjs';

const CASES = Object.freeze([
  ['signature', 'SIGNATURE_INVALID'],
  ['response-issuer', 'RESPONSE_ISSUER_INVALID'],
  ['assertion-issuer', 'ASSERTION_ISSUER_INVALID'],
  ['audience', 'AUDIENCE_INVALID'],
  ['destination', 'DESTINATION_INVALID'],
  ['response-in-response-to', 'IN_RESPONSE_TO_INVALID'],
  ['subject-method', 'SUBJECT_CONFIRMATION_METHOD_INVALID'],
  ['subject-recipient', 'SUBJECT_CONFIRMATION_RECIPIENT_INVALID'],
  ['subject-in-response-to', 'SUBJECT_CONFIRMATION_IN_RESPONSE_TO_INVALID'],
  ['expiry', 'SUBJECT_CONFIRMATION_EXPIRED'],
]);

async function postFixture({ samlResponse, relayState }) {
  return fetch('http://127.0.0.1:3009/saml/fixture-acs', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ SAMLResponse: samlResponse, RelayState: relayState }),
    signal: AbortSignal.timeout(5000),
  });
}

async function readGenericFailure(response) {
  const body = await response.json();
  return response.status === 400
    && body?.code === 'SAML_LOGIN_FAILED'
    && body?.message === 'SSO response could not be accepted'
    && response.headers.get('set-cookie') === null;
}

export async function runConformanceSuite({
  fixtureProvider,
  fixtureKeys,
  fixtureDiagnostics,
  sessionStore,
  fixtureIssuer,
  fixtureAudience,
  fixtureAcs,
} = {}) {
  const results = [];
  for (const [fault, expectedReason] of CASES) {
    const before = sessionStore.createdCount;
    const login = await fixtureProvider.beginLogin();
    const fixture = buildSignedFixture({
      requestId: login.requestId,
      issuer: fixtureIssuer,
      audience: fixtureAudience,
      destination: fixtureAcs,
      privateKey: fixtureKeys.privateKey,
      certificate: fixtureKeys.certificate,
      fault,
    });
    const response = await postFixture({ samlResponse: fixture.samlResponse, relayState: login.relayState });
    results.push(Object.freeze({
      case: fault,
      rejected: await readGenericFailure(response),
      reason: fixtureDiagnostics.lastReason,
      expectedReason,
      sessionCreated: sessionStore.createdCount !== before,
      oneFault: true,
    }));
  }

  const replayLogin = await fixtureProvider.beginLogin();
  const replayFixture = buildSignedFixture({
    requestId: replayLogin.requestId,
    issuer: fixtureIssuer,
    audience: fixtureAudience,
    destination: fixtureAcs,
    privateKey: fixtureKeys.privateKey,
    certificate: fixtureKeys.certificate,
  });
  const first = await postFixture({
    samlResponse: replayFixture.samlResponse,
    relayState: replayLogin.relayState,
  });
  const cookie = first.headers.get('set-cookie');
  const firstAccepted = first.status === 303 && typeof cookie === 'string';
  const beforeReplay = sessionStore.createdCount;
  const second = await postFixture({
    samlResponse: replayFixture.samlResponse,
    relayState: replayLogin.relayState,
  });
  results.push(Object.freeze({
    case: 'replay',
    firstAccepted,
    exactSameResponse: true,
    rejected: await readGenericFailure(second),
    reason: fixtureDiagnostics.lastReason,
    expectedReason: 'REPLAY_DETECTED',
    sessionCreated: sessionStore.createdCount !== beforeReplay,
    oneFault: true,
  }));

  return Object.freeze({
    evidenceBasis: 'runtime-generated-key-signed-conformance-fixture',
    distinctFromKeycloakRuntime: true,
    caseCount: results.length,
    cases: Object.freeze(results),
    allRejected: results.every((result) => result.rejected),
    reasonsMatched: results.every((result) => result.reason === result.expectedReason),
    rejectedBeforeSession: results.every((result) => result.sessionCreated === false),
    rawXmlRetained: false,
    privateKeyRetainedInEvidence: false,
  });
}
