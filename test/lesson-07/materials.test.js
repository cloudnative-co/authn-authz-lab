import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  LESSON_07_RESOURCE_ID,
  LESSON_07_SERVICES,
  lesson07ManagedComposeSpec,
} from '../../course/lessons/07/lab-contract.mjs';

async function lessonFile(name) {
  return readFile(new URL(`../../course/lessons/07/${name}`, import.meta.url), 'utf8');
}

test('materials provide the complete beginner workflow without manual Compose commands', async () => {
  const [readme, answerKey, instructorGuide, technicalDesign] = await Promise.all([
    lessonFile('README.md'),
    lessonFile('answer-key.md'),
    lessonFile('instructor-guide.md'),
    lessonFile('technical-design.md'),
  ]);
  for (const action of ['doctor', 'setup', 'demo', 'observe', 'check', 'diagnose', 'reset', 'stop']) {
    assert.match(readme, new RegExp(`node course\\.mjs lesson 07 ${action}`, 'u'));
  }
  assert.doesNotMatch(readme, /\n\s*docker compose\b/u);
  assert.match(readme, /予測/u);
  assert.match(readme, /実務へ移す/u);
  assert.match(readme, /5件中4件以上/u);
  assert.match(answerKey, /contextComplete=false/u);
  assert.match(instructorGuide, /一般的multi-leg SPNEGOを実装したと説明しない/u);
  assert.match(technicalDesign, /continuation context storeは実装しない/u);
});

test('managed Compose contract is container-only, host-port-free, and owns its resources', () => {
  const spec = lesson07ManagedComposeSpec({
    secretDirectory: '/absolute/repository/.lab/containers/kerberos-lab',
    repoRoot: '/absolute/repository',
  });
  assert.equal(spec.resourceId, LESSON_07_RESOURCE_ID);
  assert.deepEqual(LESSON_07_SERVICES, ['app', 'client', 'kdc']);
  assert.deepEqual(spec.buildServices, ['kdc', 'app', 'client']);
  assert.deepEqual(spec.targetServices, ['client']);
  assert.deepEqual(spec.expectedServices, ['app', 'client', 'kdc']);
  assert.deepEqual(spec.expectedNetworks, ['default']);
  assert.deepEqual(spec.expectedVolumes, ['lesson07_keytabs']);
  assert.deepEqual(spec.publishedPorts, []);
  assert.equal(spec.noDependencies, false);
  assert.deepEqual(spec.supplementalFiles, ['alice-password', 'kdc-master-password']);
  assert.throws(
    () => lesson07ManagedComposeSpec({ secretDirectory: 'relative', repoRoot: '/absolute/repository' }),
    /absolute/u,
  );
  assert.throws(
    () => lesson07ManagedComposeSpec({
      secretDirectory: '/absolute/other/kerberos-lab', repoRoot: '/absolute/repository',
    }),
    /inside repoRoot/u,
  );
});

test('Lesson 07 manifest excludes the shared project-app and its fixed port 3000', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../../curriculum/manifest.json', import.meta.url),
    'utf8',
  ));
  const lesson = manifest.lessons.find(({ id }) => id === '07');
  const projectPort = manifest.ports.find(({ id }) => id === 'project-app-http');
  assert.equal(projectPort.port, 3000);
  assert.deepEqual(lesson.portIds, []);
  assert.equal(lesson.resourceIds.includes('project-app'), false);
  assert.equal(projectPort.lessonIds.includes('07'), false);
});

test('assessment status follows runner availability and names real protocol artifacts after integration', async () => {
  const assessment = JSON.parse(await lessonFile('assessment.yaml'));
  const runnerImplemented = await access(
    new URL('../../course/lessons/07/runner.mjs', import.meta.url),
  ).then(() => true, () => false);
  assert.equal(assessment.assessment.artifactStatus, runnerImplemented ? 'implemented' : 'planned');
  if (!runnerImplemented) {
    assert.match(assessment.assessment.implementationNote, /未実装/u);
    return;
  }
  assert.deepEqual(
    assessment.assessment.requiredChecks.map(({ id }) => id),
    ['AA07-C1', 'AA07-C2'],
  );
  assert.match(assessment.assessment.evidence, /MIT Kerberos V5/u);
  assert.match(assessment.assessment.passCriteria, /5件中4件以上/u);
});

test('native Kerberos dependency is isolated in the dedicated app image', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../../docker/kerberos/app/package.json', import.meta.url),
    'utf8',
  ));
  const lockfile = JSON.parse(await readFile(
    new URL('../../docker/kerberos/app/package-lock.json', import.meta.url),
    'utf8',
  ));
  assert.equal(manifest.private, true);
  assert.equal(manifest.engines.node, '>=24 <25');
  assert.deepEqual(manifest.dependencies, { kerberos: '7.0.0' });
  assert.equal(lockfile.packages[''].dependencies.kerberos, '7.0.0');
  assert.ok(lockfile.packages['node_modules/kerberos']);
});
