import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

test('README is a complete entry point for every executable Lesson', () => {
  const readme = read('README.md');
  const contract = readJson('curriculum/course-contract.json');
  const executableLessons = contract.lessons.filter(({ id, assessments }) => (
    id !== 'setup' && assessments.every(({ artifactStatus }) => artifactStatus === 'implemented')
  ));

  for (const lesson of executableLessons) {
    const heading = lesson.id === 'capstone' ? '### Capstone' : `### Lesson ${lesson.id}`;
    assert.match(readme, new RegExp(`^${heading}$`, 'mu'), lesson.id);
    const guide = `course/lessons/${lesson.id}/README.md`;
    assert.equal(existsSync(resolve(repositoryRoot, guide)), true, guide);
    assert.ok(readme.includes(`](${guide})`), `README does not link ${guide}`);
  }
});

test('README links the common setup, recovery, and instructor paths', () => {
  const readme = read('README.md');
  for (const path of [
    'course/lessons/setup/README.md',
    'docs/troubleshooting.md',
    'docs/instructor-guide.md',
    'docs/pilot-observation-template.md',
  ]) {
    assert.equal(existsSync(resolve(repositoryRoot, path)), true, path);
    assert.ok(readme.includes(`](${path})`), `README does not link ${path}`);
  }
  for (const command of [
    'node course.mjs doctor',
    'node course.mjs setup',
    'node course.mjs diagnose',
    'node course.mjs purge --yes --json',
  ]) assert.ok(readme.includes(command), command);
  assert.match(readme, /Node\.js 24\.x/u);
  assert.match(readme, /Docker Desktop|Docker Engine/u);
  assert.match(readme, /Playwright/u);

  const pilotTemplate = read('docs/pilot-observation-template.md');
  assert.match(pilotTemplate, /完全commit SHA/u);
  assert.match(pilotTemplate, /自力復帰までの時間/u);
  assert.match(pilotTemplate, /diagnostics\[\].*resources\.remaining.*actual/u);
  assert.match(pilotTemplate, /初学者3名以上/u);
  assert.match(pilotTemplate, /OS 2種類以上/u);
});

test('learner guides preserve predict-before-demo and expose required check IDs', () => {
  const readme = read('README.md');
  const contract = readJson('curriculum/course-contract.json');
  assert.match(readme, /記事内の予測、lab lifecycle、required checkを一度だけ/u);
  assert.doesNotMatch(readme, /node course\.mjs lesson 01 demo/u);
  assert.match(readme, /course\/lessons\/<id>\/answer-key\.md/u);

  for (const lesson of contract.lessons.filter(({ id }) => id !== 'setup')) {
    const guide = read(`course/lessons/${lesson.id}/README.md`);
    const predictAt = guide.indexOf('予測');
    const demoAt = guide.indexOf(`node course.mjs lesson ${lesson.id} demo`);
    assert.ok(predictAt >= 0, `${lesson.id} has no prediction step`);
    assert.ok(demoAt >= 0, `${lesson.id} has no demo command`);
    assert.ok(predictAt < demoAt, `${lesson.id} runs demo before prediction`);
    for (const { id: checkId } of lesson.requiredChecks) {
      assert.ok(guide.includes(checkId), `${lesson.id} does not map ${checkId}`);
    }
  }

  const setupGuide = read('course/lessons/setup/README.md');
  assert.ok(setupGuide.indexOf('stateの変化を予測する') < setupGuide.indexOf('node course.mjs doctor'));
});

test('instructor pacing matches the course contract', () => {
  const contract = readJson('curriculum/course-contract.json');
  for (const lesson of contract.lessons) {
    const guide = read(`course/lessons/${lesson.id}/instructor-guide.md`);
    const endMinutes = [...guide.matchAll(/\|\s*\d+\s*[〜–-]\s*(\d+)分/gu)]
      .map((match) => Number(match[1]));
    assert.notEqual(endMinutes.length, 0, `${lesson.id} has no complete pacing table`);
    assert.equal(Math.max(...endMinutes), lesson.estimatedMinutes, `${lesson.id} pacing mismatch`);
  }
});

test('lesson-form purge is disclosed as irreversible and course-wide', () => {
  const contract = readJson('curriculum/course-contract.json');
  for (const lesson of contract.lessons.filter(({ id }) => id !== 'setup')) {
    const guide = read(`course/lessons/${lesson.id}/README.md`);
    if (!guide.includes(`node course.mjs lesson ${lesson.id} purge`)) continue;
    assert.match(guide, /course-wide|course全体/u, `${lesson.id} does not disclose purge scope`);
    assert.match(guide, /取り消せ/u, `${lesson.id} does not disclose purge irreversibility`);
  }
});

test('optional extensions are discoverable and excluded from standard time', () => {
  const readme = read('README.md');
  const instructorGuide = read('docs/instructor-guide.md');
  const contract = readJson('curriculum/course-contract.json');
  const manifest = readJson('curriculum/manifest.json');
  const manifestById = new Map(manifest.lessons.map((lesson) => [lesson.id, lesson]));
  const extensions = contract.lessons.filter(({ extensionMinutes }) => extensionMinutes > 0);
  assert.equal(extensions.reduce((sum, lesson) => sum + lesson.extensionMinutes, 0), 765);
  assert.match(readme, /標準実習[^\n]*1240分/u);
  assert.match(readme, /発展課題[^\n]*765分/u);
  assert.match(instructorGuide, /765分/u);
  assert.match(instructorGuide, /発展課題/u);

  for (const lesson of extensions) {
    const guide = read(`course/lessons/${lesson.id}/README.md`);
    assert.ok(guide.includes('extension.yaml'), `${lesson.id} does not link its extension`);
    assert.ok(guide.includes(`${lesson.extensionMinutes}分発展課題`), `${lesson.id} extension time is hidden`);
    assert.match(guide, /標準実習1240分に含めません/u, `${lesson.id} mixes extension into standard time`);
    assert.ok(
      manifestById.get(lesson.id).sourceFiles.includes(lesson.extensionTaskRef),
      `${lesson.id} extension is absent from manifest sourceFiles`,
    );
    assert.equal(
      existsSync(resolve(repositoryRoot, `course/lessons/${lesson.id}/extension.md`)),
      false,
      `${lesson.id} has a second extension source that can drift`,
    );
  }
});
