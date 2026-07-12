import {
  CAPSTONE_CHECK_WEIGHTS,
  CAPSTONE_CRITICAL_TESTS,
  CAPSTONE_DEVELOPER_ARTIFACT,
  CAPSTONE_IAM_ARTIFACT,
  CAPSTONE_IAM_RUNBOOK_RULES,
  CAPSTONE_RISK_IDS,
  CAPSTONE_SECURE_COMMON,
  capstoneSubmissionFor,
} from './model.mjs';
import { simulateCapstoneSubmission } from './scenario.mjs';

export const CAPSTONE_CHECK_IDS = Object.freeze(Object.keys(CAPSTONE_CHECK_WEIGHTS));

const ALLOWED = Object.freeze({
  track: ['developer', 'iam-operations'],
  identitySource: ['hr-source-authoritative', 'application-local-source'],
  directoryAndCredentialLifecycle: ['iam-operations', 'each-application'],
  federationAssertionValidation: ['service-provider', 'identity-provider-only'],
  apiObjectAuthorization: ['resource-server', 'client'],
  localSessionLifecycle: ['application', 'identity-provider'],
  accountModel: ['unique-human-and-workload-identities', 'shared-human-and-service-accounts'],
  joiner: ['approved-source-before-provisioning', 'create-on-first-login-without-approval'],
  mover: ['recalculate-access-and-revoke-stale-sessions', 'add-new-access-and-keep-old-access'],
  leaver: ['disable-and-revoke-sessions-tokens-authenticators', 'disable-directory-account-only'],
  emergency: ['deny-first-then-investigate-with-redacted-evidence', 'investigate-before-revocation'],
  signature: ['response-and-assertion', 'signature-present-anywhere'],
  issuer: ['exact-entity-id', 'issuer-text-present'],
  audience: ['exact-sp-entity-id', 'any-audience'],
  destinationRecipient: ['exact-acs-url', 'any-url-in-same-domain'],
  inResponseTo: ['response-and-subject-confirmation', 'relay-state-only'],
  time: ['conditions-and-subject-expiry', 'conditions-only'],
  replay: ['response-assertion-request-one-time', 'accept-until-expiry'],
  invalidToken: ['401-invalid-token', '403-policy-result'],
  insufficientScope: ['403-insufficient-scope', '401-invalid-token'],
  crossTenant: ['404-concealed', '403-with-resource-detail'],
  unknownObject: ['404-concealed', '200-empty-object'],
  idToken: ['reject-id-token', 'accept-signed-id-token'],
  enrollment: ['identity-proofed-user-bound', 'self-service-without-reproof'],
  recovery: ['strong-reproof-revoke-old-credential', 'helpdesk-reset-with-knowledge-question'],
  lostDevice: ['revoke-credential-and-active-sessions', 'remove-device-label-only'],
  syncBoundary: ['provider-account-not-single-device-proof', 'single-device-possession-proof'],
  factorBoundary: ['passkey-origin-bound-totp-not-phishing-resistant', 'all-mfa-is-phishing-resistant'],
  policyMode: ['deny-by-default', 'allow-by-default'],
  sessionRevocationHook: ['disable-event-revokes-local-sessions', 'none'],
  federationAdapter: ['strict-sp-initiated-acs', 'signature-only'],
  apiPolicy: ['token-scope-tenant-object', 'scope-only'],
  testMode: ['run', 'skip'],
  changeControl: ['approved-source-event-and-two-person-review', 'direct-console-change-without-review'],
  validationProfile: ['federation-api-and-session-boundaries', 'login-success-only'],
  severity: ['critical', 'high', 'low'],
  owner: ['iam-operations', 'application', 'vendor', 'unassigned'],
  disposition: ['resolved', 'mitigated', 'unresolved', 'accepted'],
});

const API_ORDERS = Object.freeze([
  CAPSTONE_SECURE_COMMON.apiAuthorization.order,
  ['scope', 'token', 'object', 'tenant'],
]);

const IAM_RUNBOOK_ALLOWED = Object.freeze({
  jmlRunbook: [
    ...CAPSTONE_IAM_ARTIFACT.jmlRunbook,
    'provision-without-source-event',
    'retain-old-access',
  ],
  emergencyRunbook: [
    ...CAPSTONE_IAM_ARTIFACT.emergencyRunbook,
    'wait-for-root-cause-before-revocation',
  ],
  recoveryRunbook: [
    ...CAPSTONE_IAM_ARTIFACT.recoveryRunbook,
    'knowledge-question-only',
  ],
});

