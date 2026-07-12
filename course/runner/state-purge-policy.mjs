import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LESSON_WORKSPACE_FILES } from './lesson-workspace-layout.mjs';

const ATOMIC_TEMPORARY_ENTRY = /^\.[0-9a-f-]{32,36}\.tmp$/;
const OPERATION_WRITE_TEMPORARY = /^\.operation-write-[1-9][0-9]*-op-[a-f0-9]{32}-[a-f0-9]{64}\.tmp$/;
const SAFE_RESOURCE_ID = /^[a-z][a-z0-9-]{2,63}$/;
const SAFE_GENERATION_ID = /^gen-[a-f0-9]{32}$/;
const SAFE_EVIDENCE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/;
const SAFE_TRANSACTION_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}\.json$/;
const SAFE_RUN_ID = /^[A-Za-z0-9_-]{3,128}$/;
const MAX_PROCESS_JSON_BYTES = 32 * 1024;
const MAX_CONTAINER_RECORD_BYTES = 64 * 1024;
const MAX_CONTAINER_SUPPLEMENTAL_BYTES = 4 * 1024;

export class PurgeStructureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PurgeStructureError';
  }
}

async function assertEntryType(path, type, label, { privateDirectory = false } = {}) {
  const stats = await lstat(path);
  const matches = type === 'directory' ? stats.isDirectory() : stats.isFile();
  if (!matches || stats.isSymbolicLink()) throw new PurgeStructureError(`purge refuses invalid ${label}`);
  if (privateDirectory && (stats.mode & 0o777) !== 0o700) {
    throw new PurgeStructureError(`purge refuses insecure ${label}`);
  }
  return stats;
}

async function assertFlatFiles(directory, accepts, label) {
  for (const name of (await readdir(directory)).sort()) {
    if (!accepts(name)) throw new PurgeStructureError(`purge refuses unknown ${label} entry: ${name}`);
    await assertEntryType(resolve(directory, name), 'file', `${label} entry ${name}`);
  }
}

async function assertLockTree(directory) {
  await assertEntryType(directory, 'directory', 'lock directory');
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name);
    if (name === 'readers') {
      await assertEntryType(path, 'directory', 'reader lock directory');
      await assertFlatFiles(path, (entry) => /^[a-f0-9]{64}\.lock$/.test(entry), 'reader lock');
      continue;
    }
    if (!['write.lock', 'purge.lock', 'purge-recovery.lock'].includes(name)
        && !ATOMIC_TEMPORARY_ENTRY.test(name)) {
      throw new PurgeStructureError(`purge refuses unknown lock entry: ${name}`);
    }
    await assertEntryType(path, 'file', `lock entry ${name}`);
  }
}

async function readOwnedProcessIntent(path, resourceId, generationId) {
  const stats = await assertEntryType(path, 'file', `managed process intent ${generationId}`);
  if (stats.size > MAX_PROCESS_JSON_BYTES) {
    throw new PurgeStructureError(`purge refuses oversized managed process intent: ${generationId}`);
  }
  let intent;
  try {
    intent = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new PurgeStructureError(`purge refuses invalid managed process intent: ${generationId}`);
  }
  if (intent?.$schema !== 'curriculum/schemas/managed-process-launch.schema.json'
      || intent.schemaVersion !== 2
      || intent.resourceId !== resourceId
      || intent.generationId !== generationId
      || !SAFE_RUN_ID.test(intent.runId)) {
    throw new PurgeStructureError(`purge refuses mismatched managed process intent: ${generationId}`);
  }
  return intent;
}

async function assertProcessTree(directory) {
  const ownedLogs = new Set();
  await assertEntryType(directory, 'directory', 'managed process directory', { privateDirectory: true });
  for (const resourceId of (await readdir(directory)).sort()) {
    if (!SAFE_RESOURCE_ID.test(resourceId)) {
      throw new PurgeStructureError(`purge refuses unknown managed process entry: ${resourceId}`);
    }
    const resource = resolve(directory, resourceId);
    await assertEntryType(resource, 'directory', `managed resource ${resourceId}`, { privateDirectory: true });
    for (const name of (await readdir(resource)).sort()) {
      const path = resolve(resource, name);
      if (name === 'generations') {
        await assertEntryType(path, 'directory', `managed generations ${resourceId}`, { privateDirectory: true });
        for (const generationId of (await readdir(path)).sort()) {
          if (!SAFE_GENERATION_ID.test(generationId)) {
            throw new PurgeStructureError(`purge refuses unknown managed generation: ${generationId}`);
          }
          const generation = resolve(path, generationId);
          await assertEntryType(generation, 'directory', `managed generation ${generationId}`, {
            privateDirectory: true,
          });
          const generationEntries = await readdir(generation);
          await assertFlatFiles(
            generation,
            (entry) => ['intent.json', 'record.json', 'control.json'].includes(entry)
              || ATOMIC_TEMPORARY_ENTRY.test(entry),
            `managed generation ${generationId}`,
          );
          if (generationEntries.includes('intent.json')) {
            const intent = await readOwnedProcessIntent(
              resolve(generation, 'intent.json'),
              resourceId,
              generationId,
            );
            ownedLogs.add(`${resourceId}-${intent.runId}.stdout.log`);
            ownedLogs.add(`${resourceId}-${intent.runId}.stderr.log`);
          }
        }
        continue;
      }
      if (!['current.json', '.operation.lock'].includes(name)
          && !ATOMIC_TEMPORARY_ENTRY.test(name)
          && !OPERATION_WRITE_TEMPORARY.test(name)) {
        throw new PurgeStructureError(`purge refuses unknown managed resource entry: ${name}`);
      }
      await assertEntryType(path, 'file', `managed resource entry ${name}`);
    }
  }
  return ownedLogs;
}

