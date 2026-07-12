function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const CAPSTONE_CASE = deepFreeze({
  id: 'aster-labs-identity-modernization-v1',
  organization: 'Aster Labs (fictional)',
  systems: [
    'authoritative-hr-source',
    'directory-and-idp',
    'saml-service-provider',
    'resource-api',
    'local-application-session',
    'mfa-and-passkey-registry',
  ],
  observations: [
    { id: 'F-LEAVER', state: 'disabled-directory-account-retains-session-and-authenticator' },
    { id: 'F-FEDERATION', state: 'service-provider-checks-signature-but-not-message-semantics' },
    { id: 'F-API', state: 'resource-api-checks-scope-but-not-tenant-or-object-owner' },
    { id: 'F-RECOVERY', state: 'lost-authenticator-recovery-uses-weak-reproof' },
    { id: 'F-ADMIN', state: 'shared-administrator-credential-has-no-owner-lifecycle' },
  ],
});

export const CAPSTONE_RISK_IDS = deepFreeze([
  'R-LEAVER-ACCESS',
  'R-FEDERATION-SEMANTICS',
  'R-API-OBJECT',
  'R-RECOVERY',
  'R-SHARED-ADMIN',
]);

export const CAPSTONE_RISK_RULES = deepFreeze({
  'R-LEAVER-ACCESS': {
    severity: 'critical',
    owner: 'iam-operations',
    safeDispositions: ['resolved'],
  },
  'R-FEDERATION-SEMANTICS': {
    severity: 'critical',
    owner: 'application',
    safeDispositions: ['resolved'],
  },
  'R-API-OBJECT': {
    severity: 'critical',
    owner: 'application',
    safeDispositions: ['resolved'],
  },
  'R-RECOVERY': {
    severity: 'high',
    owner: 'iam-operations',
    safeDispositions: ['mitigated', 'resolved'],
  },
  'R-SHARED-ADMIN': {
    severity: 'high',
    owner: 'iam-operations',
    safeDispositions: ['mitigated', 'resolved'],
  },
});

export const CAPSTONE_SECURE_COMMON = deepFreeze({
  responsibilities: {
    identitySource: 'hr-source-authoritative',
    directoryAndCredentialLifecycle: 'iam-operations',
    federationAssertionValidation: 'service-provider',
    apiObjectAuthorization: 'resource-server',
    localSessionLifecycle: 'application',
  },
  credentialLifecycle: {
    accountModel: 'unique-human-and-workload-identities',
    joiner: 'approved-source-before-provisioning',
    mover: 'recalculate-access-and-revoke-stale-sessions',
    leaver: 'disable-and-revoke-sessions-tokens-authenticators',
    emergency: 'deny-first-then-investigate-with-redacted-evidence',
  },
  federation: {
    signature: 'response-and-assertion',
    issuer: 'exact-entity-id',
    audience: 'exact-sp-entity-id',
    destinationRecipient: 'exact-acs-url',
    inResponseTo: 'response-and-subject-confirmation',
    time: 'conditions-and-subject-expiry',
    replay: 'response-assertion-request-one-time',
  },
  apiAuthorization: {
    order: ['token', 'scope', 'tenant', 'object'],
    invalidToken: '401-invalid-token',
    insufficientScope: '403-insufficient-scope',
    crossTenant: '404-concealed',
    unknownObject: '404-concealed',
    idToken: 'reject-id-token',
  },
  mfaPasskey: {
    enrollment: 'identity-proofed-user-bound',
    recovery: 'strong-reproof-revoke-old-credential',
    lostDevice: 'revoke-credential-and-active-sessions',
    syncBoundary: 'provider-account-not-single-device-proof',
    factorBoundary: 'passkey-origin-bound-totp-not-phishing-resistant',
  },
  risks: CAPSTONE_RISK_IDS.map((id) => ({
    id,
    severity: CAPSTONE_RISK_RULES[id].severity,
    owner: CAPSTONE_RISK_RULES[id].owner,
    disposition: CAPSTONE_RISK_RULES[id].safeDispositions[0],
  })),
  priorityOrder: [...CAPSTONE_RISK_IDS],
});

