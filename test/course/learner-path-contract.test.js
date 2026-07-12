import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { runCourseLifecycle } from '../../course/runner/lifecycle.mjs';
import { withLessonPurgeScope } from '../../course/runner/main.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoots = [];

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function read(relativePath) {
  return readFile(resolve(repositoryRoot, relativePath), 'utf8');
}

async function readJson(relativePath) {
  return JSON.parse(await read(relativePath));
}

test('curriculum derives non-overlapping complete, reading, and lab time from four activities', async () => {
  const source = await readJson('curriculum/course-source.snapshot.json');
  const { complete, reading, lab } = source.learningPaths;
  assert.equal(complete.recommended, true);
  assert.equal(complete.estimatedMinutes, 1935);
  assert.equal(reading.estimatedMinutes, 695);
  assert.equal(lab.estimatedMinutes, 1240);
  assert.equal(complete.estimatedMinutes, reading.estimatedMinutes + lab.estimatedMinutes);
  const articleLessons = source.lessons.filter(({ kind }) => kind === 'article-lesson');
  const nonArticleLessons = source.lessons.filter(({ kind }) => kind !== 'article-lesson');
  const activityTotal = (lesson) => ['reading', 'readingAssessment', 'lab', 'assessment']
    .reduce((sum, field) => sum + lesson.timeAllocationMinutes[field], 0);
  for (const lesson of source.lessons) {
    assert.deepEqual(
      Object.keys(lesson.timeAllocationMinutes).sort(),
      ['assessment', 'lab', 'reading', 'readingAssessment', 'sessions'].sort(),
      `${lesson.id}: time activities must be explicit`,
    );
    assert.equal(lesson.estimatedMinutes, activityTotal(lesson), `${lesson.id}: activity sum`);
  }
  assert.equal(source.lessons.reduce((sum, lesson) => sum + activityTotal(lesson), 0), 1935);
  assert.equal(articleLessons.reduce((sum, lesson) => (
    sum + lesson.timeAllocationMinutes.reading + lesson.timeAllocationMinutes.readingAssessment
  ), 0), 695);
  assert.equal(nonArticleLessons.reduce((sum, lesson) => sum + activityTotal(lesson), 0)
    + articleLessons.reduce((sum, lesson) => (
      sum + lesson.timeAllocationMinutes.lab + lesson.timeAllocationMinutes.assessment
    ), 0), 1240);
  assert.deepEqual(complete.requiredLessonIds, lab.requiredLessonIds);
  assert.match(complete.sequencePolicy, /準備ラボ.*再setup.*記事.*予測.*lab lifecycle.*required check.*一度だけ.*読解5問.*4問以上.*capstone/u);
  assert.match(lab.completionPolicy, /submission\.json/u);
  assert.match(lab.completionPolicy, /読解5問とは別/u);

  for (const path of ['README.md', 'docs/instructor-guide.md']) {
    const guide = await read(path);
    assert.match(guide, /完全コース（推奨）/u, path);
    assert.match(guide, /1935分/u, path);
    assert.match(guide, /695分/u, path);
    assert.match(guide, /1240分/u, path);
    assert.match(guide, /準備ラボ/u, path);
    assert.match(guide, /4問以上/u, path);
  }
  const rootReadme = await read('README.md');
  assert.doesNotMatch(rootReadme, /準備ラボ自体を採点する場合|通常は、このまま受講するlesson/u);
  assert.match(rootReadme, /60分.*AA-SETUP-C1.*AA-SETUP-C3.*省略できません/u);
  assert.match(rootReadme, /完全commit SHAまたはrelease tag/u);
});

test('every lesson guide distinguishes complete, reading-only, and lab-only without rerunning', async () => {
  for (let number = 1; number <= 15; number += 1) {
    const id = String(number).padStart(2, '0');
    const guide = await read(`course/lessons/${id}/README.md`);
    const predictionAt = guide.indexOf('予測');
    const setupAt = guide.indexOf(`node course.mjs lesson ${id} setup`);
    const checkAt = guide.indexOf(`node course.mjs lesson ${id} check`);
    assert.ok(predictionAt < setupAt, `${id}: prediction must precede lesson setup`);
    assert.ok(setupAt < checkAt, `${id}: setup must precede check`);
    assert.ok(guide.includes(`../../reading/lessons/${id}/README.md`), `${id}: reading check link`);
    assert.match(guide, /完全コース（1935分）/u, id);
    assert.match(guide, /4問以上/u, id);
    assert.match(guide, /記事を読み終えた後/u, id);
    assert.match(guide, /同じcommandを二重実行しません/u, id);
    assert.match(guide, /実習のみ（1240分）/u, id);
  }
});

