import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('legacy metadata/AuthnRequest smoke is not the Lesson 09 achievement boundary', async () => {
  const manifest = JSON.parse(await readFile(new URL('../curriculum/manifest.json', import.meta.url), 'utf8'));
  const lesson = manifest.lessons.find(({ id }) => id === '09');
  assert.equal(lesson.status, 'experimental');
  assert.equal(lesson.sourceFiles.includes('test-integration/09-course-saml.test.js'), true);
  assert.equal(lesson.sourceFiles.includes('test-integration/09-saml.test.js'), false);
  assert.equal(lesson.sourceFiles.includes('docker/saml/user-agent/client.mjs'), true);
  assert.equal(lesson.sourceFiles.includes('packages/saml-strict/service-provider.mjs'), true);
});
