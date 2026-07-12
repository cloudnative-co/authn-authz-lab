import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const seriesRoot = resolve(repositoryRoot, '../ghost-writer-okash1n/articles/series/auth-authz');
const generator = resolve(repositoryRoot, '../ghost-writer-okash1n/scripts/generate-auth-authz-reading-assessments.mjs');

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

test('reading materials expose all 15 five-question assessments without claiming runtime skill', () => {
  const manifest = readJson('course/reading/manifest.json');
  const contract = readJson('curriculum/course-contract.json');
  const runtimeManifest = readJson('curriculum/manifest.json');
  const runtimeLessons = new Map(runtimeManifest.lessons.map((lesson) => [lesson.id, lesson]));
  const articleLessons = contract.lessons.filter(({ id }) => /^\d{2}$/.test(id));
  const index = read(manifest.index.path);

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.courseId, contract.courseId);
  assert.equal(manifest.releaseStatus, 'unreleased');
  assert.equal(manifest.sourceRevision, null);
  assert.deepEqual(manifest.lessons.map(({ id }) => id), articleLessons.map(({ id }) => id));
  assert.equal(sha256(index), manifest.index.sha256);
  assert.match(index, /4問以上/u);
  assert.match(index, /AA-CO3[^\n]*置き換えません/u);
  assert.ok(read('README.md').includes('](course/reading/README.md)'));

  for (const [position, lesson] of articleLessons.entries()) {
    const entry = manifest.lessons[position];
    assert.equal(entry.sourceAssessmentRef, lesson.readingAssessmentRef);
    assert.equal(entry.questionCount, 5);
    assert.equal(entry.passingScore, 4);
    const learnerReadme = read(entry.readme.path);
    const answerKey = read(entry.answerKey.path);
    assert.equal(sha256(learnerReadme), entry.readme.sha256);
    assert.equal(sha256(answerKey), entry.answerKey.sha256);
    assert.ok(runtimeLessons.get(lesson.id).sourceFiles.includes(entry.readme.path));
    assert.ok(runtimeLessons.get(lesson.id).sourceFiles.includes(entry.answerKey.path));
    assert.equal((learnerReadme.match(/^## 問[1-5]: AA\d{2}-Q[1-5]$/gmu) ?? []).length, 5);
    assert.equal((learnerReadme.match(/^- [ABC]\. /gmu) ?? []).length, 15);
    assert.match(learnerReadme, /4問以上/u);
    assert.match(learnerReadme, /実行技能[^\n]*認定しません/u);
    assert.match(learnerReadme, /\[解答と根拠\]\(answer-key\.md\)/u);
    assert.equal((answerKey.match(/^## AA\d{2}-Q[1-5]$/gmu) ?? []).length, 5);
    assert.match(answerKey, /先にREADME\.mdの5問/u);
    assert.ok(index.includes(`](lessons/${lesson.id}/README.md)`));
    const lessonGuide = read(`course/lessons/${lesson.id}/README.md`);
    assert.ok(lessonGuide.includes(`](../../reading/lessons/${lesson.id}/README.md)`));
  }
});

test('workspace reading distribution is synchronized with canonical episode artifacts', {
  skip: !existsSync(generator) || !existsSync(seriesRoot),
}, () => {
  const manifest = readJson('course/reading/manifest.json');
  for (const entry of manifest.lessons) {
    const [assessmentPath] = entry.sourceAssessmentRef.split('#');
    const sourceAssessment = readFileSync(resolve(seriesRoot, assessmentPath), 'utf8');
    const episodeDirectory = dirname(resolve(seriesRoot, assessmentPath));
    const sourceAnswerKey = readFileSync(resolve(episodeDirectory, 'reading-answer-key.md'), 'utf8');
    assert.equal(sha256(sourceAssessment), entry.sourceAssessmentSha256);
    assert.equal(sha256(sourceAnswerKey), entry.sourceAnswerKeySha256);
  }
  const generated = spawnSync(
    process.execPath,
    [generator, '--check', '--sample-root', repositoryRoot],
    { encoding: 'utf8' },
  );
  assert.equal(generated.status, 0, generated.stderr);
});
