const EXPECTED = Object.freeze({
  'AA06-C1': Object.freeze({
    userLookup: 'service-search-then-user-dn-bind',
    dnMeaning: 'distinguished-name-identifies-entry',
    attributeMeaning: 'named-values-on-entry',
    groupLookup: 'member-equals-user-dn-search',
  }),
  'AA06-C2': Object.freeze({
    emptyPassword: 'reject-before-network',
    filterConstruction: 'structured-equality-filter',
    failureSurface: 'generic-422-without-http-challenge',
    serviceAccount: 'least-privilege-read-only-not-admin',
    productionTransport: 'StartTLS-or-LDAPS-with-certificate-validation',
  }),
});

const ALLOWED = Object.freeze({
  userLookup: ['service-search-then-user-dn-bind', 'admin-bind-validates-user-password'],
  dnMeaning: ['distinguished-name-identifies-entry', 'display-name-shown-to-user'],
  attributeMeaning: ['named-values-on-entry', 'authorization-role-only'],
  groupLookup: ['member-equals-user-dn-search', 'group-is-returned-by-user-bind'],
  emptyPassword: ['reject-before-network', 'send-as-anonymous-bind'],
  filterConstruction: ['structured-equality-filter', 'string-concatenation-with-raw-input'],
  failureSurface: ['generic-422-without-http-challenge', 'different-status-for-each-failure'],
  serviceAccount: ['least-privilege-read-only-not-admin', 'directory-admin-for-all-operations'],
  productionTransport: ['StartTLS-or-LDAPS-with-certificate-validation', 'cleartext-ldap-on-any-network'],
});

export class Lesson06SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson06SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson06SubmissionError(reasonCode, message);
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

export function validateLesson06Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '06') {
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
  return Object.entries(expected).every(([field, value]) => actual[field] === value);
}

export function evaluateLesson06Submission(submissionInput, runtime) {
  const submission = validateLesson06Submission(submissionInput);
  if (runtime?.schemaVersion !== 1
      || runtime.lessonId !== '06'
      || runtime.runtimeEvidence !== true
      || runtime.actualProtocol !== true) {
    throw new TypeError('Lesson 06 runtime observation is invalid');
  }
  const operations = runtime.protocol?.successOperations ?? [];
  const c1Runtime = runtime.evidenceBasis === 'fresh-project-app-to-real-openldap'
    && runtime.success?.status === 200
    && runtime.success.code === 'DIRECTORY_AUTHENTICATED'
    && runtime.success.principalId === 'alice'
    && runtime.success.directoryDn === 'uid=alice,ou=people,dc=example,dc=test'
    && JSON.stringify(runtime.success.groups) === JSON.stringify(['engineering', 'security'])
    && JSON.stringify(operations.map(({ kind }) => kind)) === JSON.stringify(['bind', 'search', 'bind', 'search'])
    && operations[0]?.actor === 'read-only-service-account'
    && operations[1]?.equalityAttribute === 'mail'
    && operations[2]?.dnRole === 'user-entry-dn'
    && operations[3]?.equalityAttribute === 'member'
    && runtime.protocol.implementation?.userAuthentication === 'resolved-user-dn-simple-bind'
    && runtime.protocol.implementation?.groupLookup === 'groupOfNames-member-equality-search';
  const failures = runtime.failures ?? {};
  const implementation = runtime.protocol?.implementation ?? {};
  const c2Runtime = [
    failures.wrongStatus,
    failures.unknownStatus,
    failures.emptyStatus,
    failures.injectionStatus,
  ].every((status) => status === 422)
    && failures.genericFailuresEqual === true
    && failures.wwwAuthenticateAbsent === true
    && runtime.protocol.emptyNetworkReached === false
    && runtime.protocol.injectionNetworkReached === true
    && runtime.protocol.injectionFilterConstruction === 'structured-equality-filter'
    && runtime.protocol.injectionFilterEscaped === true
    && runtime.protocol.injectionOutcome === 'generic-failure'
    && implementation.adminBindUsed === false
    && implementation.transportContext === 'loopback-ldap-training-deviation'
    && implementation.productionRequirement === 'StartTLS-or-LDAPS-with-certificate-validation'
    && runtime.safety?.redacted === true
    && runtime.safety.rawIdentifierOmitted === true
    && runtime.safety.passwordOmitted === true
    && runtime.safety.bindPasswordOmitted === true
    && runtime.safety.containerControlOmitted === true
    && runtime.safety.attempts === 5
    && runtime.safety.networkAttempts === 4;

  const checks = [
    {
      checkId: 'AA06-C1',
      runtimePassed: c1Runtime,
      submissionPassed: answersMatch(submission.answers['AA06-C1'], EXPECTED['AA06-C1']),
      data: {
        evidenceBasis: runtime.evidenceBasis,
        successStatus: runtime.success?.status,
        principalId: runtime.success?.principalId,
        groupCount: runtime.success?.groups?.length,
        operationKinds: operations.map(({ kind }) => kind).join('>'),
      },
    },
    {
      checkId: 'AA06-C2',
      runtimePassed: c2Runtime,
      submissionPassed: answersMatch(submission.answers['AA06-C2'], EXPECTED['AA06-C2']),
      data: {
        genericFailureStatus: failures.wrongStatus,
        genericFailuresEqual: failures.genericFailuresEqual,
        httpChallengeAbsent: failures.wwwAuthenticateAbsent,
        emptyNetworkReached: runtime.protocol?.emptyNetworkReached,
        injectionEscaped: runtime.protocol?.injectionFilterEscaped,
        adminBindUsed: implementation.adminBindUsed,
        redacted: runtime.safety?.redacted,
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

export function lesson06AnswerKey() {
  return structuredClone({ schemaVersion: 1, lessonId: '06', answers: EXPECTED });
}
