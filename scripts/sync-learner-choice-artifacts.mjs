#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lesson09LearnerChoices } from '../course/lessons/09/assessment.mjs';
import { lesson10LearnerChoices } from '../course/lessons/10/assessment.mjs';
import { lesson11LearnerChoices } from '../course/lessons/11/assessment.mjs';
import { lesson15LearnerChoices } from '../course/lessons/15/assessment.mjs';
import { capstoneLearnerChoices } from '../course/lessons/capstone/assessment.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lessonSpecs = [
  { id: '09', scalarByField: lesson09LearnerChoices() },
  { id: '10', scalarByField: lesson10LearnerChoices() },
  { id: '11', scalarByField: lesson11LearnerChoices() },
  { id: '15', scalarByField: lesson15LearnerChoices() },
  { id: 'capstone', ...capstoneLearnerChoices() },
];

function fail(message) {
  throw new Error(message);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortChoices(values) {
  if (!Array.isArray(values) || values.length < 2) fail('each learner choice requires at least two candidates');
  const cloned = structuredClone(values);
  cloned.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));
  if (new Set(cloned.map((value) => JSON.stringify(value))).size !== cloned.length) {
    fail('learner choices must be unique');
  }
  return cloned;
}

function fieldName(path) {
  return path.replace(/\[\d+\]$/u, '').split('.').at(-1);
}

function todoPaths(value, path = '') {
  if (value === 'TODO') return [{ path, kind: 'scalar' }];
  if (Array.isArray(value)) {
    if (value.length === 1 && value[0] === 'TODO') return [{ path, kind: 'array' }];
    return value.flatMap((entry, index) => todoPaths(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => (
    todoPaths(child, path ? `${path}.${key}` : key)
  ));
}

function buildArtifact(spec) {
  const templatePath = resolve(repositoryRoot, `course/lessons/${spec.id}/workspace-template.json`);
  const template = JSON.parse(readFileSync(templatePath, 'utf8'));
  const entries = todoPaths(template).map(({ path, kind }) => {
    if (kind === 'scalar') {
      const choices = spec.scalarChoicesByPath?.[path] ?? spec.scalarByField?.[fieldName(path)];
      if (!choices) fail(`${spec.id}: no validator choices for ${path}`);
      return { path, kind: 'scalar', choices: sortChoices(choices) };
    }
    const exactChoices = spec.exactArrayChoicesByPath?.[path];
    if (exactChoices) {
      return { path, kind: 'exact-array', choices: sortChoices(exactChoices) };
    }
    const elementChoices = spec.elementChoicesByPath?.[path];
    if (!elementChoices) fail(`${spec.id}: no validator array choices for ${path}`);
    return {
      path,
      kind: 'array-elements',
      choices: sortChoices(elementChoices.choices),
      exactLength: elementChoices.exactLength,
      unique: elementChoices.unique,
    };
  }).sort((left, right) => left.path.localeCompare(right.path, 'en'));

  return {
    schemaVersion: 1,
    lessonId: spec.id,
    sourceOfTruth: 'assessment-validator-shared-choice-contract',
    instructions: [
      'choices配列の掲載順は正答を示しません。ただし、回答として作る配列内の順序は手順や優先順位として採点される場合があります。',
      'scalarはTODO文字列を候補1つへ置換します。exact-arrayは配列全体を候補1つへ置換します。',
      'array-elementsは指定数の要素を候補から選び、教材本文の依存順に並べます。uniqueがtrueなら重複させません。',
    ],
    entries,
    ...(spec.trackRules ? { trackRules: spec.trackRules } : {}),
  };
}

function main() {
  const check = process.argv.slice(2).includes('--check');
  const unknown = process.argv.slice(2).filter((argument) => argument !== '--check');
  if (unknown.length > 0) fail(`unknown argument: ${unknown[0]}`);
  const stale = [];
  for (const spec of lessonSpecs) {
    const destination = resolve(repositoryRoot, `course/lessons/${spec.id}/submission-choices.json`);
    const expected = json(buildArtifact(spec));
    if (check) {
      if (!existsSync(destination) || readFileSync(destination, 'utf8') !== expected) stale.push(spec.id);
    } else {
      writeFileSync(destination, expected);
    }
  }
  if (stale.length > 0) fail(`stale learner choice artifacts: ${stale.join(', ')}`);
  process.stdout.write(`${check ? 'checked' : 'generated'} ${lessonSpecs.length} learner choice artifacts\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
