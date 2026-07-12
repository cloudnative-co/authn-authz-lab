const EXPECTED = Object.freeze({
  'AA04-C1': Object.freeze({
    sessionFailure: 'generic-403-without-challenge',
    principalSource: 'cookie-session-only',
    authorizationAttributes: 'project-core-source-of-record',
    callerClaims: 'ignored',
    unauthenticatedAudit: 'absent',
  }),
  'AA04-C2': Object.freeze({
    ownerDelete: 'allowed-204-and-resource-removed',
    viewerDelete: 'denied-403-and-resource-preserved',
    decisionMutationAudit: 'atomic-single-transaction',
  }),
  'AA04-C3': Object.freeze({
    concealmentPolicy: 'outsider-cross-tenant-missing-repeat-same-404',
    bolaDefense: 'project-core-rechecks-subject-resource-relation',
  }),
  'AA04-C4': Object.freeze({
    auditFields: 'subject-resource-action-decision-status-reason-only',
    auditSecrets: 'absent',
    retention: 'bounded-64',
    decisionCoverage: 'six-policy-decisions',
  }),
});

const ALLOWED = Object.freeze({
  sessionFailure: ['generic-403-without-challenge', '401-without-www-authenticate'],
  principalSource: ['cookie-session-only', 'x-principal-id-header'],
  authorizationAttributes: ['project-core-source-of-record', 'caller-role-and-tenant-headers'],
  callerClaims: ['ignored', 'trusted-for-authorization'],
  unauthenticatedAudit: ['absent', 'project-core-denial-recorded'],
  ownerDelete: ['allowed-204-and-resource-removed', 'allowed-200-with-resource-body'],
  viewerDelete: ['denied-403-and-resource-preserved', 'allowed-by-viewer-role'],
  decisionMutationAudit: ['atomic-single-transaction', 'independent-best-effort-steps'],
  concealmentPolicy: [
    'outsider-cross-tenant-missing-repeat-same-404',
    'different-response-by-resource-existence',
  ],
  bolaDefense: [
    'project-core-rechecks-subject-resource-relation',
    'browser-supplied-project-role-is-sufficient',
  ],
  auditFields: [
    'subject-resource-action-decision-status-reason-only',
    'full-request-cookie-and-headers',
  ],
  auditSecrets: ['absent', 'session-and-password-retained'],
  retention: ['bounded-64', 'unbounded'],
  decisionCoverage: ['six-policy-decisions', 'successful-delete-only'],
});

export class Lesson04SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson04SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson04SubmissionError(reasonCode, message);
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, path) {
  if (!plainRecord(value)) fail('SUBMISSION_SCHEMA_INVALID', `${path} must be an object`);
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    fail('SUBMISSION_SCHEMA_INVALID', `${path} has missing or unknown fields`);
  }
}

export function validateLesson04Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '04') {
    fail('SUBMISSION_VERSION_INVALID', 'submission schemaVersion or lessonId is unsupported');
  }
  exactKeys(value.answers, Object.keys(EXPECTED), 'answers');
  for (const [checkId, expected] of Object.entries(EXPECTED)) {
    exactKeys(value.answers[checkId], Object.keys(expected), `answers.${checkId}`);
    for (const [field, answer] of Object.entries(value.answers[checkId])) {
      if (!ALLOWED[field]?.includes(answer)) {
        fail('SUBMISSION_VALUE_INVALID', `answers.${checkId}.${field} is not allowed`);
      }
    }
  }
  return structuredClone(value);
}

