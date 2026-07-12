import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  evaluateLesson07Submission,
  lesson07AnswerKey,
  validateLesson07Submission,
} from '../../course/lessons/07/assessment.mjs';

function runtime() {
  return {
    schemaVersion: 1,
    lessonId: '07',
    evidenceBasis: 'mit-kerberos-v5-kdc-kinit-klist-tgs-gssapi-http-negotiate',
    runtimeEvidence: true,
    wireEvidence: true,
    normal: {
      afterKinit: {
        canonicalPrincipal: true,
        tgtPresent: true,
        httpServiceTicketPresent: false,
        ticketServicePrincipals: ['krbtgt/EXAMPLE.TEST@EXAMPLE.TEST'],
      },
      challenge: { status: 401, scheme: 'Negotiate' },
      authenticated: { status: 200, code: 'KERBEROS_AUTHENTICATED', principal: 'alice@EXAMPLE.TEST' },
      afterServiceRequest: {
        tgtPresent: true,
        httpServiceTicketPresent: true,
        ticketServicePrincipals: [
          'krbtgt/EXAMPLE.TEST@EXAMPLE.TEST',
          'HTTP/app.example.test@EXAMPLE.TEST',
        ],
      },
    },
    rejection: {
      wrongSpn: { rejected: true, stage: 'TGS', reason: 'SERVICE_PRINCIPAL_UNKNOWN' },
      clockSkew: {
        stage: 'AP-GSSAPI', processOffset: '+10-minutes', status: 401,
        code: 'NEGOTIATE_REQUIRED', reason: 'CLOCK_SKEW_REJECTED',
      },
      staleKeytab: {
        stage: 'AP-GSSAPI', status: 401, code: 'NEGOTIATE_REQUIRED',
        reason: 'ACCEPTOR_KEY_MISMATCH', currentKvnoGreaterThanStale: true, currentRestored: true,
      },
      genericHttpSurface: true,
    },
    protocol: {
      implementation: 'MIT-Kerberos-V5-and-GSSAPI',
      exchange: 'AS-TGS-AP-over-HTTP-Negotiate',
      mechanismScope: 'Kerberos-v5-in-SPNEGO',
      generalSpnegoContinuationSupported: false,
      incompleteContextCount: 0,
      finalAcceptorTokenObserved: true,
      browserBehaviorGeneralized: false,
      curlGssApi: true,
      curlSpnego: true,
    },
    safety: {
      transportContext: 'compose-private-http-training-deviation',
      productionRequirement: 'tls-required',
      authorizationTokenOmitted: true,
      responseTokenOmitted: true,
      keytabOmitted: true,
      nativeErrorOmitted: true,
      passwordOmitted: true,
      keytabReadOnly: true,
      hostClockChanged: false,
    },
  };
}

test('exact answers and five diagnoses pass both runtime-backed checks', () => {
  const evaluated = evaluateLesson07Submission(lesson07AnswerKey(), runtime());
  assert.equal(evaluated.status, 'pass');
  assert.deepEqual(evaluated.checks.map(({ checkId, passed }) => [checkId, passed]), [
    ['AA07-C1', true],
    ['AA07-C2', true],
  ]);
  assert.equal(evaluated.checks[1].data.diagnosisScore, 5);
});

test('TODO, unknown fields and unknown values are rejected', async () => {
  const template = JSON.parse(await readFile(
    new URL('../../course/lessons/07/workspace-template.json', import.meta.url),
    'utf8',
  ));
  assert.throws(() => validateLesson07Submission(template), /not allowed/u);
  assert.throws(() => validateLesson07Submission({ ...lesson07AnswerKey(), extra: true }), /unknown fields/u);
  const invalid = lesson07AnswerKey();
  invalid.answers['AA07-C1'].tgt = 'unknown';
  assert.throws(() => validateLesson07Submission(invalid), /not allowed/u);
});

test('four of five diagnoses pass and three of five fail AA07-C2 only', () => {
  const four = lesson07AnswerKey();
  four.diagnosis.D5 = 'negotiate-challenge-proves-every-browser-sent-kerberos';
  assert.equal(evaluateLesson07Submission(four, runtime()).status, 'pass');

  const three = structuredClone(four);
  three.diagnosis.D4 = 'keytab-kvno-is-ignored-by-the-acceptor';
  const evaluated = evaluateLesson07Submission(three, runtime());
  assert.equal(evaluated.status, 'fail');
  assert.deepEqual(evaluated.checks.map(({ passed }) => passed), [true, false]);
  assert.equal(evaluated.checks[1].data.diagnosisScore, 3);
});

test('normal and rejection runtime tampering fail only the mapped check', () => {
  const normal = runtime();
  normal.normal.afterKinit.httpServiceTicketPresent = true;
  assert.deepEqual(
    evaluateLesson07Submission(lesson07AnswerKey(), normal).checks.map(({ passed }) => passed),
    [false, true],
  );

  const rejection = runtime();
  rejection.rejection.staleKeytab.currentRestored = false;
  assert.deepEqual(
    evaluateLesson07Submission(lesson07AnswerKey(), rejection).checks.map(({ passed }) => passed),
    [true, false],
  );
});

test('synthetic evidence basis and a claimed general SPNEGO continuation fail closed', () => {
  for (const mutate of [
    (value) => { value.evidenceBasis = 'unit-only'; },
    (value) => { value.runtimeEvidence = false; },
    (value) => { value.wireEvidence = false; },
  ]) {
    const observed = runtime();
    mutate(observed);
    assert.throws(
      () => evaluateLesson07Submission(lesson07AnswerKey(), observed),
      /runtime observation is invalid/u,
    );
  }
  const generalized = runtime();
  generalized.protocol.generalSpnegoContinuationSupported = true;
  assert.deepEqual(
    evaluateLesson07Submission(lesson07AnswerKey(), generalized).checks.map(({ passed }) => passed),
    [false, true],
  );
});
