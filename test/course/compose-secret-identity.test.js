import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { composeSecretReaderIdentity } from '../../course/lessons/shared/compose-identity.mjs';
import { lesson08ManagedComposeSpec } from '../../course/lessons/08/lab-contract.mjs';
import { lesson09ManagedComposeSpec } from '../../course/lessons/09/lab-contract.mjs';

test('both secret-reading labs bind a non-default Linux owner without widening file permissions', async () => {
  const hostIdentity = { uid: 1001, gid: 1001 };
  for (const createSpec of [lesson08ManagedComposeSpec, lesson09ManagedComposeSpec]) {
    const spec = createSpec({ repoRoot: '/repo', secretDirectory: '/repo/.lab/secrets', hostIdentity });
    assert.equal(spec.composeEnvironment.COURSE_HOST_UID, '1001');
    assert.equal(spec.composeEnvironment.COURSE_HOST_GID, '1001');
    assert.deepEqual(spec.publishedPorts, []);
  }
  const directory = await mkdtemp(resolve(tmpdir(), 'course-secret-owner-'));
  try {
    const path = resolve(directory, 'secret');
    await writeFile(path, 'private-test-value', { mode: 0o600 });
    const before = await stat(path);
    const identity = composeSecretReaderIdentity();
    assert.equal(Number(identity.COURSE_HOST_UID), before.uid);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('secret-reader identity rejects root and non-POSIX IDs before starting Docker', () => {
  for (const hostIdentity of [
    { uid: 0, gid: 0 },
    { uid: -1, gid: 1001 },
    { uid: 1001.5, gid: 1001 },
    { uid: '1001', gid: 1001 },
    { uid: null, gid: null },
    { uid: 1001, gid: -1 },
    { uid: 0xffff_ffff, gid: 1001 },
  ]) {
    for (const createSpec of [lesson08ManagedComposeSpec, lesson09ManagedComposeSpec]) {
      assert.throws(
        () => createSpec({ repoRoot: '/repo', secretDirectory: '/repo/.lab/secrets', hostIdentity }),
        (error) => error.reasonCode === 'CONTAINER_HOST_IDENTITY_UNSUPPORTED',
      );
    }
  }
});
