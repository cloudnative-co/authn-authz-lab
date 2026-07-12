import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function text(path) {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

test('README indexes one canonical lesson 01 guide and manifest/package expose the same candidate flow', async () => {
  const [readme, learnerGuide, manifest, packageJson] = await Promise.all([
    text('README.md'),
    text('course/lessons/01/README.md'),
    text('curriculum/manifest.json').then(JSON.parse),
    text('package.json').then(JSON.parse),
  ]);
  const lesson = manifest.lessons.find(({ id }) => id === '01');
  assert.equal(lesson.status, 'candidate');
  assert.deepEqual(lesson.portIds, ['project-app-http']);
  assert.ok(lesson.resourceIds.includes('project-app'));
  assert.equal(packageJson.scripts.start, 'node course.mjs lesson 01 setup');
  assert.match(readme, /\[Lesson 01受講者ガイド\]\(course\/lessons\/01\/README\.md\)/u);
  for (const command of [
    'node course.mjs lesson 01 doctor',
    'node course.mjs lesson 01 setup',
    'node course.mjs lesson 01 demo',
    'node course.mjs lesson 01 observe',
    'node course.mjs lesson 01 check',
    'node course.mjs lesson 01 stop',
  ]) assert.match(learnerGuide, new RegExp(command.replaceAll('.', '\\.')));
  assert.doesNotMatch(readme, /node course\.mjs lesson 01 (?:doctor|setup|demo|observe|check|stop)/u);
  assert.match(readme, /provided case/);
  assert.match(readme, /runtime evidenceではありません/);
  assert.doesNotMatch(readme, /第01回以降.*利用できません/);
});

test('learner and instructor materials preserve the provided-case evidence boundary', async () => {
  const paths = [
    'course/lessons/01/README.md',
    'course/lessons/01/answer-key.md',
    'course/lessons/01/instructor-guide.md',
  ];
  for (const path of paths) {
    const source = await text(path);
    assert.match(source, /provided case|用意(?:した|された)(?:有限の)?事例/);
    assert.match(source, /実プロトコル.*(?:証拠|認定)|実行時に採取したプロトコル証跡ではありません|runtime evidenceと区別/);
  }
  const learner = await text(paths[0]);
  for (const section of ['予測する', '課題を準備する', '採点する', '予測を見直す', '困ったとき']) {
    assert.match(learner, new RegExp(section));
  }
  const instructor = await text(paths[2]);
  for (const requirement of ['時間配分', '採点rubric', '復旧手順', '15分以内']) {
    assert.match(instructor, new RegExp(requirement));
  }
});
