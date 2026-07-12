import {
  CAPSTONE_CASE,
  CAPSTONE_CHECK_WEIGHTS,
  CAPSTONE_CRITICAL_TESTS,
  CAPSTONE_RISK_IDS,
  CAPSTONE_RISK_RULES,
  CAPSTONE_SECURE_COMMON,
  capstoneDeveloperArtifactIsSafe,
  capstoneIamArtifactIsSafe,
  capstoneRiskPlanIsSafe,
} from './model.mjs';

function settingsMatch(actual, expected) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const fields = Object.keys(expected);
  if (Object.keys(actual).length !== fields.length) return false;
  return fields.every((field) => {
    if (!Array.isArray(expected[field])) return actual[field] === expected[field];
    return Array.isArray(actual[field])
      && actual[field].length === expected[field].length
      && actual[field].every((entry, index) => entry === expected[field][index]);
  });
}

function baselineSubmission() {
  return {
    schemaVersion: 1,
    lessonId: 'capstone',
    track: 'developer',
    common: {
      responsibilities: {},
      credentialLifecycle: {},
      federation: {},
      apiAuthorization: {},
      mfaPasskey: {},
      risks: [
        { id: 'R-LEAVER-ACCESS', severity: 'critical', owner: 'unassigned', disposition: 'unresolved' },
        { id: 'R-FEDERATION-SEMANTICS', severity: 'critical', owner: 'unassigned', disposition: 'unresolved' },
        { id: 'R-API-OBJECT', severity: 'critical', owner: 'unassigned', disposition: 'unresolved' },
      ],
      priorityOrder: [],
    },
    artifacts: {
      developer: {
        policyMode: 'allow-by-default',
        sessionRevocationHook: 'none',
        federationAdapter: 'signature-only',
        apiPolicy: 'scope-only',
        negativeTests: {
          invalidToken: 'run',
          samlReplay: 'run',
          crossTenant: 'run',
          leaverSession: 'run',
          weakRecovery: 'run',
        },
      },
      iamOperations: 'not-selected',
    },
  };
}

function selectedPlan(submission) {
  if (submission?.track === 'developer') return submission?.artifacts?.developer?.negativeTests ?? {};
  if (submission?.track === 'iam-operations') return submission?.artifacts?.iamOperations?.simulations ?? {};
  return {};
}

function selectedArtifactPasses(submission) {
  if (submission?.track === 'developer') {
    return capstoneDeveloperArtifactIsSafe(submission?.artifacts?.developer)
      && submission?.artifacts?.iamOperations === 'not-selected';
  }
  if (submission?.track === 'iam-operations') {
    return submission?.artifacts?.developer === 'not-selected'
      && capstoneIamArtifactIsSafe(submission?.artifacts?.iamOperations);
  }
  return false;
}

function controlResults(submission) {
  const common = submission?.common ?? {};
  return Object.freeze({
    c1: settingsMatch(common.responsibilities, CAPSTONE_SECURE_COMMON.responsibilities),
    c2: settingsMatch(common.credentialLifecycle, CAPSTONE_SECURE_COMMON.credentialLifecycle),
    c3: settingsMatch(common.federation, CAPSTONE_SECURE_COMMON.federation),
    c4: settingsMatch(common.apiAuthorization, CAPSTONE_SECURE_COMMON.apiAuthorization),
    c5: settingsMatch(common.mfaPasskey, CAPSTONE_SECURE_COMMON.mfaPasskey),
    c6: capstoneRiskPlanIsSafe(common.risks, common.priorityOrder),
    c7: selectedArtifactPasses(submission),
  });
}

function criticalRejections(submission, controls) {
  const plan = selectedPlan(submission);
  return CAPSTONE_CRITICAL_TESTS.map((spec) => {
    const skipped = plan[spec.planKey] !== 'run';
    const passed = !skipped && controls[spec.controlKey] === true;
    return Object.freeze({
      id: spec.id,
      critical: true,
      executed: !skipped,
      skipped,
      passed,
      decision: passed ? spec.expected : 'unsafe-or-not-run',
      reason: passed ? 'EXPECTED_REJECTION_CONFIRMED' : (skipped ? 'CRITICAL_TEST_SKIPPED' : 'CONTROL_MISSING'),
    });
  });
}