export function capstoneLearnerChoices() {
  return structuredClone({
    scalarByField: ALLOWED,
    scalarChoicesByPath: Object.fromEntries([
      ...['invalidToken', 'samlReplay', 'crossTenant', 'leaverSession', 'weakRecovery']
        .map((name) => [`artifacts.developer.negativeTests.${name}`, ALLOWED.testMode]),
      ...['invalidToken', 'samlReplay', 'crossTenant', 'leaverSession', 'weakRecovery']
        .map((name) => [`artifacts.iamOperations.simulations.${name}`, ALLOWED.testMode]),
    ]),
    exactArrayChoicesByPath: {
      'common.apiAuthorization.order': API_ORDERS,
    },
    elementChoicesByPath: {
      'common.priorityOrder': {
        choices: CAPSTONE_RISK_IDS,
        exactLength: CAPSTONE_RISK_IDS.length,
        unique: true,
      },
      'artifacts.iamOperations.jmlRunbook': {
        choices: IAM_RUNBOOK_ALLOWED.jmlRunbook,
        exactLength: CAPSTONE_IAM_RUNBOOK_RULES.jmlRunbook.requiredSteps.length,
        unique: true,
      },
      'artifacts.iamOperations.emergencyRunbook': {
        choices: IAM_RUNBOOK_ALLOWED.emergencyRunbook,
        exactLength: CAPSTONE_IAM_RUNBOOK_RULES.emergencyRunbook.requiredSteps.length,
        unique: true,
      },
      'artifacts.iamOperations.recoveryRunbook': {
        choices: IAM_RUNBOOK_ALLOWED.recoveryRunbook,
        exactLength: CAPSTONE_IAM_RUNBOOK_RULES.recoveryRunbook.requiredSteps.length,
        unique: true,
      },
    },
    trackRules: [
      {
        track: 'developer',
        selectedPath: 'artifacts.developer',
        inactivePath: 'artifacts.iamOperations',
        inactiveValue: capstoneSubmissionFor('developer').artifacts.iamOperations,
      },
      {
        track: 'iam-operations',
        selectedPath: 'artifacts.iamOperations',
        inactivePath: 'artifacts.developer',
        inactiveValue: capstoneSubmissionFor('iam-operations').artifacts.developer,
      },
    ],
  });
}

