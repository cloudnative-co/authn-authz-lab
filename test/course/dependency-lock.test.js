import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), 'utf8'));
}

test('direct course dependencies use exact versions and match package-lock', () => {
  const manifest = readJson('package.json');
  const lock = readJson('package-lock.json').packages[''];

  for (const field of ['dependencies', 'devDependencies']) {
    assert.deepEqual(lock[field], manifest[field], `${field} differs from package-lock root`);
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, `${name}=${version}`);
    }
  }
});

test('every container base image is pinned by sha256 digest', () => {
  const dockerRoot = resolve(repositoryRoot, 'docker');
  const dockerfiles = [];
  const composeFiles = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name === 'Dockerfile') dockerfiles.push(path);
      else if (entry.isFile() && /^(?:compose|docker-compose)\.ya?ml$/u.test(entry.name)) composeFiles.push(path);
    }
  };
  visit(dockerRoot);

  assert.ok(dockerfiles.length > 0);
  for (const path of dockerfiles) {
    const fromLines = readFileSync(path, 'utf8')
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('FROM '));
    assert.ok(fromLines.length > 0, path);
    for (const line of fromLines) {
      assert.match(line, /^FROM [^\s@]+(?::[^\s@]+)?@sha256:[a-f0-9]{64}(?: AS [A-Za-z0-9_.-]+)?$/u, path);
    }
  }

  for (const path of composeFiles) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/u).filter((value) => /^\s+image:/u.test(value))) {
      assert.match(line, /@sha256:[a-f0-9]{64}\s*$/u, `${path}: ${line}`);
    }
  }
});
