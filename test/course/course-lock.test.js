import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { sha256Hex } from '../../course/runner/canonical.mjs';
import { CourseLockError, loadAndValidateCourseLock } from '../../course/runner/course-lock.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoots = [];

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot() {
  const root = await mkdtemp(resolve(tmpdir(), 'auth-authz-course-lock-'));
  temporaryRoots.push(root);
  const lock = JSON.parse(await readFile(resolve(repositoryRoot, 'course-lock.json'), 'utf8'));
  for (const path of new Set([
    'course-lock.json',
    'curriculum/course-contract.source.sha256',
    'curriculum/schemas/course-lock.schema.json',
    'curriculum/schemas/course-contract.schema.json',
    'curriculum/schemas/assessment.schema.json',
    ...lock.generatedFiles.map(({ path }) => path),
  ])) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await cp(resolve(repositoryRoot, path), resolve(root, path));
  }
  return root;
}

test('course lock binds the generated contract to the authoritative curriculum digest', async () => {
  const loaded = await loadAndValidateCourseLock({ repoRoot: repositoryRoot });
  assert.equal(loaded.lock.courseId, 'auth-authz');
  assert.equal(loaded.lock.sourceRevision, null);
  assert.equal(loaded.contract.source.sha256, loaded.lock.sourceFile.sha256);
  assert.match(loaded.lockDigest, /^[a-f0-9]{64}$/);
});

test('course lock fails closed when a generated artifact is changed', async () => {
  const root = await fixtureRoot();
  const contractPath = resolve(root, 'curriculum/course-contract.json');
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  contract.title = 'tampered';
  await writeFile(contractPath, `${JSON.stringify(contract)}\n`);
  await assert.rejects(
    loadAndValidateCourseLock({ repoRoot: root }),
    (error) => error instanceof CourseLockError && /digest has drifted/.test(error.message),
  );
});

test('course lock rejects a path that escapes the repository', async () => {
  const root = await fixtureRoot();
  const lockPath = resolve(root, 'course-lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.generatedFiles[0].path = '../outside.json';
  await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
  await assert.rejects(loadAndValidateCourseLock({ repoRoot: root }), CourseLockError);
});

test('course lock validates generated content even when its digest was recomputed', async () => {
  const root = await fixtureRoot();
  const contractPath = resolve(root, 'curriculum/course-contract.json');
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  delete contract.title;
  const invalidBytes = Buffer.from(`${JSON.stringify(contract)}\n`);
  await writeFile(contractPath, invalidBytes);

  const lockPath = resolve(root, 'course-lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.generatedFiles.find(({ path }) => path === 'curriculum/course-contract.json').sha256 = sha256Hex(invalidBytes);
  await writeFile(lockPath, `${JSON.stringify(lock)}\n`);

  await assert.rejects(
    loadAndValidateCourseLock({ repoRoot: root }),
    (error) => error instanceof CourseLockError && /does not match its schema/.test(error.message),
  );
});
