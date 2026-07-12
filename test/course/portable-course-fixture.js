import { cp, lstat, mkdir, readFile, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function addPortableReference(references, reference, label) {
  if (typeof reference !== 'string' || reference.length === 0) {
    throw new TypeError(`${label} must be a non-empty repository-relative path`);
  }
  if (isAbsolute(reference) || reference.split('/').includes('..')) {
    throw new TypeError(`${label} must stay inside the repository: ${reference}`);
  }
  references.add(reference);
}

function collectImplementedAssessmentReferences(source, references) {
  for (const lesson of source.lessons ?? []) {
    for (const assessment of lesson.assessments ?? []) {
      if (assessment.artifactStatus !== 'implemented') continue;
      addPortableReference(
        references,
        assessment.labTask?.instructionsRef,
        `${assessment.id}.labTask.instructionsRef`,
      );
      addPortableReference(references, assessment.answerKeyRef, `${assessment.id}.answerKeyRef`);
      addPortableReference(
        references,
        assessment.instructorGuideRef,
        `${assessment.id}.instructorGuideRef`,
      );
      for (const [index, reference] of (assessment.automatedCheckRefs ?? []).entries()) {
        addPortableReference(
          references,
          reference,
          `${assessment.id}.automatedCheckRefs[${index}]`,
        );
      }
    }
  }
}

function collectManifestSourceFiles(manifest, references) {
  for (const lesson of manifest.lessons ?? []) {
    for (const [index, reference] of (lesson.sourceFiles ?? []).entries()) {
      addPortableReference(references, reference, `${lesson.id}.sourceFiles[${index}]`);
    }
  }
}

export async function copyPortableCourseReferences(sourceRoot, targetRoot) {
  const [source, manifest] = await Promise.all([
    readFile(resolve(sourceRoot, 'curriculum/course-source.snapshot.json'), 'utf8').then(JSON.parse),
    readFile(resolve(sourceRoot, 'curriculum/manifest.json'), 'utf8').then(JSON.parse),
  ]);
  const references = new Set();
  collectImplementedAssessmentReferences(source, references);
  collectManifestSourceFiles(manifest, references);

  for (const reference of [...references].sort()) {
    const sourcePath = resolve(sourceRoot, reference);
    const targetPath = resolve(targetRoot, reference);
    if (relative(sourceRoot, sourcePath).startsWith('..')
        || relative(targetRoot, targetPath).startsWith('..')) {
      throw new TypeError(`course reference must stay inside the repository: ${reference}`);
    }
    if (await exists(targetPath)) continue;
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath);
  }
}

export async function linkFixtureRuntimeDependencies(sourceRoot, targetRoot) {
  const packageJson = JSON.parse(await readFile(resolve(sourceRoot, 'package.json'), 'utf8'));
  const dependencyNames = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ];
  for (const name of dependencyNames) {
    const sourcePath = resolve(sourceRoot, 'node_modules', name);
    const targetPath = resolve(targetRoot, 'node_modules', name);
    if (!(await exists(sourcePath))) {
      throw new Error(`fixture runtime dependency is not installed: ${name}`);
    }
    if (await exists(targetPath)) continue;
    await mkdir(dirname(targetPath), { recursive: true });
    await symlink(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
  }
}