const completeTestPlan = {
  invalidToken: 'run',
  samlReplay: 'run',
  crossTenant: 'run',
  leaverSession: 'run',
  weakRecovery: 'run',
};

export const CAPSTONE_DEVELOPER_ARTIFACT = deepFreeze({
  policyMode: 'deny-by-default',
  sessionRevocationHook: 'disable-event-revokes-local-sessions',
  federationAdapter: 'strict-sp-initiated-acs',
  apiPolicy: 'token-scope-tenant-object',
  negativeTests: { ...completeTestPlan },
});

export const CAPSTONE_IAM_ARTIFACT = deepFreeze({
  changeControl: 'approved-source-event-and-two-person-review',
  jmlRunbook: [
    'validate-authoritative-event',
    'apply-directory-change',
    'recalculate-access',
    'revoke-stale-sessions-and-tokens',
    'verify-deny-or-required-access',
    'record-redacted-evidence',
  ],
  emergencyRunbook: [
    'disable-account',
    'revoke-sessions-and-tokens',
    'revoke-authenticators',
    'block-federation-access',
    'verify-deny',
    'preserve-redacted-audit',
  ],
  recoveryRunbook: [
    'verify-identity-with-strong-channel',
    'revoke-lost-authenticator',
    'enroll-replacement',
    'revoke-active-sessions',
    'notify-and-monitor',
  ],
  validationProfile: 'federation-api-and-session-boundaries',
  simulations: { ...completeTestPlan },
});

export const CAPSTONE_IAM_RUNBOOK_RULES = deepFreeze({
  jmlRunbook: {
    requiredSteps: CAPSTONE_IAM_ARTIFACT.jmlRunbook,
    dependencies: [
      ['validate-authoritative-event', 'apply-directory-change'],
      ['validate-authoritative-event', 'revoke-stale-sessions-and-tokens'],
      ['apply-directory-change', 'recalculate-access'],
      ['recalculate-access', 'verify-deny-or-required-access'],
      ['revoke-stale-sessions-and-tokens', 'verify-deny-or-required-access'],
      ['verify-deny-or-required-access', 'record-redacted-evidence'],
    ],
  },
  emergencyRunbook: {
    requiredSteps: CAPSTONE_IAM_ARTIFACT.emergencyRunbook,
    dependencies: [
      ['disable-account', 'verify-deny'],
      ['revoke-sessions-and-tokens', 'verify-deny'],
      ['revoke-authenticators', 'verify-deny'],
      ['block-federation-access', 'verify-deny'],
      ['verify-deny', 'preserve-redacted-audit'],
    ],
  },
  recoveryRunbook: {
    requiredSteps: CAPSTONE_IAM_ARTIFACT.recoveryRunbook,
    dependencies: [
      ['verify-identity-with-strong-channel', 'revoke-lost-authenticator'],
      ['verify-identity-with-strong-channel', 'revoke-active-sessions'],
      ['revoke-lost-authenticator', 'enroll-replacement'],
      ['revoke-lost-authenticator', 'notify-and-monitor'],
      ['revoke-active-sessions', 'notify-and-monitor'],
      ['enroll-replacement', 'notify-and-monitor'],
    ],
  },
});

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, fields) {
  if (!record(value) || Object.keys(value).length !== fields.length) return false;
  return fields.every((field) => Object.hasOwn(value, field));
}

function matchesFields(actual, expected, fields) {
  if (!hasExactKeys(actual, fields)) return false;
  return fields.every((field) => actual[field] === expected[field]);
}

function planRunsEveryCriticalTest(plan) {
  return matchesFields(plan, completeTestPlan, Object.keys(completeTestPlan));
}

export function capstoneRunbookIsSafe(name, steps) {
  const rule = CAPSTONE_IAM_RUNBOOK_RULES[name];
  if (!rule || !Array.isArray(steps)) return false;
  if (steps.length !== rule.requiredSteps.length || new Set(steps).size !== steps.length) return false;
  if (rule.requiredSteps.some((step) => !steps.includes(step))) return false;
  const position = new Map(steps.map((step, index) => [step, index]));
  return rule.dependencies.every(([before, after]) => position.get(before) < position.get(after));
}