async function assertContainerTree(directory) {
  await assertEntryType(directory, 'directory', 'managed container directory', { privateDirectory: true });
  for (const resourceId of (await readdir(directory)).sort()) {
    if (!SAFE_RESOURCE_ID.test(resourceId)) {
      throw new PurgeStructureError(`purge refuses unknown managed container entry: ${resourceId}`);
    }
    const resource = resolve(directory, resourceId);
    await assertEntryType(resource, 'directory', `managed container resource ${resourceId}`, {
      privateDirectory: true,
    });
    const entries = (await readdir(resource)).sort();
    let supplementalFiles = null;
    if (entries.includes('record.json')) {
      const recordPath = resolve(resource, 'record.json');
      const stats = await assertEntryType(recordPath, 'file', `managed container record ${resourceId}`);
      if (stats.size > MAX_CONTAINER_RECORD_BYTES || (stats.mode & 0o777) !== 0o600) {
        throw new PurgeStructureError(`purge refuses unsafe managed container record: ${resourceId}`);
      }
      let record;
      try {
        record = JSON.parse(await readFile(recordPath, 'utf8'));
      } catch {
        throw new PurgeStructureError(`purge refuses invalid managed container record: ${resourceId}`);
      }
      if (record?.$schema !== 'curriculum/schemas/managed-compose-service.schema.json'
          || record.schemaVersion !== 1
          || record.resourceId !== resourceId
          || !Array.isArray(record.supplementalFiles)
          || record.supplementalFiles.some((name) => !/^[a-z][a-z0-9-]{0,62}$/.test(name))) {
        throw new PurgeStructureError(`purge refuses mismatched managed container record: ${resourceId}`);
      }
      supplementalFiles = new Set(record.supplementalFiles);
    }
    for (const name of entries) {
      if (name === 'record.json') continue;
      if (!ATOMIC_TEMPORARY_ENTRY.test(name)
          && !(supplementalFiles?.has(name) ?? /^[a-z][a-z0-9-]{0,62}$/.test(name))) {
        throw new PurgeStructureError(`purge refuses unknown managed container file: ${name}`);
      }
      const stats = await assertEntryType(
        resolve(resource, name),
        'file',
        `managed container file ${resourceId}/${name}`,
      );
      if (stats.size > MAX_CONTAINER_SUPPLEMENTAL_BYTES || (stats.mode & 0o777) !== 0o600) {
        throw new PurgeStructureError(`purge refuses unsafe managed container file: ${name}`);
      }
    }
  }
}

export async function assertOwnedPurgeStructure({ stateRoot, entries, markerFile, stateFile }) {
  const ownedLogs = entries.includes('processes')
    ? await assertProcessTree(resolve(stateRoot, 'processes'))
    : new Set();
  for (const name of entries) {
    const path = resolve(stateRoot, name);
    if ([markerFile, stateFile, 'secrets.json'].includes(name) || ATOMIC_TEMPORARY_ENTRY.test(name)) {
      await assertEntryType(path, 'file', `state entry ${name}`);
      continue;
    }
    if (name === 'locks') {
      await assertLockTree(path);
      continue;
    }
    if (name === 'processes') {
      continue;
    }
    if (name === 'containers') {
      await assertContainerTree(path);
      continue;
    }
    await assertEntryType(path, 'directory', `state directory ${name}`);
    if (name === 'logs') {
      await assertFlatFiles(path, (entry) => ownedLogs.has(entry), 'log');
    } else if (name === 'journal') {
      await assertFlatFiles(
        path,
        (entry) => /^\d{12,}\.json$/.test(entry) || entry === '.append.lock' || ATOMIC_TEMPORARY_ENTRY.test(entry),
        'journal',
      );
    } else if (name === 'transactions') {
      await assertFlatFiles(
        path,
        (entry) => SAFE_TRANSACTION_FILE.test(entry) || ATOMIC_TEMPORARY_ENTRY.test(entry),
        'transaction',
      );
    } else if (name === 'evidence') {
      for (const epoch of (await readdir(path)).sort()) {
        if (!/^epoch-\d{6,}$/.test(epoch)) throw new PurgeStructureError(`purge refuses unknown evidence entry: ${epoch}`);
        const epochPath = resolve(path, epoch);
        await assertEntryType(epochPath, 'directory', `evidence epoch ${epoch}`);
        await assertFlatFiles(
          epochPath,
          (entry) => SAFE_EVIDENCE_FILE.test(entry) || ATOMIC_TEMPORARY_ENTRY.test(entry),
          `evidence epoch ${epoch}`,
        );
      }
    } else if (name === 'submissions') {
      for (const lessonId of (await readdir(path)).sort()) {
        const allowedFiles = LESSON_WORKSPACE_FILES[lessonId];
        if (!allowedFiles) throw new PurgeStructureError(`purge refuses unknown submission entry: ${lessonId}`);
        const lessonPath = resolve(path, lessonId);
        await assertEntryType(lessonPath, 'directory', `submission lesson ${lessonId}`);
        await assertFlatFiles(
          lessonPath,
          (entry) => allowedFiles.includes(entry) || ATOMIC_TEMPORARY_ENTRY.test(entry),
          `submission lesson ${lessonId}`,
        );
      }
    }
  }
}
