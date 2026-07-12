import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { sha256Hex } from './canonical.mjs';
import { assertValidSchema } from './schema.mjs';

export const COURSE_LOCK_PATH = 'course-lock.json';

export class CourseLockError extends Error {
  constructor(message, { cause, reasonCode = 'COURSE_ARTIFACT_DRIFT' } = {}) {
    super(message, { cause });
    this.name = 'CourseLockError';
    this.reasonCode = reasonCode;
  }
}

function assertRelativePath(path, label) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path) || path.includes('\\')) {
    throw new CourseLockError(`${label} must be a repository-relative path`);
  }
  const segments = path.split('/');
  if (segments.includes('') || segments.includes('.') || segments.includes('..')) {
    throw new CourseLockError(`${label} contains an unsafe path segment`);
  }
}

function assertInside(root, candidate, label) {
  const fromRoot = relative(root, candidate);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new CourseLockError(`${label} escapes the repository`);
  }
}

async function readOwnedFile(repositoryRealpath, path, label) {
  assertRelativePath(path, label);
  const requested = resolve(repositoryRealpath, path);
  assertInside(repositoryRealpath, requested, label);
  const canonical = await realpath(requested).catch((error) => {
    throw new CourseLockError(`${label} is missing`, { cause: error });
  });
  assertInside(repositoryRealpath, canonical, label);
  if (!(await stat(canonical)).isFile()) throw new CourseLockError(`${label} is not a regular file`);
  return readFile(canonical);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new CourseLockError(`${label} is not valid JSON`, { cause: error });
  }
}

export async function loadAndValidateCourseLock({ repoRoot, lockPath = COURSE_LOCK_PATH } = {}) {
  if (!repoRoot) throw new TypeError('repoRoot is required');
  const repositoryRealpath = await realpath(repoRoot);
  const lockBytes = await readOwnedFile(repositoryRealpath, lockPath, 'course lock');
  const lock = parseJson(lockBytes, 'course lock');
  if (typeof lock.$schema !== 'string') throw new CourseLockError('course lock schema is missing');
  const schemaBytes = await readOwnedFile(repositoryRealpath, lock.$schema.replace(/^\.\//, ''), 'course lock schema');
  const schema = parseJson(schemaBytes, 'course lock schema');
  try {
    assertValidSchema(lock, schema, 'course lock');
  } catch (error) {
    throw new CourseLockError('course lock does not match its schema', { cause: error });
  }

  for (const generatedFile of lock.generatedFiles) {
    const bytes = await readOwnedFile(repositoryRealpath, generatedFile.path, `generated file ${generatedFile.path}`);
    if (sha256Hex(bytes) !== generatedFile.sha256) {
      throw new CourseLockError(`generated file digest has drifted: ${generatedFile.path}`);
    }
  }

  const contractBytes = await readOwnedFile(repositoryRealpath, 'curriculum/course-contract.json', 'course contract');
  const contract = parseJson(contractBytes, 'course contract');
  if (contract.$schema !== './schemas/course-contract.schema.json') {
    throw new CourseLockError('course contract schema reference is invalid');
  }
  const contractSchema = parseJson(
    await readOwnedFile(
      repositoryRealpath,
      'curriculum/schemas/course-contract.schema.json',
      'course contract schema',
    ),
    'course contract schema',
  );
  try {
    assertValidSchema(contract, contractSchema, 'course contract');
  } catch (error) {
    throw new CourseLockError('course contract does not match its schema', { cause: error });
  }
  if (contract.courseId !== lock.courseId
      || contract.source.path !== lock.sourceFile.path
      || contract.source.sha256 !== lock.sourceFile.sha256
      || contract.source.revision !== lock.sourceRevision) {
    throw new CourseLockError('course contract source identity does not match course-lock.json');
  }
  const assessmentSchema = parseJson(
    await readOwnedFile(
      repositoryRealpath,
      'curriculum/schemas/assessment.schema.json',
      'assessment schema',
    ),
    'assessment schema',
  );
  for (const generatedFile of lock.generatedFiles) {
    if (!/^course\/lessons\/[A-Za-z0-9_-]+\/assessment\.yaml$/.test(generatedFile.path)) continue;
    const assessment = parseJson(
      await readOwnedFile(repositoryRealpath, generatedFile.path, `assessment ${generatedFile.path}`),
      `assessment ${generatedFile.path}`,
    );
    try {
      assertValidSchema(assessment, assessmentSchema, `assessment ${generatedFile.path}`);
    } catch (error) {
      throw new CourseLockError(`assessment does not match its schema: ${generatedFile.path}`, { cause: error });
    }
  }
  const sourceDigestBytes = await readOwnedFile(
    repositoryRealpath,
    'curriculum/course-contract.source.sha256',
    'course source digest',
  );
  const [recordedDigest, recordedPath, trailing] = sourceDigestBytes.toString('utf8').trimEnd().split(/\s+/);
  if (trailing !== undefined || recordedDigest !== lock.sourceFile.sha256 || recordedPath !== lock.sourceFile.path) {
    throw new CourseLockError('course source digest file does not match course-lock.json');
  }
  return { lock, lockDigest: sha256Hex(lockBytes), contract };
}
