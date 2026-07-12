import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  lesson09AnswerKey,
  validateLesson09Submission,
} from '../../course/lessons/09/assessment.mjs';
import {
  lesson10AnswerKey,
  validateLesson10Submission,
} from '../../course/lessons/10/assessment.mjs';
import {
  lesson11AnswerKey,
  validateLesson11Submission,
} from '../../course/lessons/11/assessment.mjs';
import {
  lesson15AnswerKey,
  validateLesson15Submission,
} from '../../course/lessons/15/assessment.mjs';
import {
  capstoneAnswerKey,
  validateCapstoneSubmission,
} from '../../course/lessons/capstone/assessment.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lessonSpecs = new Map([
  ['09', { answerKey: lesson09AnswerKey, validate: validateLesson09Submission }],
  ['10', { answerKey: lesson10AnswerKey, validate: validateLesson10Submission }],
  ['11', { answerKey: lesson11AnswerKey, validate: validateLesson11Submission }],
  ['15', { answerKey: lesson15AnswerKey, validate: validateLesson15Submission }],
]);

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function todoPaths(value, path = '') {
  if (value === 'TODO') return [path];
  if (Array.isArray(value)) {
    if (value.length === 1 && value[0] === 'TODO') return [path];
    return value.flatMap((entry, index) => todoPaths(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => (
    todoPaths(child, path ? `${path}.${key}` : key)
  ));
}

function setPath(value, path, replacement) {
  const segments = path.match(/[^.[\]]+/gu);
  let cursor = value;
  for (const segment of segments.slice(0, -1)) cursor = cursor[Number.isNaN(Number(segment)) ? segment : Number(segment)];
  const last = segments.at(-1);
  cursor[Number.isNaN(Number(last)) ? last : Number(last)] = structuredClone(replacement);
}

test('learner choice artifacts cover every TODO path without publishing solutions', () => {
  const manifest = readJson('curriculum/manifest.json');
  const manifestById = new Map(manifest.lessons.map((lesson) => [lesson.id, lesson]));
  for (const id of [...lessonSpecs.keys(), 'capstone']) {
    const template = readJson(`course/lessons/${id}/workspace-template.json`);
    const artifactPath = `course/lessons/${id}/submission-choices.json`;
    const artifactText = read(artifactPath);
    const artifact = JSON.parse(artifactText);
    assert.equal(artifact.sourceOfTruth, 'assessment-validator-shared-choice-contract');
    assert.deepEqual(
      artifact.entries.map(({ path }) => path).sort(),
      todoPaths(template).sort(),
      `${id}: every TODO path must have learner-visible choices`,
    );
    for (const entry of artifact.entries) {
      assert.ok(entry.choices.length >= 2, `${id}:${entry.path}`);
      assert.equal(new Set(entry.choices.map(JSON.stringify)).size, entry.choices.length, `${id}:${entry.path}`);
      assert.equal(entry.choices.some((choice) => JSON.stringify(choice).includes('TODO')), false);
    }
    assert.match(artifact.instructions.join('\n'), /回答として作る配列内の順序/u);
    assert.doesNotMatch(artifact.instructions.join('\n'), /候補の順序に意味はありません/u);
    assert.doesNotMatch(artifactText, /answer.?key|correct.?answer|正答[:：]|正解[:：]/iu);
    assert.ok(read(`course/lessons/${id}/README.md`).includes('](submission-choices.json)'));
    assert.ok(manifestById.get(id).sourceFiles.includes(artifactPath));
  }
  execFileSync(process.execPath, ['scripts/sync-learner-choice-artifacts.mjs', '--check'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
});

test('published scalar and exact-array candidates are accepted by the same validators', () => {
  for (const [id, spec] of lessonSpecs) {
    const artifact = readJson(`course/lessons/${id}/submission-choices.json`);
    const template = readJson(`course/lessons/${id}/workspace-template.json`);
    assert.throws(() => spec.validate(template), /not allowed/u);
    for (const entry of artifact.entries) {
      for (const choice of entry.choices) {
        const submission = spec.answerKey();
        setPath(submission, entry.path, choice);
        assert.doesNotThrow(() => spec.validate(submission), `${id}:${entry.path}:${JSON.stringify(choice)}`);
      }
    }
  }
});

test('capstone choices cover nested arrays and both track-specific shapes', () => {
  const artifact = readJson('course/lessons/capstone/submission-choices.json');
  const template = readJson('course/lessons/capstone/workspace-template.json');
  assert.throws(() => validateCapstoneSubmission(template), /not allowed/u);
  assert.deepEqual(artifact.trackRules.map(({ track }) => track).sort(), ['developer', 'iam-operations']);
  for (const rule of artifact.trackRules) {
    const submission = capstoneAnswerKey(rule.track);
    const inactive = rule.inactivePath.match(/[^.[\]]+/gu).reduce((value, key) => value[key], submission);
    assert.equal(inactive, rule.inactiveValue);
    assert.equal(typeof rule.selectedPath.match(/[^.[\]]+/gu).reduce((value, key) => value[key], submission), 'object');
    assert.doesNotThrow(() => validateCapstoneSubmission(submission));
  }

  for (const entry of artifact.entries) {
    if (entry.path === 'track') {
      for (const choice of entry.choices) assert.doesNotThrow(() => validateCapstoneSubmission(capstoneAnswerKey(choice)));
      continue;
    }
    const track = entry.path.startsWith('artifacts.iamOperations') ? 'iam-operations' : 'developer';
    if (entry.kind === 'array-elements') {
      if (entry.path === 'common.priorityOrder') {
        const submission = capstoneAnswerKey(track);
        setPath(submission, entry.path, entry.choices);
        assert.doesNotThrow(() => validateCapstoneSubmission(submission));
      } else {
        for (const choice of entry.choices) {
          const submission = capstoneAnswerKey(track);
          const current = entry.path.match(/[^.[\]]+/gu).reduce((value, key) => value[key], submission);
          const replacement = [choice, ...current.filter((entryValue) => entryValue !== choice)]
            .slice(0, entry.exactLength);
          setPath(submission, entry.path, replacement);
          assert.doesNotThrow(() => validateCapstoneSubmission(submission), `${entry.path}:${choice}`);
        }
      }
      continue;
    }
    for (const choice of entry.choices) {
      const submission = capstoneAnswerKey(track);
      setPath(submission, entry.path, choice);
      assert.doesNotThrow(() => validateCapstoneSubmission(submission), `${entry.path}:${JSON.stringify(choice)}`);
    }
  }
});
