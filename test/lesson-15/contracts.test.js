import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { getLessonImplementation } from '../../course/lessons/registry.mjs';
import {
  lesson15AnswerKey,
  validateLesson15Submission,
} from '../../course/lessons/15/assessment.mjs';
import { lesson15Adapter } from '../../course/lessons/15/runner.mjs';

test('Lesson 15 answer schema rejects TODO, unknown fields, and unknown values', async () => {
  const template = JSON.parse(await readFile(
    new URL('../../course/lessons/15/workspace-template.json', import.meta.url), 'utf8',
  ));
  assert.throws(() => validateLesson15Submission(template), /not allowed/u);
  assert.throws(() => validateLesson15Submission({ ...lesson15AnswerKey(), extra: true }), /unknown fields/u);
  const invalid = lesson15AnswerKey();
  invalid.answers['AA15-C1'].validation = 'unknown';
  assert.throws(() => validateLesson15Submission(invalid), /not allowed/u);
  assert.deepEqual(validateLesson15Submission(lesson15AnswerKey()), lesson15AnswerKey());
});

test('Lesson 15 is registered behind the shared managed OAuth runtime', () => {
  assert.equal(lesson15Adapter.id, '15');
  assert.deepEqual(lesson15Adapter.checkIds, ['AA15-C1', 'AA15-C2', 'AA15-C3']);
  assert.equal(lesson15Adapter.runtimeKind, 'standalone-three-origin-http-jwt-api-authorization-lab');
  assert.deepEqual(lesson15Adapter.fixedOrigins, [
    'http://127.0.0.1:4100', 'http://127.0.0.1:4101', 'http://127.0.0.1:4102',
  ]);
  assert.equal(lesson15Adapter.requiresProjectApp, false);
  assert.deepEqual(lesson15Adapter.externalResourceIds, ['oauth-lab']);
  assert.deepEqual(getLessonImplementation('15').implementedCheckIds, ['AA15-C1', 'AA15-C2', 'AA15-C3']);
});

test('Lesson 15 materials teach the specification boundary, fault boundary, recovery, and production limits', async () => {
  const files = await Promise.all([
    'README.md', 'technical-design.md', 'answer-key.md', 'instructor-guide.md', 'extension.yaml',
  ].map((name) => readFile(new URL(`../../course/lessons/15/${name}`, import.meta.url), 'utf8')));
  const combined = files.join('\n');
  for (const marker of [
    'RFC 8707', 'RFC 9068', 'RFC 6750', 'at\\+jwt', 'RS256', 'JWKS', 'project-core',
    'cross-tenant', 'opaque', 'fresh scenario', 'HTTPS', '予測', '実務',
  ]) assert.match(combined, new RegExp(marker, 'u'), marker);
  const client = await readFile(new URL('../../apps/oauth-lab/client-server.mjs', import.meta.url), 'utf8');
  const callback = client.slice(client.indexOf('async function apiCallback'), client.indexOf('const server = createServer'));
  assert.doesNotMatch(callback, /jwtVerify|decodeProtectedHeader|decodeJwtPart/u);
  assert.match(callback, /access_token/u);
  assert.match(callback, /deleteProject/u);
});
