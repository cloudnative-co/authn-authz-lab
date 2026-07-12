import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { lesson13AnswerKey } from '../../course/lessons/13/assessment.mjs';
import { lesson14AnswerKey } from '../../course/lessons/14/assessment.mjs';
import { runCli } from '../../course/runner/main.mjs';
import { stopOwnedProcess } from '../../course/runner/process.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function refreshCopiedGeneratedDigests(root) {
  const path = resolve(root, 'course-lock.json');
  const lock = JSON.parse(await readFile(path, 'utf8'));
  for (const generated of lock.generatedFiles) {
    generated.sha256 = sha256(await readFile(resolve(root, generated.path)));
  }
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`);
}

async function createFixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-lessons-13-14-e2e-'));
  for (const entry of [
    'apps', 'course', 'curriculum', 'docker', 'packages', 'scripts', 'services', 'test', 'test-integration',
  ]) await cp(resolve(repositoryRoot, entry), resolve(root, entry), { recursive: true });
  for (const entry of ['README.md', 'course.mjs', 'course-lock.json', 'package.json', 'package-lock.json']) {
    await cp(resolve(repositoryRoot, entry), resolve(root, entry));
  }
  await symlink(resolve(repositoryRoot, 'node_modules'), resolve(root, 'node_modules'), 'dir');
  const manifestPath = resolve(root, 'curriculum/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.ports.find(({ id }) => id === 'project-app-http').port = await availablePort();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await refreshCopiedGeneratedDigests(root);
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

async function currentProcess(root) {
  const base = resolve(root, '.lab/processes/project-app');
  const pointer = JSON.parse(await readFile(resolve(base, 'current.json'), 'utf8'));
  const generation = resolve(base, 'generations', pointer.generationId);
  return {
    record: JSON.parse(await readFile(resolve(generation, 'record.json'), 'utf8')),
    control: JSON.parse(await readFile(resolve(generation, 'control.json'), 'utf8')),
  };
}

async function emergencyStop(root) {
  try {
    const current = await currentProcess(root);
    if (current.record.status === 'running' && current.control.status === 'active') {
      await stopOwnedProcess({
        record: current.record,
        shutdownToken: current.control.shutdownToken,
        timeoutMs: 2_000,
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function filesBelow(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files;
}

async function completeLesson(root, lessonId, answerKey) {
  for (const action of ['doctor', 'setup', 'demo', 'observe']) {
    const outcome = await command(root, ['lesson', lessonId, action]);
    assert.equal(outcome.result.status, 'pass', JSON.stringify(outcome.result));
  }
  const runtimePath = resolve(root, `.lab/submissions/${lessonId}/runtime.json`);
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
  assert.equal(runtime.runtimeEvidence, true);
  assert.equal(runtime.browserAPI.registration, 'navigator.credentials.create');
  assert.equal(runtime.browserAPI.authentication, 'navigator.credentials.get');
  assert.equal(runtime.redaction.assertions, 'omitted');

  const incomplete = await command(root, ['lesson', lessonId, 'check']);
  assert.equal(incomplete.exitCode, 10);
  assert.equal(incomplete.result.reasonCode, `CHECK_LESSON${lessonId}_SUBMISSION_INVALID`);
  const submissionPath = resolve(root, `.lab/submissions/${lessonId}/submission.json`);
  await writeFile(submissionPath, `${JSON.stringify(answerKey(), null, 2)}\n`);
  const checked = await command(root, ['lesson', lessonId, 'check']);
  assert.equal(checked.result.status, 'pass', JSON.stringify(checked.result));
  assert.match(checked.result.evidenceId, /^evidence-/u);

  assert.equal((await command(root, ['lesson', lessonId, 'stop'])).result.status, 'pass');
  assert.equal((await command(root, ['lesson', lessonId, 'reset'])).result.status, 'pass');
  assert.match(await readFile(submissionPath, 'utf8'), /TODO/u);
  assert.equal((await command(root, ['lesson', lessonId, 'diagnose'])).result.status, 'pass');
}

test('Lessons 13 and 14 complete the documented browser lifecycle and purge all owned state', async () => {
  const root = await createFixture();
  try {
    assert.equal((await command(root, ['doctor'])).result.status, 'pass');
    assert.equal((await command(root, ['setup'])).result.status, 'pass');
    await completeLesson(root, '13', lesson13AnswerKey);
    await completeLesson(root, '14', lesson14AnswerKey);

    const current = await currentProcess(root);
    const persistedFiles = [];
    for (const directory of ['submissions', 'evidence', 'journal', 'logs']) {
      persistedFiles.push(...await filesBelow(resolve(root, '.lab', directory)));
    }
    const persisted = (await Promise.all(persistedFiles.map((path) => readFile(path, 'utf8')))).join('\n');
    for (const forbidden of [
      'alice-password-for-lesson-02',
      'course_webauthn_13_session=',
      'course_webauthn_14_session=',
      'x-course-scenario-id',
      'x-course-control-token',
      current.control.shutdownToken,
    ]) assert.equal(persisted.includes(forbidden), false, `persisted forbidden value: ${forbidden}`);

    const purged = await command(root, ['lesson', '14', 'purge', '--yes']);
    assert.equal(purged.result.status, 'pass', JSON.stringify(purged.result));
    assert.equal(purged.result.diagnostics.find(({ id }) => id === 'resources.remaining').actual, '0');
    await assert.rejects(lstat(resolve(root, '.lab')), (error) => error.code === 'ENOENT');
  } finally {
    await emergencyStop(root);
    await rm(root, { recursive: true, force: true });
  }
});