function unresolvedCritical(submission) {
  const risks = Array.isArray(submission?.common?.risks) ? submission.common.risks : [];
  const riskById = new Map(risks.map((risk) => [risk?.id, risk]));
  return CAPSTONE_RISK_IDS.filter((id) => (
    CAPSTONE_RISK_RULES[id].severity === 'critical'
      && riskById.get(id)?.disposition !== 'resolved'
  )).length;
}

function score(controls) {
  const controlByCheck = {
    'AA-CAP-C1': controls.c1,
    'AA-CAP-C2': controls.c2,
    'AA-CAP-C3': controls.c3,
    'AA-CAP-C4': controls.c4,
    'AA-CAP-C5': controls.c5,
    'AA-CAP-C6': controls.c6,
    'AA-CAP-C7': controls.c7,
  };
  return Object.entries(CAPSTONE_CHECK_WEIGHTS)
    .reduce((total, [checkId, points]) => total + (controlByCheck[checkId] ? points : 0), 0);
}

function decisions(controls) {
  return Object.freeze([
    { id: 'API-OWNER-DELETE', expected: 'allow', actual: controls.c4 ? 'allow' : 'unsafe', passed: controls.c4 },
    { id: 'API-VIEWER-DELETE', expected: 'deny-403', actual: controls.c4 ? 'deny-403' : 'unsafe', passed: controls.c4 },
    { id: 'API-CROSS-TENANT', expected: 'deny-404', actual: controls.c4 ? 'deny-404' : 'unsafe', passed: controls.c4 },
    { id: 'SAML-VALID', expected: 'session-after-validation', actual: controls.c3 ? 'session-after-validation' : 'unsafe', passed: controls.c3 },
    { id: 'SAML-REPLAY', expected: 'deny-before-session', actual: controls.c3 ? 'deny-before-session' : 'unsafe', passed: controls.c3 },
  ]);
}

function lifecycle(controls) {
  return Object.freeze([
    { event: 'joiner', expected: 'provision-after-approved-event', passed: controls.c2 },
    { event: 'mover', expected: 'recalculate-and-revoke-stale-access', passed: controls.c2 },
    { event: 'leaver', expected: 'disable-and-revoke-all-active-access', passed: controls.c2 },
    { event: 'emergency', expected: 'deny-first-then-investigate', passed: controls.c2 },
  ]);
}

export function simulateCapstoneSubmission(submission) {
  const controls = controlResults(submission);
  const rejections = criticalRejections(submission, controls);
  const scorePercent = score(controls);
  return Object.freeze({
    controls,
    rejections: Object.freeze(rejections),
    decisions: decisions(controls),
    lifecycle: lifecycle(controls),
    metrics: Object.freeze({
      scorePercent,
      requiredScorePercent: 80,
      criticalSkipCount: rejections.filter(({ skipped }) => skipped).length,
      criticalFailureCount: rejections.filter(({ passed }) => !passed).length,
      unresolvedCritical: unresolvedCritical(submission),
    }),
  });
}

export async function runCapstoneScenario({ submission, signal } = {}) {
  if (signal?.aborted) throw signal.reason ?? new Error('scenario aborted');
  const mode = submission === undefined ? 'case-baseline' : 'submission-check';
  const selected = submission === undefined ? baselineSubmission() : submission;
  const simulated = simulateCapstoneSubmission(selected);
  return Object.freeze({
    schemaVersion: 1,
    lessonId: 'capstone',
    caseId: CAPSTONE_CASE.id,
    mode,
    track: selected?.track ?? 'unselected',
    evidenceBasis: 'deterministic-capstone-policy-simulator-not-live-protocol',
    runtimeEvidence: true,
    freshCheck: mode === 'submission-check',
    liveProtocolEvidence: false,
    caseFacts: CAPSTONE_CASE.observations,
    controls: simulated.controls,
    criticalRejections: simulated.rejections,
    decisions: simulated.decisions,
    lifecycle: simulated.lifecycle,
    metrics: simulated.metrics,
    humanReview: {
      required: true,
      machineInterpretsFreeText: false,
      rubricLocation: 'instructor-guide',
    },
    redaction: {
      rawCredentials: 'omitted',
      rawTokens: 'omitted',
      personalIdentifiers: 'omitted',
      filesystemPaths: 'omitted',
    },
  });
}