export function capstoneDeveloperArtifactIsSafe(value) {
  const settingNames = ['policyMode', 'sessionRevocationHook', 'federationAdapter', 'apiPolicy'];
  if (!hasExactKeys(value, [...settingNames, 'negativeTests'])) return false;
  return settingNames.every((name) => value[name] === CAPSTONE_DEVELOPER_ARTIFACT[name])
    && planRunsEveryCriticalTest(value.negativeTests);
}

export function capstoneIamArtifactIsSafe(value) {
  const runbookNames = Object.keys(CAPSTONE_IAM_RUNBOOK_RULES);
  if (!hasExactKeys(value, [
    'changeControl', ...runbookNames, 'validationProfile', 'simulations',
  ])) return false;
  return value.changeControl === CAPSTONE_IAM_ARTIFACT.changeControl
    && value.validationProfile === CAPSTONE_IAM_ARTIFACT.validationProfile
    && planRunsEveryCriticalTest(value.simulations)
    && runbookNames.every((name) => capstoneRunbookIsSafe(name, value[name]));
}

export function capstoneRiskPlanIsSafe(risks, priorityOrder) {
  if (!Array.isArray(risks) || risks.length !== CAPSTONE_RISK_IDS.length) return false;
  const riskById = new Map(risks.map((risk) => [risk?.id, risk]));
  if (riskById.size !== CAPSTONE_RISK_IDS.length) return false;
  const risksSafe = CAPSTONE_RISK_IDS.every((id) => {
    const risk = riskById.get(id);
    const rule = CAPSTONE_RISK_RULES[id];
    return record(risk)
      && Object.keys(risk).length === 4
      && risk.severity === rule.severity
      && risk.owner === rule.owner
      && rule.safeDispositions.includes(risk.disposition);
  });
  if (!risksSafe || !Array.isArray(priorityOrder)
      || priorityOrder.length !== CAPSTONE_RISK_IDS.length
      || new Set(priorityOrder).size !== CAPSTONE_RISK_IDS.length
      || priorityOrder.some((id) => !CAPSTONE_RISK_IDS.includes(id))) return false;
  const priority = new Map(priorityOrder.map((id, index) => [id, index]));
  const critical = CAPSTONE_RISK_IDS.filter((id) => CAPSTONE_RISK_RULES[id].severity === 'critical');
  const high = CAPSTONE_RISK_IDS.filter((id) => CAPSTONE_RISK_RULES[id].severity === 'high');
  return critical.every((criticalId) => high.every((highId) => (
    priority.get(criticalId) < priority.get(highId)
  )));
}

export const CAPSTONE_CRITICAL_TESTS = deepFreeze([
  { id: 'CAP-NEG-INVALID-TOKEN', planKey: 'invalidToken', controlKey: 'c4', expected: 'deny-401' },
  { id: 'CAP-NEG-SAML-REPLAY', planKey: 'samlReplay', controlKey: 'c3', expected: 'deny-before-session' },
  { id: 'CAP-NEG-CROSS-TENANT', planKey: 'crossTenant', controlKey: 'c4', expected: 'deny-404' },
  { id: 'CAP-NEG-LEAVER-SESSION', planKey: 'leaverSession', controlKey: 'c2', expected: 'deny-and-revoke' },
  { id: 'CAP-NEG-WEAK-RECOVERY', planKey: 'weakRecovery', controlKey: 'c5', expected: 'deny-recovery' },
]);

export const CAPSTONE_CHECK_WEIGHTS = deepFreeze({
  'AA-CAP-C1': 14,
  'AA-CAP-C2': 14,
  'AA-CAP-C3': 14,
  'AA-CAP-C4': 14,
  'AA-CAP-C5': 14,
  'AA-CAP-C6': 15,
  'AA-CAP-C7': 15,
});

export function capstoneSubmissionFor(track) {
  if (!['developer', 'iam-operations'].includes(track)) throw new TypeError('unknown capstone track');
  return structuredClone({
    schemaVersion: 1,
    lessonId: 'capstone',
    track,
    common: CAPSTONE_SECURE_COMMON,
    artifacts: track === 'developer'
      ? { developer: CAPSTONE_DEVELOPER_ARTIFACT, iamOperations: 'not-selected' }
      : { developer: 'not-selected', iamOperations: CAPSTONE_IAM_ARTIFACT },
  });
}
