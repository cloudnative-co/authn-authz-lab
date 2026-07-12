const REJECTION_CASES = Object.freeze([
  'signature',
  'response-issuer',
  'assertion-issuer',
  'audience',
  'destination',
  'response-in-response-to',
  'subject-method',
  'subject-recipient',
  'subject-in-response-to',
  'expiry',
  'replay',
]);

function validRuntime(runtime) {
  const cases = runtime?.conformance?.cases;
  const actualStages = runtime?.actual?.trace?.map(({ stage }) => stage) ?? [];
  return runtime?.schemaVersion === 1
    && runtime.lessonId === '09'
    && runtime.runtimeEvidence === true
    && runtime.actual?.evidenceBasis === 'actual-keycloak-sp-initiated-http-user-agent-flow'
    && runtime.actual.idpImplementation === 'Keycloak-26.7.0'
    && runtime.actual.completed === true
    && actualStages.includes('authn-request')
    && actualStages.includes('saml-response-form')
    && actualStages.includes('acs')
    && actualStages.includes('authenticated-page')
    && runtime.conformance?.evidenceBasis === 'runtime-generated-key-signed-conformance-fixture'
    && runtime.conformance.distinctFromKeycloakRuntime === true
    && Array.isArray(cases)
    && cases.length === REJECTION_CASES.length
    && REJECTION_CASES.every((name) => cases.some((entry) => entry.case === name))
    && runtime.conformance.allRejected === true
    && runtime.conformance.reasonsMatched === true
    && runtime.conformance.rejectedBeforeSession === true;
}

export async function runLesson09Scenario({ adapter, signal } = {}) {
  if (!adapter || typeof adapter.runScenario !== 'function') throw new TypeError('adapter is required');
  const runtime = await adapter.runScenario(signal);
  if (!validRuntime(runtime)) throw new TypeError('Lesson 09 runtime evidence is incomplete');
  const serialized = JSON.stringify(runtime);
  const forbidden = [
    'course-password-for-saml-lab',
    '<saml',
    'SAMLResponse=',
    'BEGIN PRIVATE KEY',
    'lesson09_session=',
    'learner@example.test',
  ];
  if (forbidden.some((value) => serialized.toLowerCase().includes(value.toLowerCase()))) {
    throw new TypeError('Lesson 09 runtime contains forbidden identity or secret material');
  }
  return Object.freeze(runtime);
}

export const lesson09RejectionCases = REJECTION_CASES;
