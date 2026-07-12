import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateLesson06Submission,
  lesson06AnswerKey,
  validateLesson06Submission,
} from '../../course/lessons/06/assessment.mjs';

function runtime() {
  return {
    schemaVersion: 1,
    lessonId: '06',
    evidenceBasis: 'fresh-project-app-to-real-openldap',
    runtimeEvidence: true,
    actualProtocol: true,
    success: {
      status: 200,
      code: 'DIRECTORY_AUTHENTICATED',
      principalId: 'alice',
      directoryDn: 'uid=alice,ou=people,dc=example,dc=test',
      groups: ['engineering', 'security'],
    },
    failures: {
      wrongStatus: 422,
      unknownStatus: 422,
      emptyStatus: 422,
      injectionStatus: 422,
      genericFailuresEqual: true,
      wwwAuthenticateAbsent: true,
    },
    protocol: {
      implementation: {
        userAuthentication: 'resolved-user-dn-simple-bind',
        groupLookup: 'groupOfNames-member-equality-search',
        adminBindUsed: false,
        transportContext: 'loopback-ldap-training-deviation',
        productionRequirement: 'StartTLS-or-LDAPS-with-certificate-validation',
      },
      successOperations: [
        { kind: 'bind', actor: 'read-only-service-account' },
        { kind: 'search', equalityAttribute: 'mail' },
        { kind: 'bind', dnRole: 'user-entry-dn' },
        { kind: 'search', equalityAttribute: 'member' },
      ],
      emptyNetworkReached: false,
      injectionNetworkReached: true,
      injectionFilterConstruction: 'structured-equality-filter',
      injectionFilterEscaped: true,
      injectionOutcome: 'generic-failure',
    },
    safety: {
      redacted: true,
      rawIdentifierOmitted: true,
      passwordOmitted: true,
      bindPasswordOmitted: true,
      containerControlOmitted: true,
      attempts: 5,
      networkAttempts: 4,
    },
  };
}

test('Lesson 06 requires exact allowed submission values and fresh actual LDAP evidence', () => {
  const answer = lesson06AnswerKey();
  assert.deepEqual(validateLesson06Submission(answer), answer);
  const evaluated = evaluateLesson06Submission(answer, runtime());
  assert.equal(evaluated.status, 'pass');
  assert.deepEqual(evaluated.checks.map(({ checkId }) => checkId), ['AA06-C1', 'AA06-C2']);

  const stale = runtime();
  stale.actualProtocol = false;
  assert.throws(() => evaluateLesson06Submission(answer, stale), /runtime observation/u);
});

test('a misconception fails only its mapped required check', () => {
  const answer = lesson06AnswerKey();
  answer.answers['AA06-C2'].emptyPassword = 'send-as-anonymous-bind';
  const evaluated = evaluateLesson06Submission(answer, runtime());
  assert.equal(evaluated.status, 'fail');
  assert.deepEqual(
    evaluated.checks.filter(({ passed }) => !passed).map(({ checkId }) => checkId),
    ['AA06-C2'],
  );
});
