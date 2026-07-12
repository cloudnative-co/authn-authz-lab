const EXPECTED = Object.freeze({
  'AA08-C1': Object.freeze({
    platform: 'samba-ad-compatible-not-microsoft-ad-ds-or-freeipa',
    directory: 'verified-ldaps-service-search-user-bind-group-search',
    identity: 'objectguid-derived-opaque-stable-id',
    kerberos: 'same-samba-platform-separate-from-ldaps-app-auth',
    scope: 'no-gpo-windows-join-or-product-generalization',
  }),
  'AA08-C2': Object.freeze({
    mapping: 'explicit-group-to-role-policy',
    organization: 'engineering-group-is-not-an-app-role',
    mover: 'existing-session-stale-until-revalidation-then-new-login',
    leaver: 'disable-blocks-new-auth-existing-session-needs-revalidation',
    serviceAccount: 'read-only-write-rejected',
  }),
});

const EXPECTED_DIAGNOSIS = Object.freeze({
  D1: 'directory-state-and-app-session-state-have-different-lifecycles',
  D2: 'dn-and-email-can-change-objectguid-derived-key-remains-stable',
  D3: 'group-membership-is-input-to-explicit-app-policy-not-the-role-itself',
  D4: 'generic-login-rejection-does-not-revoke-existing-app-sessions',
});

const ALLOWED = Object.freeze({
  platform: [
    EXPECTED['AA08-C1'].platform,
    'microsoft-ad-ds-and-freeipa-both-proven',
  ],
  directory: [
    EXPECTED['AA08-C1'].directory,
    'cleartext-ldap-admin-bind-and-string-filter',
  ],
  identity: [
    EXPECTED['AA08-C1'].identity,
    'email-or-dn-as-immutable-primary-key',
  ],
  kerberos: [
    EXPECTED['AA08-C1'].kerberos,
    'kinit-proves-the-app-authenticated-with-kerberos',
  ],
  scope: [
    EXPECTED['AA08-C1'].scope,
    'gpo-windows-join-and-freeipa-features-proven',
  ],
  mapping: [EXPECTED['AA08-C2'].mapping, 'directory-group-name-is-the-app-role'],
  organization: [EXPECTED['AA08-C2'].organization, 'all-organization-groups-grant-app-permissions'],
  mover: [EXPECTED['AA08-C2'].mover, 'directory-group-change-rewrites-existing-session-immediately'],
  leaver: [EXPECTED['AA08-C2'].leaver, 'directory-disable-destroys-all-app-sessions-automatically'],
  serviceAccount: [EXPECTED['AA08-C2'].serviceAccount, 'admin-write-access-required-for-login'],
  D1: [EXPECTED_DIAGNOSIS.D1, 'directory-and-app-session-are-the-same-state-store'],
  D2: [EXPECTED_DIAGNOSIS.D2, 'email-is-always-more-stable-than-objectguid'],
  D3: [EXPECTED_DIAGNOSIS.D3, 'group-name-must-be-copied-directly-into-app-permission'],
  D4: [EXPECTED_DIAGNOSIS.D4, 'generic-422-proves-every-existing-session-was-revoked'],
});

export class Lesson08SubmissionError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson08SubmissionError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson08SubmissionError(reasonCode, message);
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

