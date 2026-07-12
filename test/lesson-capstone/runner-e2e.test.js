import assert from 'node:assert/strict';
import { cp, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { capstoneAnswerKey } from '../../course/lessons/capstone/assessment.mjs';
import { runCli } from '../../course/runner/main.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function fixtureRepository() {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-capstone-e2e-'));
  for (const entry of [
    'apps', 'course', 'curriculum', 'docker', 'packages', 'scripts', 'services', 'test', 'test-integration',
  ]) await cp(resolve(repositoryRoot, entry), resolve(root, entry), { recursive: true });
  for (const entry of ['README.md', 'course.mjs', 'course-lock.json', 'package.json', 'package-lock.json']) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry));
  }
  await symlink(resolve(repositoryRoot, 'node_modules'), resolve(root, 'node_modules'), 'dir');
  return root;
}

function outputBuffer() {
  return { value: '', write(chunk) { this.value += String(chunk); } };
}

async function command(root, arguments_) {
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const exitCode = await runCli([...arguments_, '--json'], { repoRoot: root, stdout, stderr });
  assert.equal(stderr.value, '');
  return { exitCode, result: JSON.parse(stdout.value) };
}

async function filesBelow(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => (
      error.code === 'ENOENT' ? [] : Promise.reject(error)
    ));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files;
}

test('capstone completes the isolated lifecycle and enforces every hard gate', async () => {
  const root = await fixtureRepository();
  try {
    const courseDoctor = await command(root, ['doctor']);
    assert.equal(courseDoctor.result.status, 'pass', JSON.stringify(courseDoctor.result));
    const courseSetup = await command(root, ['setup']);
    assert.equal(courseSetup.result.status, 'pass', JSON.stringify(courseSetup.result));
    for (const action of ['doctor', 'setup', 'demo', 'observe']) {
      const outcome = await command(root, ['lesson', 'capstone', action]);
      assert.equal(outcome.result.status, 'pass', `${action}: ${JSON.stringify(outcome.result)}`);
    }

    const runtimePath = resolve(root, '.lab/submissions/capstone/runtime.json');
    const baseline = JSON.parse(await readFile(runtimePath, 'utf8'));
    assert.equal(baseline.mode, 'case-baseline');
    assert.equal(baseline.liveProtocolEvidence, false);
    assert.equal(baseline.criticalRejections.length, 5);

    const incomplete = await command(root, ['lesson', 'capstone', 'check']);
    assert.equal(incomplete.exitCode, 10, JSON.stringify(incomplete.result));
    assert.equal(incomplete.result.reasonCode, 'CHECK_LESSONCAPSTONE_SUBMISSION_INVALID');

    const submissionPath = resolve(root, '.lab/submissions/capstone/submission.json');
    const skipped = capstoneAnswerKey('developer');
    skipped.artifacts.developer.negativeTests.leaverSession = 'skip';
    await writeFile(submissionPath, `${JSON.stringify(skipped, null, 2)}\n`);
    const rejected = await command(root, ['lesson', 'capstone', 'check']);
    assert.equal(rejected.result.status, 'fail');
    assert.equal(rejected.result.reasonCode, 'CHECK_LESSONCAPSTONE_REQUIREMENTS');
    assert.equal(
      rejected.result.diagnostics.find(({ id }) => id === 'lessoncapstone.aa-cap-c7').status,
      'fail',
    );

    await writeFile(
      submissionPath,
      `${JSON.stringify(capstoneAnswerKey('developer'), null, 2)}\n`,
    );
    const checked = await command(root, ['lesson', 'capstone', 'check']);
    assert.equal(checked.result.status, 'pass', JSON.stringify(checked.result));
    assert.deepEqual(checked.result.checkIds, [
      'AA-CAP-C1', 'AA-CAP-C2', 'AA-CAP-C3', 'AA-CAP-C4',
      'AA-CAP-C5', 'AA-CAP-C6', 'AA-CAP-C7',
    ]);
    assert.match(checked.result.evidenceId, /^evidence-/u);

    const persistedFiles = [runtimePath];
    for (const directory of ['evidence', 'journal', 'logs']) {
      persistedFiles.push(...await filesBelow(resolve(root, '.lab', directory)));
    }
    const persisted = (await Promise.all(
      persistedFiles.map((path) => readFile(path, 'utf8')),
    )).join('\n');
    for (const forbidden of [
      'Bearer ', 'eyJ', 'password=', 'private-key', 'personal@example', '/Users/', 'C:\\',
    ]) assert.equal(persisted.includes(forbidden), false, forbidden);

    const stopped = await command(root, ['lesson', 'capstone', 'stop']);
    assert.equal(stopped.result.status, 'safe-noop');
    assert.equal((await command(root, ['lesson', 'capstone', 'diagnose'])).result.status, 'pass');
    assert.equal((await command(root, ['lesson', 'capstone', 'reset'])).result.status, 'pass');
    assert.match(await readFile(submissionPath, 'utf8'), /TODO/u);
    const afterReset = await command(root, ['lesson', 'capstone', 'observe']);
    assert.equal(afterReset.result.status, 'blocked');
    assert.equal(afterReset.result.reasonCode, 'PREREQUISITE_LESSON_DEMO');

    const purged = await command(root, ['lesson', 'capstone', 'purge', '--yes']);
    assert.equal(purged.result.status, 'pass', JSON.stringify(purged.result));
    assert.equal(purged.result.diagnostics.find(({ id }) => id === 'resources.remaining').actual, '0');
    await assert.rejects(lstat(resolve(root, '.lab')), (error) => error.code === 'ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