export class CapstoneSubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'CapstoneSubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new CapstoneSubmissionError(reasonCode, message);
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, path) {
  if (!record(value)) fail('SUBMISSION_SCHEMA_INVALID', `${path} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('SUBMISSION_SCHEMA_INVALID', `${path} has missing or unknown fields`);
  }
}

function allowed(value, values, path) {
  if (!values.includes(value)) fail('SUBMISSION_VALUE_INVALID', `${path} is not allowed`);
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function allowedArray(value, candidates, path) {
  if (!Array.isArray(value) || !candidates.some((candidate) => jsonEqual(value, candidate))) {
    fail('SUBMISSION_VALUE_INVALID', `${path} is not allowed`);
  }
}

function validateNamedScalars(value, names, path) {
  exactKeys(value, names, path);
  for (const name of names) allowed(value[name], ALLOWED[name], `${path}.${name}`);
}

function validateRisks(common) {
  if (!Array.isArray(common.risks) || common.risks.length !== CAPSTONE_RISK_IDS.length) {
    fail('SUBMISSION_SCHEMA_INVALID', 'common.risks must contain the five fixed risks');
  }
  const riskIds = common.risks.map((risk) => risk?.id);
  if (new Set(riskIds).size !== CAPSTONE_RISK_IDS.length
      || riskIds.some((id) => !CAPSTONE_RISK_IDS.includes(id))) {
    fail('SUBMISSION_VALUE_INVALID', 'common.risks must contain each fixed risk once');
  }
  common.risks.forEach((risk, index) => {
    exactKeys(risk, ['id', 'severity', 'owner', 'disposition'], `common.risks[${index}]`);
    allowed(risk.severity, ALLOWED.severity, `common.risks[${index}].severity`);
    allowed(risk.owner, ALLOWED.owner, `common.risks[${index}].owner`);
    allowed(risk.disposition, ALLOWED.disposition, `common.risks[${index}].disposition`);
  });
  if (!Array.isArray(common.priorityOrder)
      || common.priorityOrder.length !== CAPSTONE_RISK_IDS.length
      || new Set(common.priorityOrder).size !== CAPSTONE_RISK_IDS.length
      || common.priorityOrder.some((id) => !CAPSTONE_RISK_IDS.includes(id))) {
    fail('SUBMISSION_VALUE_INVALID', 'common.priorityOrder must contain each fixed risk once');
  }
}

function validateCommon(common) {
  exactKeys(common, [
    'responsibilities', 'credentialLifecycle', 'federation', 'apiAuthorization',
    'mfaPasskey', 'risks', 'priorityOrder',
  ], 'common');
  validateNamedScalars(common.responsibilities, [
    'identitySource', 'directoryAndCredentialLifecycle', 'federationAssertionValidation',
    'apiObjectAuthorization', 'localSessionLifecycle',
  ], 'common.responsibilities');
  validateNamedScalars(common.credentialLifecycle, [
    'accountModel', 'joiner', 'mover', 'leaver', 'emergency',
  ], 'common.credentialLifecycle');
  validateNamedScalars(common.federation, [
    'signature', 'issuer', 'audience', 'destinationRecipient', 'inResponseTo', 'time', 'replay',
  ], 'common.federation');
  exactKeys(common.apiAuthorization, [
    'order', 'invalidToken', 'insufficientScope', 'crossTenant', 'unknownObject', 'idToken',
  ], 'common.apiAuthorization');
  allowedArray(common.apiAuthorization.order, API_ORDERS, 'common.apiAuthorization.order');
  for (const name of ['invalidToken', 'insufficientScope', 'crossTenant', 'unknownObject', 'idToken']) {
    allowed(common.apiAuthorization[name], ALLOWED[name], `common.apiAuthorization.${name}`);
  }
  validateNamedScalars(common.mfaPasskey, [
    'enrollment', 'recovery', 'lostDevice', 'syncBoundary', 'factorBoundary',
  ], 'common.mfaPasskey');
  validateRisks(common);
}

function validatePlan(value, path) {
  const names = ['invalidToken', 'samlReplay', 'crossTenant', 'leaverSession', 'weakRecovery'];
  exactKeys(value, names, path);
  for (const name of names) allowed(value[name], ALLOWED.testMode, `${path}.${name}`);
}

function validateDeveloper(value) {
  exactKeys(value, [
    'policyMode', 'sessionRevocationHook', 'federationAdapter', 'apiPolicy', 'negativeTests',
  ], 'artifacts.developer');
  for (const name of ['policyMode', 'sessionRevocationHook', 'federationAdapter', 'apiPolicy']) {
    allowed(value[name], ALLOWED[name], `artifacts.developer.${name}`);
  }
  validatePlan(value.negativeTests, 'artifacts.developer.negativeTests');
}

function validateRunbook(value, expected, allowedValues, path) {
  if (!Array.isArray(value) || value.length !== expected.length
      || new Set(value).size !== value.length
      || value.some((entry) => !allowedValues.includes(entry))) {
    fail('SUBMISSION_VALUE_INVALID', `${path} is not allowed`);
  }
}

function validateIamOperations(value) {
  exactKeys(value, [
    'changeControl', 'jmlRunbook', 'emergencyRunbook', 'recoveryRunbook',
    'validationProfile', 'simulations',
  ], 'artifacts.iamOperations');
  allowed(value.changeControl, ALLOWED.changeControl, 'artifacts.iamOperations.changeControl');
  allowed(value.validationProfile, ALLOWED.validationProfile, 'artifacts.iamOperations.validationProfile');
  for (const name of ['jmlRunbook', 'emergencyRunbook', 'recoveryRunbook']) {
    validateRunbook(
      value[name],
      CAPSTONE_IAM_ARTIFACT[name],
      IAM_RUNBOOK_ALLOWED[name],
      `artifacts.iamOperations.${name}`,
    );
  }
  validatePlan(value.simulations, 'artifacts.iamOperations.simulations');
}

export function validateCapstoneSubmission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'track', 'common', 'artifacts'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== 'capstone') {
    fail('SUBMISSION_VERSION_INVALID', 'submission version or lesson is unsupported');
  }
  allowed(value.track, ALLOWED.track, 'track');
  validateCommon(value.common);
  exactKeys(value.artifacts, ['developer', 'iamOperations'], 'artifacts');
  if (value.track === 'developer') {
    validateDeveloper(value.artifacts.developer);
    if (value.artifacts.iamOperations !== 'not-selected') {
      fail('SUBMISSION_TRACK_INVALID', 'iamOperations must be not-selected for developer track');
    }
  } else {
    if (value.artifacts.developer !== 'not-selected') {
      fail('SUBMISSION_TRACK_INVALID', 'developer must be not-selected for iam-operations track');
    }
    validateIamOperations(value.artifacts.iamOperations);
  }
  return structuredClone(value);
}

function runtimeShape(runtime, expected) {
  const controlKeys = Object.keys(runtime?.controls ?? {}).sort().join(',');
  const rejectionIds = runtime?.criticalRejections?.map(({ id }) => id) ?? [];
  return runtime?.schemaVersion === 1
    && runtime.lessonId === 'capstone'
    && runtime.mode === 'submission-check'
    && runtime.evidenceBasis === 'deterministic-capstone-policy-simulator-not-live-protocol'
    && runtime.runtimeEvidence === true
    && runtime.freshCheck === true
    && runtime.liveProtocolEvidence === false
    && controlKeys === 'c1,c2,c3,c4,c5,c6,c7'
    && Object.values(runtime.controls).every((value) => typeof value === 'boolean')
    && jsonEqual(rejectionIds, CAPSTONE_CRITICAL_TESTS.map(({ id }) => id))
    && runtime.criticalRejections.every(({ critical, executed, skipped, passed }) => (
      critical === true
      && typeof executed === 'boolean'
      && typeof skipped === 'boolean'
      && typeof passed === 'boolean'
      && executed === !skipped
    ))
    && jsonEqual(runtime.controls, expected.controls)
    && jsonEqual(runtime.metrics, expected.metrics)
    && runtime.redaction?.rawCredentials === 'omitted'
    && runtime.redaction.rawTokens === 'omitted'
    && runtime.redaction.personalIdentifiers === 'omitted'
    && runtime.redaction.filesystemPaths === 'omitted'
    && runtime.humanReview?.required === true
    && runtime.humanReview.machineInterpretsFreeText === false;
}

export function evaluateCapstoneSubmission(input, runtime) {
  const submission = validateCapstoneSubmission(input);
  const expected = simulateCapstoneSubmission(submission);
  const runtimeValid = runtimeShape(runtime, expected);
  if (!runtimeValid) throw new TypeError('capstone runtime evidence is invalid');
  const controlKeyByCheck = {
    'AA-CAP-C1': 'c1',
    'AA-CAP-C2': 'c2',
    'AA-CAP-C3': 'c3',
    'AA-CAP-C4': 'c4',
    'AA-CAP-C5': 'c5',
    'AA-CAP-C6': 'c6',
    'AA-CAP-C7': 'c7',
  };
  const globalGates = runtime.metrics.scorePercent >= runtime.metrics.requiredScorePercent
    && runtime.metrics.criticalSkipCount === 0
    && runtime.metrics.criticalFailureCount === 0
    && runtime.metrics.unresolvedCritical === 0;
  const checks = CAPSTONE_CHECK_IDS.map((checkId) => {
    const controlKey = controlKeyByCheck[checkId];
    const pointsPossible = CAPSTONE_CHECK_WEIGHTS[checkId];
    const controlPassed = runtime.controls[controlKey] === true;
    const gatePassed = checkId !== 'AA-CAP-C7' || globalGates;
    const data = {
      pointsEarned: controlPassed ? pointsPossible : 0,
      pointsPossible,
      ...(checkId === 'AA-CAP-C7' ? {
        scorePercent: runtime.metrics.scorePercent,
        requiredScorePercent: runtime.metrics.requiredScorePercent,
        criticalSkipCount: runtime.metrics.criticalSkipCount,
        criticalFailureCount: runtime.metrics.criticalFailureCount,
        unresolvedCritical: runtime.metrics.unresolvedCritical,
        instructorRubricRequired: true,
        machineInterpretsFreeText: false,
      } : {}),
    };
    return Object.freeze({
      checkId,
      runtimePassed: controlPassed && gatePassed,
      submissionPassed: expected.controls[controlKey] === true,
      passed: controlPassed && gatePassed && expected.controls[controlKey] === true,
      data: Object.freeze(data),
      allowlist: Object.freeze(Object.keys(data)),
    });
  });
  return Object.freeze({
    status: checks.every(({ passed }) => passed) && globalGates ? 'pass' : 'fail',
    checks: Object.freeze(checks),
  });
}

export function capstoneAnswerKey(track = 'developer') {
  return capstoneSubmissionFor(track);
}

export function capstoneAnswerKeys() {
  return Object.freeze({
    developer: capstoneSubmissionFor('developer'),
    iamOperations: capstoneSubmissionFor('iam-operations'),
  });
}
