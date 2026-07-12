import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateLesson08Submission,
  lesson08AnswerKey,
  Lesson08SubmissionError,
  validateLesson08Submission,
} from '../../course/lessons/08/assessment.mjs';
import { lesson08ManagedComposeSpec } from '../../course/lessons/08/lab-contract.mjs';
import { runLesson08Scenario } from '../../course/lessons/08/scenario.mjs';

const PASSWORD = 'runtime-only-password-for-lesson-08';

function response(status, body) {
  return Object.freeze({ status, body: Object.freeze(body) });
}

function fakeAdapter() {
  let phase = 'empty';
  let loginCount = 0;
  const revoked = new Set();
  return Object.freeze({
    async admin(stage) {
      phase = stage;
      return { stage, applied: true };
    },
    async resetApp() {
      revoked.clear();
      return response(200, { code: 'COURSE_STATE_RESET' });
    },
    async health() {
      return response(200, {
        implementation: 'Samba AD-compatible DC over verified LDAPS',
        notMicrosoftAdDs: true,
        notFreeIpaRuntime: true,
      });
    },
    async policy() {
      return response(200, {
        mapping: [
          { directoryGroup: 'CourseAppViewer', appRole: 'viewer' },
          { directoryGroup: 'CourseAppEditor', appRole: 'editor' },
        ],
        organizationGroupIgnored: 'Engineering',
      });
    },
    async login() {
      if (phase === 'leaver') return response(422, { code: 'DIRECTORY_AUTH_FAILED' });
      loginCount += 1;
      return response(200, {
        code: 'DIRECTORY_AUTHENTICATED',
        sessionToken: loginCount === 1 ? 'a'.repeat(43) : 'b'.repeat(43),
        principal: { stableId: 'usr_abcdefghijklmnopqrstuvwx', roles: [phase === 'mover' ? 'editor' : 'viewer'] },
        protocol: {
          transport: 'LDAPS',
          caVerified: true,
          hostnameVerified: true,
          operations: [
            'service-bind',
            'structured-user-search',
            'resolved-user-bind',
            'structured-group-search',
            'explicit-group-to-role-mapping',
          ],
        },
      });
    },
    async wrongPassword() {
      return response(422, { code: 'DIRECTORY_AUTH_FAILED' });
    },
    async serviceWriteProbe() {
      return response(200, { code: 'SERVICE_ACCOUNT_WRITE_REJECTED', outcome: 'INSUFFICIENT_ACCESS' });
    },
    async kerberos() {
      return { canonicalPrincipal: true, tgtPresent: true };
    },
    async session(token) {
      if (revoked.has(token)) return response(401, { code: 'APP_SESSION_INVALID' });
      return response(200, {
        code: 'APP_SESSION_ACTIVE',
        principal: { roles: [token.startsWith('a') ? 'viewer' : 'editor'] },
      });
    },
    async revalidate(token) {
      revoked.add(token);
      if (phase === 'mover') return response(409, {
        code: 'APP_SESSION_REVOKED',
        reason: 'DIRECTORY_ROLE_CHANGED',
        stableIdPreserved: true,
        directoryLocationChanged: true,
      });
      return response(409, {
        code: 'APP_SESSION_REVOKED',
        reason: 'DIRECTORY_ACCOUNT_DISABLED',
        stableIdPreserved: true,
      });
    },
  });
}

test('fresh JML scenario preserves stable identity and exposes session boundaries', async () => {
  const runtime = await runLesson08Scenario({ adapter: fakeAdapter(), password: PASSWORD });
  assert.equal(runtime.identity.stableIdPreservedAcrossMove, true);
  assert.deepEqual(runtime.joiner.sessionRole, ['viewer']);
  assert.deepEqual(runtime.mover.existingSessionRoleBeforeRevalidation, ['viewer']);
  assert.deepEqual(runtime.mover.newSessionRole, ['editor']);
  assert.equal(runtime.leaver.disabledLoginGeneric, true);
  assert.equal(runtime.leaver.existingSessionBeforeRevalidationStatus, 200);
  assert.equal(runtime.kerberos.sameSambaIdentityPlatform, true);
  assert.equal(JSON.stringify(runtime).includes(PASSWORD), false);
});

test('answer key passes only with actual runtime evidence', async () => {
  const runtime = await runLesson08Scenario({ adapter: fakeAdapter(), password: PASSWORD });
  const result = evaluateLesson08Submission(lesson08AnswerKey(), runtime);
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.checks.map(({ passed }) => passed), [true, true]);
});

test('misconceptions fail while unknown submission values are rejected', async () => {
  const runtime = await runLesson08Scenario({ adapter: fakeAdapter(), password: PASSWORD });
  const submission = lesson08AnswerKey();
  submission.answers['AA08-C2'].leaver = 'directory-disable-destroys-all-app-sessions-automatically';
  assert.equal(evaluateLesson08Submission(submission, runtime).status, 'fail');
  submission.answers['AA08-C2'].leaver = 'unbounded-answer';
  assert.throws(
    () => validateLesson08Submission(submission),
    (error) => error instanceof Lesson08SubmissionError && error.reasonCode === 'SUBMISSION_VALUE_INVALID',
  );
});

test('managed Compose contract publishes no host ports and owns every lab resource', () => {
  const spec = lesson08ManagedComposeSpec({
    repoRoot: '/repo',
    secretDirectory: '/repo/.lab/state/containers/identity-platform-lab',
  });
  assert.deepEqual(spec.expectedServices, ['app', 'client', 'dc']);
  assert.deepEqual(spec.publishedPorts, []);
  assert.deepEqual(spec.expectedNetworks, ['default']);
  assert.deepEqual(spec.expectedVolumes, [
    'lesson08_ca_public',
    'lesson08_directory_data',
    'lesson08_samba_tls',
  ]);
});
