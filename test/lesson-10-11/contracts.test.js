import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { getLessonImplementation } from '../../course/lessons/registry.mjs';
import {
  lesson10AnswerKey,
  validateLesson10Submission,
} from '../../course/lessons/10/assessment.mjs';
import { lesson10Adapter } from '../../course/lessons/10/runner.mjs';
import {
  lesson11AnswerKey,
  validateLesson11Submission,
} from '../../course/lessons/11/assessment.mjs';
import { lesson11Adapter } from '../../course/lessons/11/runner.mjs';

test('Lesson 10 and 11 answer schemas reject TODO, unknown fields, and unknown values', async () => {
  for (const [lessonId, validate, answerKey] of [
    ['10', validateLesson10Submission, lesson10AnswerKey],
    ['11', validateLesson11Submission, lesson11AnswerKey],
  ]) {
    const template = JSON.parse(await readFile(
      new URL(`../../course/lessons/${lessonId}/workspace-template.json`, import.meta.url), 'utf8',
    ));
    assert.throws(() => validate(template), /not allowed/u);
    assert.throws(() => validate({ ...answerKey(), extra: true }), /unknown fields/u);
    const invalid = answerKey();
    const [checkId] = Object.keys(invalid.answers);
    const [field] = Object.keys(invalid.answers[checkId]);
    invalid.answers[checkId][field] = 'unknown';
    assert.throws(() => validate(invalid), /not allowed/u);
    assert.deepEqual(validate(answerKey()), answerKey());
  }
});

test('OAuth adapters are registered behind the shared managed-runtime boundary', () => {
  for (const [adapter, id] of [[lesson10Adapter, '10'], [lesson11Adapter, '11']]) {
    assert.equal(adapter.id, id);
    assert.deepEqual(adapter.checkIds, [`AA${id}-C1`, `AA${id}-C2`]);
    assert.equal(adapter.runtimeKind, 'standalone-three-origin-http-lab');
    assert.deepEqual(adapter.fixedOrigins, [
      'http://127.0.0.1:4100',
      'http://127.0.0.1:4101',
      'http://127.0.0.1:4102',
    ]);
    assert.equal(adapter.lifecycleContract.stop, 'idempotent-close-owned-listeners');
    assert.equal(typeof adapter.runScenario, 'function');
    assert.equal(typeof adapter.evaluate, 'function');
    assert.equal(typeof adapter.initializeWorkspace, 'function');
    assert.equal(adapter.requiresProjectApp, false);
    assert.deepEqual(adapter.externalResourceIds, ['oauth-lab']);
    assert.equal(typeof adapter.inspectExternal, 'function');
    assert.equal(typeof adapter.ensureExternal, 'function');
    assert.deepEqual(getLessonImplementation(id).implementedCheckIds, [`AA${id}-C1`, `AA${id}-C2`]);
  }
});

test('Lesson 11 separates RP subject checks, issuer contract, and the external identity key', async () => {
  const answer = lesson11AnswerKey();
  assert.equal(answer.answers['AA11-C2'].identityKey, 'issuer-subject-pair');

  const [readme, design, answerKey] = await Promise.all([
    readFile(new URL('../../course/lessons/11/README.md', import.meta.url), 'utf8'),
    readFile(new URL('../../course/lessons/11/technical-design.md', import.meta.url), 'utf8'),
    readFile(new URL('../../course/lessons/11/answer-key.md', import.meta.url), 'utf8'),
  ]);
  const combined = [readme, design, answerKey].join('\n');
  assert.match(combined, /non-empty|非空/u);
  assert.match(combined, /255/u);
  assert.match(combined, /issuer contract|issuerの契約/u);
  assert.match(combined, /\(iss, sub\)/u);
  assert.doesNotMatch(answerKey, /identityKey: `stable-opaque-subject`/u);
});

test('materials teach protocol roles, deliberate deviations, rejection work, and practical transfer', async () => {
  for (const lessonId of ['10', '11']) {
    const files = await Promise.all(['README.md', 'technical-design.md', 'answer-key.md', 'instructor-guide.md']
      .map((name) => readFile(new URL(`../../course/lessons/${lessonId}/${name}`, import.meta.url), 'utf8')));
    const combined = files.join('\n');
    assert.match(combined, /127\.0\.0\.1:4100/u);
    assert.match(combined, /127\.0\.0\.1:4101/u);
    assert.match(combined, /HTTP/u);
    assert.match(combined, /HTTPS/u);
    assert.match(combined, /予測/u);
    assert.match(combined, /実務/u);
    assert.match(combined, /証拠|evidence/u);
  }
  const oauth = await readFile(new URL('../../course/lessons/10/technical-design.md', import.meta.url), 'utf8');
  assert.match(oauth, /RFC 7662/u);
  assert.match(oauth, /private AS interaction state/u);
  const oidc = await readFile(new URL('../../course/lessons/11/technical-design.md', import.meta.url), 'utf8');
  assert.match(oidc, /discovery/u);
  assert.match(oidc, /JWKS/u);
  assert.match(oidc, /not OIDC Authentication Request parameters/u);
});