test('fresh-clone setup path never nests the repository and restores course state after purge', async () => {
  const rootReadme = await read('README.md');
  const setupGuide = await read('course/lessons/setup/README.md');
  assert.match(rootReadme, /repository取得と`npm ci`は.*完了.*cloneし直しません/u);
  assert.match(setupGuide, /同じrepositoryの内側へcloneし直さず/u);
  const transition = setupGuide.slice(setupGuide.indexOf('## 8. Lesson開始用のstateを作り直す'));
  assert.match(transition, /resources\.remaining.*"0".*node course\.mjs setup.*node course\.mjs diagnose/su);
  assert.match(transition, /準備ラボは完了/u);
});

test('Lesson 15 requires completion of Lessons 04, 10, and 11', async () => {
  const source = await readJson('curriculum/course-source.snapshot.json');
  assert.deepEqual(source.lessons.find(({ id }) => id === '15').learningPrerequisites, ['04', '10', '11']);
  for (const path of ['README.md', 'course/lessons/15/README.md', 'course/lessons/15/instructor-guide.md']) {
    const guide = await read(path);
    assert.match(guide, /04.*10.*11/u, path);
    assert.match(guide, /必須前提/u, path);
    assert.match(guide, /required check/u, path);
  }
});

test('Lesson 06 does not reveal the empty-password prediction before observation', async () => {
  const guide = await read('course/lessons/06/README.md');
  const beforeDemo = guide.slice(0, guide.indexOf('node course.mjs lesson 06 demo'));
  assert.match(beforeDemo, /空password.*4択/u);
  assert.doesNotMatch(beforeDemo, /1より前に止まる|networkへ送らず|LDAP connectionへ到達しない|reject-before-network/u);
  assert.match(guide.slice(guide.indexOf('node course.mjs lesson 06 observe')), /emptyだけはLDAP connectionへ到達しない/u);
});

test('purge documentation matches the actual diagnostics array paths', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-purge-contract-'));
  temporaryRoots.push(root);
  const courseResult = await runCourseLifecycle({
    action: 'purge',
    repoRoot: root,
    runId: 'purge-contract-test',
  });
  const lessonResult = withLessonPurgeScope(courseResult);
  assert.equal(
    lessonResult.diagnostics.find(({ id }) => id === 'resources.remaining')?.actual,
    '0',
  );
  assert.equal(
    lessonResult.diagnostics.find(({ id }) => id === 'lesson.purge-scope')?.actual,
    'course-wide',
  );

  const markdownPaths = ['README.md', 'docs/instructor-guide.md', 'docs/pilot-observation-template.md'];
  for (const directory of ['05', '09', '12', '13', '14', 'capstone', 'setup']) {
    for (const name of await readdir(resolve(repositoryRoot, `course/lessons/${directory}`))) {
      if (name.endsWith('.md')) markdownPaths.push(`course/lessons/${directory}/${name}`);
    }
  }
  for (const path of markdownPaths) {
    const content = await read(path);
    assert.doesNotMatch(content, /resources\.remaining\.actual|`resources\.remaining`が`0`|`lesson\.purge-scope`が`course-wide`|resource remaining/u, path);
    if (content.includes('resources.remaining')) assert.match(content, /diagnostics\[\].*id: "resources\.remaining".*actual/u, path);
    if (content.includes('lesson.purge-scope')) assert.match(content, /diagnostics\[\].*id: "lesson\.purge-scope".*actual: "course-wide"/u, path);
  }
  const setupAssessment = await read('course/lessons/setup/assessment.yaml');
  assert.match(setupAssessment, /diagnostics\[\].*resources\.remaining.*actual.*文字列\\?"0\\?"/u);
});
