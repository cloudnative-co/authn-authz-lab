import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const schemaDirectory = resolve(repositoryRoot, 'curriculum/schemas');

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), 'utf8'));
}

function visitSchemaObjects(node, path, callback) {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node)) callback(node, path);
  for (const [key, value] of Object.entries(node)) visitSchemaObjects(value, `${path}.${key}`, callback);
}

test('runtime schemas are separate strict Draft 2020-12 documents', () => {
  const required = [
    'runner-result.schema.json',
    'state-marker.schema.json',
    'state.schema.json',
    'journal.schema.json',
    'evidence.schema.json',
    'manifest.schema.json',
  ];
  const available = new Set(readdirSync(schemaDirectory));
  for (const file of required) assert.ok(available.has(file), `missing ${file}`);

  for (const file of readdirSync(schemaDirectory).filter((name) => name.endsWith('.schema.json'))) {
    const schema = JSON.parse(readFileSync(resolve(schemaDirectory, file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', file);
    assert.equal(schema.type, 'object', file);
    assert.equal(schema.additionalProperties, false, file);
    visitSchemaObjects(schema, file, (candidate, path) => {
      if (candidate.type === 'object') {
        assert.equal(candidate.additionalProperties, false, `${path} must reject unknown properties`);
      }
    });
  }
});

test('manifest keeps the Node 24 baseline and supports Node 24 and 26', () => {
  const manifest = readJson('curriculum/manifest.json');
  const contract = readJson('curriculum/course-contract.json');
  assert.equal(manifest.runtime.node.baselineMajor, 24);
  assert.equal(manifest.runtime.node.versionRange, '>=24 <25 || >=26 <27');
  assert.equal(manifest.runtime.commands.course.grammar, 'node course.mjs doctor|setup|diagnose|stop|reset|purge');
  assert.equal(
    manifest.runtime.commands.lesson.grammar,
    'node course.mjs lesson <id> doctor|setup|demo|observe|check|diagnose|reset|stop|purge',
  );
  assert.deepEqual(
    manifest.lessons.map(({ id }) => id),
    contract.lessons.map(({ id }) => id),
  );
  assert.equal(manifest.implementationStatus, 'experimental');
  assert.equal(manifest.lessons.find(({ id }) => id === 'setup').status, 'candidate');
  assert.equal(manifest.lessons.find(({ id }) => id === '01').status, 'candidate');
  const contractByLesson = new Map(contract.lessons.map((lesson) => [lesson.id, lesson]));
  for (const lesson of manifest.lessons) {
    assert.deepEqual(
      lesson.supportedNodeMajors,
      ['06', '07', '08', '09'].includes(lesson.id) ? [24] : [24, 26],
      lesson.id,
    );
    const artifactStatuses = contractByLesson.get(lesson.id).assessments
      .map(({ artifactStatus }) => artifactStatus);
    if (artifactStatuses.every((status) => status === 'planned')) {
      assert.equal(lesson.status, 'planned', lesson.id);
    } else {
      assert.notEqual(lesson.status, 'planned', lesson.id);
    }
  }

  const projectAppPort = manifest.ports.find(({ id }) => id === 'project-app-http');
  const resourcesById = new Map(manifest.resources.map((resource) => [resource.id, resource]));
  assert.deepEqual(
    resourcesById.get('directory:lab-state').lessonIds,
    manifest.lessons
      .filter(({ resourceIds }) => resourceIds.includes('directory:lab-state'))
      .map(({ id }) => id),
  );
  assert.deepEqual(
    projectAppPort.lessonIds,
    manifest.lessons
      .filter(({ portIds }) => portIds.includes('project-app-http'))
      .map(({ id }) => id),
  );
  assert.deepEqual(
    resourcesById.get('project-app').lessonIds,
    manifest.lessons
      .filter(({ resourceIds }) => resourceIds.includes('project-app'))
      .map(({ id }) => id),
  );
  const courseLock = manifest.locks.find(({ id }) => id === 'lock:course');
  for (const [lessonId, workspaceId] of [
    ['02', 'data:lesson-02-workspace'],
    ['03', 'data:lesson-03-workspace'],
    ['04', 'data:lesson-04-workspace'],
    ['05', 'data:lesson-05-workspace'],
  ]) {
    const lesson = manifest.lessons.find(({ id }) => id === lessonId);
    assert.deepEqual(lesson.portIds, ['project-app-http']);
    assert.deepEqual(lesson.resourceIds, ['directory:lab-state', 'project-app', workspaceId]);
    assert.deepEqual(lesson.lockIds, ['lock:course']);
    assert.equal(resourcesById.get(workspaceId).locator, `.lab/submissions/${lessonId}`);
    assert.equal(courseLock.resourceIds.includes(workspaceId), true);
    for (const sourceFile of [
      `course/lessons/${lessonId}/README.md`,
      `course/lessons/${lessonId}/assessment.mjs`,
      `course/lessons/${lessonId}/runner.mjs`,
      `course/lessons/${lessonId}/scenario.mjs`,
      'course/lessons/registry.mjs',
      'course/runner/project-app-runtime.mjs',
      'course/runner/runtime-lesson.mjs',
      lessonId === '04'
        ? 'test/lesson-04/runner-e2e.test.js'
        : (lessonId === '05'
          ? 'test/lesson-05/runner-e2e.test.js'
          : 'test/lesson-02-03-runner-e2e.test.js'),
    ]) assert.equal(lesson.sourceFiles.includes(sourceFile), true, `${lessonId} misses ${sourceFile}`);
  }
  const lesson08 = manifest.lessons.find(({ id }) => id === '08');
  assert.deepEqual(lesson08.portIds, []);
  assert.deepEqual(
    lesson08.resourceIds,
    ['directory:lab-state', 'identity-platform-lab', 'data:lesson-08-workspace'],
  );
  assert.deepEqual(resourcesById.get('identity-platform-lab').lessonIds, ['08']);
  assert.equal(resourcesById.get('data:lesson-08-workspace').locator, '.lab/submissions/08');
  assert.equal(courseLock.resourceIds.includes('identity-platform-lab'), true);
  assert.equal(courseLock.resourceIds.includes('data:lesson-08-workspace'), true);
  assert.equal(lesson08.sourceFiles.includes('docker/samba-ad/compose.yml'), true);
  assert.equal(lesson08.sourceFiles.includes('test/lesson-08/assessment.test.js'), true);
  const lesson09 = manifest.lessons.find(({ id }) => id === '09');
  assert.deepEqual(lesson09.portIds, []);
  assert.deepEqual(
    lesson09.resourceIds,
    ['directory:lab-state', 'saml-lab', 'data:lesson-09-workspace'],
  );
  assert.deepEqual(resourcesById.get('saml-lab').lessonIds, ['09']);
  assert.equal(resourcesById.get('data:lesson-09-workspace').locator, '.lab/submissions/09');
  assert.equal(courseLock.resourceIds.includes('saml-lab'), true);
  assert.equal(courseLock.resourceIds.includes('data:lesson-09-workspace'), true);
  assert.equal(lesson09.sourceFiles.includes('docker/saml/compose.yml'), true);
  assert.equal(lesson09.sourceFiles.includes('test-integration/09-course-saml.test.js'), true);
  const oauthPortIds = [
    'oauth-authorization-server-http', 'oauth-client-http', 'oauth-resource-api-http',
  ];
  assert.deepEqual(oauthPortIds.map((id) => manifest.ports.find((port) => port.id === id).port), [4100, 4101, 4102]);
  assert.deepEqual(resourcesById.get('oauth-lab').lessonIds, ['10', '11', '15']);
  for (const lessonId of ['10', '11', '15']) {
    const workspaceId = `data:lesson-${lessonId}-workspace`;
    const lesson = manifest.lessons.find(({ id }) => id === lessonId);
    assert.deepEqual(lesson.portIds, oauthPortIds);
    assert.deepEqual(lesson.resourceIds, ['directory:lab-state', 'oauth-lab', workspaceId]);
    assert.deepEqual(lesson.lockIds, ['lock:course']);
    assert.equal(resourcesById.get(workspaceId).locator, `.lab/submissions/${lessonId}`);
    assert.equal(courseLock.resourceIds.includes(workspaceId), true);
    const runnerTest = lessonId === '15'
      ? 'test/lesson-15/runner-e2e.test.js'
      : 'test/lesson-10-11/runner-e2e.test.js';
    assert.equal(lesson.sourceFiles.includes(runnerTest), true);
  }
  assert.match(manifest.lessons.find(({ id }) => id === '02').statusNote, /fresh-scenario/);
  assert.match(manifest.lessons.find(({ id }) => id === '03').statusNote, /browser/);
  assert.match(manifest.lessons.find(({ id }) => id === '03').statusNote, /未完了/);

  const lessonIds = new Set(manifest.lessons.map(({ id }) => id));
  const portIds = new Set(manifest.ports.map(({ id }) => id));
  const resourceIds = new Set(manifest.resources.map(({ id }) => id));
  const lockIds = new Set(manifest.locks.map(({ id }) => id));
  for (const port of manifest.ports) {
    assert.ok(resourceIds.has(port.resourceId));
    for (const lessonId of port.lessonIds) assert.ok(lessonIds.has(lessonId));
  }
  for (const resource of manifest.resources) {
    for (const lessonId of resource.lessonIds) assert.ok(lessonIds.has(lessonId));
  }
  for (const lock of manifest.locks) {
    for (const resourceId of lock.resourceIds) assert.ok(resourceIds.has(resourceId));
  }
  for (const lesson of manifest.lessons) {
    for (const portId of lesson.portIds) assert.ok(portIds.has(portId));
    for (const resourceId of lesson.resourceIds) assert.ok(resourceIds.has(resourceId));
    for (const lockId of lesson.lockIds) assert.ok(lockIds.has(lockId));
    for (const sourceFile of lesson.sourceFiles) {
      assert.equal(sourceFile.startsWith('/'), false, `${lesson.id}: sourceFiles must be relative`);
      assert.equal(sourceFile.includes('..'), false, `${lesson.id}: sourceFiles cannot escape the repository`);
      assert.ok(existsSync(resolve(repositoryRoot, sourceFile)), `${lesson.id}: missing ${sourceFile}`);
    }
  }
  const lesson04 = manifest.lessons.find(({ id }) => id === '04');
  assert.match(lesson04.statusNote, /project-core/);
  assert.match(lesson04.statusNote, /fresh-scenario/);
  assert.match(lesson04.statusNote, /未完了/);
});

test('support profiles distinguish candidate WSL2 from experimental native Windows', () => {
  const matrix = readJson('curriculum/support-matrix.json');
  const manifest = readJson('curriculum/manifest.json');
  assert.equal(matrix.$schema, './schemas/support-matrix.schema.json');
  const profiles = new Map(matrix.profiles.map((profile) => [profile.id, profile]));
  assert.equal(profiles.get('wsl2-x64-node24').status, 'candidate');
  assert.equal(profiles.get('wsl2-x64-node24').os, 'wsl2-linux-filesystem');
  assert.equal(profiles.get('windows-x64-node24').status, 'experimental');
  for (const profile of profiles.values()) {
    assert.equal(profile.verifiedRevision, null);
    assert.equal(profile.lastVerifiedAt, null);
    assert.equal(profile.humanPilot, false);
  }
  for (const lesson of matrix.lessons) {
    for (const profileId of lesson.profileIds) assert.ok(profiles.has(profileId));
    if (lesson.status === 'planned') assert.deepEqual(lesson.profileIds, []);
  }
  assert.deepEqual(matrix.lessons.map(({ id }) => id), [
    ...manifest.lessons.map(({ id }) => id),
  ]);
});

test('deviation register records protocol boundaries and credential guardrails', () => {
  const deviations = readFileSync(resolve(repositoryRoot, 'curriculum/deviations.yaml'), 'utf8');
  for (const id of [
    'DEV-LOOPBACK-HTTP',
    'DEV-PER-RUN-CREDENTIAL',
    'DEV-COURSE-CONTROLS',
  ]) {
    assert.match(deviations, new RegExp(`id: ${id}`));
  }
  for (const guardrail of ['256-bit', 'resetごと', 'cross-purpose', '定時間比較']) {
    assert.match(deviations, new RegExp(guardrail));
  }
});

test('every Node 24 support profile and lesson assignment has a Node 26 counterpart', () => {
  const matrix = readJson('curriculum/support-matrix.json');
  const profiles = new Map(matrix.profiles.map((profile) => [profile.id, profile]));
  for (const profile of matrix.profiles.filter(({ nodeMajor: major }) => major === 24)) {
    const counterpart = profiles.get(profile.id.replace('node24', 'node26'));
    assert.ok(counterpart, profile.id);
    assert.equal(counterpart.nodeMajor, 26);
    assert.equal(counterpart.os, profile.os);
    assert.equal(counterpart.architecture, profile.architecture);
    assert.equal(counterpart.containerEngine, profile.containerEngine);
  }
  for (const lesson of matrix.lessons) {
    const assignments = new Set(lesson.profileIds);
    for (const profileId of lesson.profileIds.filter((id) => id.includes('node24'))) {
      if (['06', '07', '08', '09'].includes(lesson.id)) {
        assert.equal(assignments.has(profileId.replace('node24', 'node26')), false, `${lesson.id}:${profileId}`);
      } else {
        assert.ok(assignments.has(profileId.replace('node24', 'node26')), `${lesson.id}:${profileId}`);
      }
    }
  }
});

test('README documents safe Node major switching and rollback before old runners see v2 state', () => {
  const readme = readFileSync(resolve(repositoryRoot, 'README.md'), 'utf8');
  assert.match(readme, /checkout前に`purge`/u);
  assert.match(readme, /Node\.js 26対応を含むrevisionを一時的にcheckoutして`purge`/u);
  assert.match(readme, /元の対応majorへ戻して`purge`/u);
});
