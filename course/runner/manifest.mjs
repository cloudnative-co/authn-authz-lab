import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { digestCanonical, sha256Hex } from './canonical.mjs';
import { COURSE_COMMANDS, LESSON_COMMANDS, MANIFEST_PATH } from './constants.mjs';
import { assertValidSchema, loadJsonSchema } from './schema.mjs';

export class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestError';
  }
}

function assertInside(root, candidate, label) {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new ManifestError(`${label} escapes the repository`);
  }
}

function uniqueIndex(entries, kind) {
  const index = new Map();
  for (const entry of entries) {
    if (index.has(entry.id)) throw new ManifestError(`duplicate ${kind} id: ${entry.id}`);
    index.set(entry.id, entry);
  }
  return index;
}

function requireReferences(values, index, label) {
  for (const value of values) {
    if (!index.has(value)) throw new ManifestError(`${label} references unknown id: ${value}`);
  }
}

function validateRelationships(manifest) {
  if (manifest.runtime.commands.course.actions.join('\u0000') !== COURSE_COMMANDS.join('\u0000')) {
    throw new ManifestError('manifest course actions do not match the runner grammar');
  }
  if (manifest.runtime.commands.lesson.actions.join('\u0000') !== LESSON_COMMANDS.join('\u0000')) {
    throw new ManifestError('manifest lesson actions do not match the runner grammar');
  }
  const lessons = uniqueIndex(manifest.lessons, 'lesson');
  const ports = uniqueIndex(manifest.ports, 'port');
  const resources = uniqueIndex(manifest.resources, 'resource');
  const locks = uniqueIndex(manifest.locks, 'lock');
  const externalServiceEntries = manifest.runtime.externalServices ?? [];
  const externalServices = uniqueIndex(externalServiceEntries, 'external service');
  for (const port of manifest.ports) {
    requireReferences([port.resourceId], resources, port.id);
    requireReferences(port.lessonIds, lessons, port.id);
  }
  for (const resource of manifest.resources) requireReferences(resource.lessonIds, lessons, resource.id);
  for (const lock of manifest.locks) requireReferences(lock.resourceIds, resources, lock.id);
  for (const service of externalServiceEntries) {
    requireReferences([service.lessonId], lessons, service.id);
    requireReferences([service.resourceId], resources, service.id);
    requireReferences([service.portId], ports, service.id);
    const port = ports.get(service.portId);
    if (port.resourceId !== service.resourceId || !port.lessonIds.includes(service.lessonId)) {
      throw new ManifestError(`${service.id} port ownership is inconsistent`);
    }
    const lesson = lessons.get(service.lessonId);
    if (!lesson.resourceIds.includes(service.resourceId) || !lesson.portIds.includes(service.portId)) {
      throw new ManifestError(`${service.id} lesson ownership is inconsistent`);
    }
  }
  for (const lesson of manifest.lessons) {
    requireReferences(lesson.portIds, ports, lesson.id);
    requireReferences(lesson.resourceIds, resources, lesson.id);
    requireReferences(lesson.lockIds, locks, lesson.id);
  }
  return { externalServices, lessons, locks, ports, resources };
}

async function validateSourceFile(repoRoot, sourcePath) {
  if (isAbsolute(sourcePath) || sourcePath.includes('\\') || sourcePath.split('/').includes('..')) {
    throw new ManifestError(`invalid sourceFiles path: ${sourcePath}`);
  }
  const absolutePath = resolve(repoRoot, sourcePath);
  assertInside(repoRoot, absolutePath, `sourceFiles path ${sourcePath}`);
  let realPath;
  try {
    realPath = await realpath(absolutePath);
  } catch (error) {
    throw new ManifestError(`missing sourceFiles entry ${sourcePath}: ${error.message}`);
  }
  assertInside(repoRoot, realPath, `sourceFiles entry ${sourcePath}`);
  if (!(await stat(realPath)).isFile()) throw new ManifestError(`sourceFiles entry is not a file: ${sourcePath}`);
  const bytes = await readFile(realPath);
  return { path: sourcePath, sha256: sha256Hex(bytes) };
}

export async function loadAndValidateManifest({ repoRoot, manifestPath = MANIFEST_PATH } = {}) {
  if (!repoRoot) throw new TypeError('repoRoot is required');
  const canonicalRoot = await realpath(repoRoot);
  const absoluteManifestPath = resolve(canonicalRoot, manifestPath);
  assertInside(canonicalRoot, absoluteManifestPath, 'manifestPath');
  const canonicalManifestPath = await realpath(absoluteManifestPath).catch((error) => {
    throw new ManifestError(`cannot read manifest ${manifestPath}: ${error.message}`);
  });
  assertInside(canonicalRoot, canonicalManifestPath, 'manifestPath');
  const manifestBytes = await readFile(canonicalManifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new ManifestError(`manifest is invalid JSON: ${error.message}`);
  }
  if (typeof manifest.$schema !== 'string') throw new ManifestError('manifest.$schema is required');
  if (isAbsolute(manifest.$schema)) throw new ManifestError('manifest.$schema must be repository-relative');
  const absoluteSchemaPath = resolve(canonicalManifestPath, '..', manifest.$schema);
  assertInside(canonicalRoot, absoluteSchemaPath, 'manifest schema');
  const canonicalSchemaPath = await realpath(absoluteSchemaPath).catch((error) => {
    throw new ManifestError(`cannot read manifest schema: ${error.message}`);
  });
  assertInside(canonicalRoot, canonicalSchemaPath, 'manifest schema');
  const schema = await loadJsonSchema(canonicalSchemaPath);
  assertValidSchema(manifest, schema, 'manifest');
  const indexes = validateRelationships(manifest);

  const distinctPaths = [...new Set(manifest.lessons.flatMap((lesson) => lesson.sourceFiles))].sort();
  const sourceFiles = [];
  for (const sourcePath of distinctPaths) sourceFiles.push(await validateSourceFile(canonicalRoot, sourcePath));
  return {
    manifest,
    manifestDigest: sha256Hex(manifestBytes),
    sourceFiles,
    sourceDigest: digestCanonical(sourceFiles),
    indexes,
  };
}