export function validateLesson08Submission(value) {
  exactKeys(value, ['schemaVersion', 'lessonId', 'answers', 'diagnosis'], 'submission');
  if (value.schemaVersion !== 1 || value.lessonId !== '08') {
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
  exactKeys(value.diagnosis, Object.keys(EXPECTED_DIAGNOSIS), 'diagnosis');
  for (const [field, answer] of Object.entries(value.diagnosis)) {
    if (!ALLOWED[field]?.includes(answer)) fail('SUBMISSION_VALUE_INVALID', `diagnosis.${field} is not allowed`);
  }
  return structuredClone(value);
}

function answersMatch(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function diagnosisScore(actual) {
  return Object.entries(EXPECTED_DIAGNOSIS).filter(([key, value]) => actual[key] === value).length;
}

function validRuntime(runtime) {
  return runtime?.schemaVersion === 1
    && runtime.lessonId === '08'
    && runtime.evidenceBasis === 'samba-ad-compatible-dc-verified-ldaps-jml-session-revalidation-and-kinit'
    && runtime.runtimeEvidence === true
    && runtime.actualProtocol === true;
}

export function evaluateLesson08Submission(submissionInput, runtime) {
  const submission = validateLesson08Submission(submissionInput);
  if (!validRuntime(runtime)) throw new TypeError('lesson 08 runtime observation is invalid');

  const c1Runtime = runtime.implementation?.sambaAdCompatibleDomainController === true
    && runtime.implementation.microsoftAdDsRuntime === false
    && runtime.implementation.freeIpaRuntime === false
    && runtime.implementation.gpoOrWindowsJoinProven === false
    && runtime.implementation.network === 'compose-internal-no-published-ports'
    && runtime.directory?.transport === 'LDAPS'
    && runtime.directory.caVerified === true
    && runtime.directory.hostnameVerified === true
    && runtime.directory.operations?.join('|')
      === 'service-bind|structured-user-search|resolved-user-bind|structured-group-search|explicit-group-to-role-mapping'
    && runtime.identity?.applicationKey === 'objectGUID-derived-opaque-stable-id'
    && runtime.identity.opaqueFormatValid === true
    && runtime.identity.stableIdPreservedAcrossMove === true
    && runtime.identity.emailNotUsedAsApplicationKey === true
    && runtime.kerberos?.sameSambaIdentityPlatform === true
    && runtime.kerberos.applicationAuthenticationPath === 'LDAPS-not-Kerberos';

  const explicitMapping = runtime.mapping?.explicit;
  const c2Runtime = Array.isArray(explicitMapping)
    && explicitMapping.length === 2
    && explicitMapping[0]?.directoryGroup === 'CourseAppViewer'
    && explicitMapping[0]?.appRole === 'viewer'
    && explicitMapping[1]?.directoryGroup === 'CourseAppEditor'
    && explicitMapping[1]?.appRole === 'editor'
    && runtime.mapping.organizationGroupIgnored === 'Engineering'
    && runtime.directory?.serviceAccountWriteRejected === true
    && runtime.joiner?.sessionRole?.join('|') === 'viewer'
    && runtime.mover?.existingSessionRoleBeforeRevalidation?.join('|') === 'viewer'
    && runtime.mover.revalidationReason === 'DIRECTORY_ROLE_CHANGED'
    && runtime.mover.stableIdPreserved === true
    && runtime.mover.directoryLocationChanged === true
    && runtime.mover.oldSessionRejectedAfterRevalidation === true
    && runtime.mover.newSessionRole?.join('|') === 'editor'
    && runtime.leaver?.disabledLoginGeneric === true
    && runtime.leaver.existingSessionRoleBeforeRevalidation?.join('|') === 'editor'
    && runtime.leaver.revalidationReason === 'DIRECTORY_ACCOUNT_DISABLED'
    && runtime.leaver.oldSessionRejectedAfterRevalidation === true
    && runtime.safety?.passwordOmitted === true
    && runtime.safety.sessionTokensOmitted === true
    && runtime.safety.rawObjectGuidOmitted === true
    && runtime.safety.distinguishedNameOmitted === true;

  const score = diagnosisScore(submission.diagnosis);
  const checks = [
    {
      checkId: 'AA08-C1',
      runtimePassed: c1Runtime,
      submissionPassed: answersMatch(submission.answers['AA08-C1'], EXPECTED['AA08-C1']),
      data: {
        runtime: runtime.implementation?.runtime,
        directoryTransport: runtime.directory?.transport,
        caVerified: runtime.directory?.caVerified,
        hostnameVerified: runtime.directory?.hostnameVerified,
        stableIdPreserved: runtime.identity?.stableIdPreservedAcrossMove,
        tgtObserved: runtime.kerberos?.tgtObservedByKlist,
      },
    },
    {
      checkId: 'AA08-C2',
      runtimePassed: c2Runtime,
      submissionPassed: answersMatch(submission.answers['AA08-C2'], EXPECTED['AA08-C2']) && score >= 3,
      data: {
        serviceWriteRejected: runtime.directory?.serviceAccountWriteRejected,
        moverOldRole: runtime.mover?.existingSessionRoleBeforeRevalidation?.[0],
        moverNewRole: runtime.mover?.newSessionRole?.[0],
        moverRevalidation: runtime.mover?.revalidationReason,
        leaverRevalidation: runtime.leaver?.revalidationReason,
        disabledLoginGeneric: runtime.leaver?.disabledLoginGeneric,
        diagnosisScore: score,
        diagnosisRequired: 3,
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

export function lesson08AnswerKey() {
  return structuredClone({
    schemaVersion: 1,
    lessonId: '08',
    answers: EXPECTED,
    diagnosis: EXPECTED_DIAGNOSIS,
  });
}
