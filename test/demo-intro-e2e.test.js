import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { runIntroDemo } from '../scripts/demo-intro.mjs';
import { runCli } from '../course/runner/main.mjs';
import { loadCourseFoundation } from '../course/runner/lifecycle.mjs';
import { inspectProjectAppProcess } from '../course/runner/project-app-runtime.mjs';
import { lesson04AnswerKey } from '../course/lessons/04/assessment.mjs';
import { copyPortableCourseReferences, linkFixtureRuntimeDependencies } from './course/portable-course-fixture.js';

const repositoryRoot = resolve(import.meta.dirname, '..');

function output() {
  return { value: '', write(chunk) { this.value += String(chunk); } };
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'authn-authz-intro-'));
  for (const entry of ['apps', 'course', 'curriculum', 'packages', 'scripts', 'services', 'test']) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry), { recursive: true });
  }
  for (const entry of ['README.md', 'course.mjs', 'course-lock.json', 'package.json', 'package-lock.json']) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry));
  }
  await copyPortableCourseReferences(repositoryRoot, root);
  await linkFixtureRuntimeDependencies(repositoryRoot, root);
  const server = createServer();
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const port = server.address().port;
  await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
  const manifestPath = resolve(root, 'curriculum/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.ports.find(({ id }) => id === 'project-app-http').port = port;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const packagePath = resolve(root, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  packageJson.dependencies = {};
  packageJson.devDependencies = {};
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(resolve(root, 'package-lock.json'), `${JSON.stringify({
    name: packageJson.name, version: packageJson.version, lockfileVersion: 3, requires: true,
    packages: { '': {
      name: packageJson.name, version: packageJson.version,
      dependencies: {}, devDependencies: {}, engines: packageJson.engines,
    } },
  }, null, 2)}\n`);
  await promisify(execFile)(process.execPath, [
    'scripts/sync-course-contract.mjs',
    '--source', 'curriculum/course-source.snapshot.json',
    '--source-label', 'articles/series/authn-authz/curriculum.json',
    '--output-root', root,
  ], { cwd: root });
  return root;
}

async function command(root, args) {
  const stdout = output();
  const stderr = output();
  const code = await runCli([...args, '--json'], { repoRoot: root, stdout, stderr });
  assert.equal(code, 0, stdout.value + stderr.value);
}

test('intro uses real HTTP, stops its process, and preserves existing lesson answers on rerun', async () => {
  const root = await fixture();
  try {
    const stdout = output();
    const stderr = output();
    assert.equal(await runIntroDemo({ repoRoot: root, stdout, stderr }), 0, stderr.value);
    assert.match(stdout.value, /Bob: HTTP 403/u);
    assert.match(stdout.value, /Alice: HTTP 204/u);
    const foundation = await loadCourseFoundation({ repoRoot: root });
    const context = { foundation, stateRoot: resolve(foundation.repositoryRealpath, '.lab') };
    assert.equal((await inspectProjectAppProcess(context)).status, 'stopped');
    const runtime = JSON.parse(await readFile(resolve(root, '.lab/submissions/04/runtime.json'), 'utf8'));
    assert.deepEqual(runtime.audit.statuses, [403, 404, 404, 404, 204, 404]);
    const submissionPath = resolve(root, '.lab/submissions/04/submission.json');
    const answer = `${JSON.stringify(lesson04AnswerKey(), null, 2)}\n`;
    await writeFile(submissionPath, answer);
    assert.equal(await runIntroDemo({ repoRoot: root, stdout: output(), stderr }), 0, stderr.value);
    assert.equal(await readFile(submissionPath, 'utf8'), answer);
    await command(root, ['lesson', '04', 'diagnose']);

    await command(root, ['lesson', '03', 'setup']);
    const existing = await inspectProjectAppProcess(context);
    const refused = output();
    assert.equal(await runIntroDemo({ repoRoot: root, stdout: output(), stderr: refused }), 1);
    assert.match(refused.value, /既存の project-app/u);
    const after = await inspectProjectAppProcess(context);
    assert.equal(after.status, 'running');
    assert.equal(after.record.instanceId, existing.record.instanceId);
  } finally {
    const stdout = output();
    const stderr = output();
    const stopped = await runCli(['stop', '--json'], { repoRoot: root, stdout, stderr });
    assert.equal(stopped, 0, stdout.value + stderr.value);
    await rm(root, { recursive: true, force: true });
  }
});