function answersMatch(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export function evaluateLesson04Submission(submissionInput, runtime) {
  const submission = validateLesson04Submission(submissionInput);
  if (runtime?.schemaVersion !== 1
      || runtime.lessonId !== '04'
      || runtime.evidenceBasis !== 'project-app-runtime-http-cookie-project-core'
      || runtime.runtimeEvidence !== true
      || runtime.wireEvidence !== true) {
    throw new TypeError('lesson 04 runtime observation is invalid');
  }

  const c1Runtime = runtime.enforcement?.anonymousStatus === 403
    && runtime.enforcement.anonymousCode === 'SESSION_UNAVAILABLE'
    && runtime.enforcement.wwwAuthenticateAbsent === true
    && runtime.enforcement.unauthenticatedAuditCount === 0
    && runtime.enforcement.principalSource === 'cookie-session'
    && runtime.enforcement.roleAndTenantSource === 'project-core-source-of-record'
    && runtime.enforcement.callerRoleHeadersAccepted === false;
  const c2Runtime = runtime.owner?.status === 204
    && runtime.owner.projectPresentAfter === false
    && runtime.owner.auditDecision === 'allow'
    && runtime.owner.auditStatus === 204
    && runtime.viewer?.status === 403
    && runtime.viewer.code === 'PROJECT_DELETE_FORBIDDEN'
    && runtime.viewer.projectPresentAfter === true
    && runtime.viewer.auditDecision === 'deny'
    && runtime.viewer.auditStatus === 403;
  const c3Runtime = runtime.concealment?.outsiderStatus === 404
    && runtime.concealment.crossTenantStatus === 404
    && runtime.concealment.missingStatus === 404
    && runtime.concealment.repeatedDeleteStatus === 404
    && runtime.concealment.responsesEqual === true;
  const c4Runtime = runtime.audit?.retainedEntryCount === 6
    && sameArray(runtime.audit.statuses, [403, 404, 404, 404, 204, 404])
    && runtime.audit.exactPolicyFields === true
    && runtime.audit.redacted === true
    && runtime.audit.bounded === true;

  const checks = [
    {
      checkId: 'AA04-C1', runtimePassed: c1Runtime,
      submissionPassed: answersMatch(submission.answers['AA04-C1'], EXPECTED['AA04-C1']),
      data: {
        anonymousStatus: runtime.enforcement?.anonymousStatus,
        anonymousCode: runtime.enforcement?.anonymousCode,
        wwwAuthenticateAbsent: runtime.enforcement?.wwwAuthenticateAbsent,
        unauthenticatedAuditCount: runtime.enforcement?.unauthenticatedAuditCount,
        principalSource: runtime.enforcement?.principalSource,
        authorizationAttributeSource: runtime.enforcement?.roleAndTenantSource,
        callerClaimsAccepted: runtime.enforcement?.callerRoleHeadersAccepted,
      },
    },
    {
      checkId: 'AA04-C2', runtimePassed: c2Runtime,
      submissionPassed: answersMatch(submission.answers['AA04-C2'], EXPECTED['AA04-C2']),
      data: {
        ownerStatus: runtime.owner?.status,
        ownerProjectPresentAfter: runtime.owner?.projectPresentAfter,
        ownerAuditDecision: runtime.owner?.auditDecision,
        ownerAuditStatus: runtime.owner?.auditStatus,
        viewerStatus: runtime.viewer?.status,
        viewerProjectPresentAfter: runtime.viewer?.projectPresentAfter,
        viewerAuditDecision: runtime.viewer?.auditDecision,
        viewerAuditStatus: runtime.viewer?.auditStatus,
      },
    },
    {
      checkId: 'AA04-C3', runtimePassed: c3Runtime,
      submissionPassed: answersMatch(submission.answers['AA04-C3'], EXPECTED['AA04-C3']),
      data: {
        outsiderStatus: runtime.concealment?.outsiderStatus,
        crossTenantStatus: runtime.concealment?.crossTenantStatus,
        missingStatus: runtime.concealment?.missingStatus,
        repeatedDeleteStatus: runtime.concealment?.repeatedDeleteStatus,
        concealedResponsesEqual: runtime.concealment?.responsesEqual,
      },
    },
    {
      checkId: 'AA04-C4', runtimePassed: c4Runtime,
      submissionPassed: answersMatch(submission.answers['AA04-C4'], EXPECTED['AA04-C4']),
      data: {
        retainedEntryCount: runtime.audit?.retainedEntryCount,
        decisionStatusSequence: runtime.audit?.statuses?.join(','),
        exactPolicyFields: runtime.audit?.exactPolicyFields,
        sensitiveValuesAbsent: runtime.audit?.redacted,
        boundedRetention: runtime.audit?.bounded,
      },
    },
  ].map((check) => Object.freeze({
    ...check,
    passed: check.runtimePassed && check.submissionPassed,
    allowlist: Object.freeze(Object.keys(check.data)),
  }));

  return Object.freeze({
    status: checks.every(({ passed }) => passed) ? 'pass' : 'fail',
    checks: Object.freeze(checks),
  });
}

export function lesson04AnswerKey() {
  return structuredClone({ schemaVersion: 1, lessonId: '04', answers: EXPECTED });
}
