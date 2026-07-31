import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectSupportEnvironment,
  inspectLessonRuntimeSupport,
  inspectSupport,
  inspectWslRepositoryPlacement,
  nodeMajor,
} from '../../course/runner/support.mjs';

const matrix = {
  profiles: [
    { id: 'macos-arm64-node24', os: 'macos', architecture: 'arm64', nodeMajor: 24, status: 'candidate' },
    { id: 'macos-arm64-node26', os: 'macos', architecture: 'arm64', nodeMajor: 26, status: 'candidate' },
    { id: 'macos-x64-node26', os: 'macos', architecture: 'x64', nodeMajor: 26, status: 'experimental' },
    { id: 'wsl2-x64-node24', os: 'wsl2-linux-filesystem', architecture: 'x64', nodeMajor: 24, status: 'candidate' },
    { id: 'windows-x64-node24', os: 'windows', architecture: 'x64', nodeMajor: 24, status: 'experimental' },
  ],
};

const lessonContract = {
  manifest: {
    lessons: [
      { id: '04', supportedNodeMajors: [24, 26] },
      { id: '06', supportedNodeMajors: [24] },
    ],
  },
  matrix: {
    profiles: [
      { id: 'macos-arm64-node24', os: 'macos', architecture: 'arm64', nodeMajor: 24, status: 'candidate' },
      { id: 'macos-arm64-node26', os: 'macos', architecture: 'arm64', nodeMajor: 26, status: 'candidate' },
      { id: 'macos-x64-node26', os: 'macos', architecture: 'x64', nodeMajor: 26, status: 'experimental' },
    ],
    lessons: [
      { id: '04', profileIds: ['macos-arm64-node24', 'macos-arm64-node26', 'macos-x64-node26'] },
      { id: '06', profileIds: ['macos-arm64-node24'] },
    ],
  },
};

test('support detection distinguishes macOS, WSL2, and native Windows', async () => {
  assert.deepEqual(await detectSupportEnvironment({
    platform: 'darwin', architecture: 'arm64', nodeVersion: '24.16.0', wsl: false,
  }), { os: 'macos', architecture: 'arm64', nodeMajor: 24, nodeVersion: '24.16.0' });
  assert.equal((await detectSupportEnvironment({
    platform: 'linux', architecture: 'x64', nodeVersion: '24.16.0', wsl: true,
  })).os, 'wsl2-linux-filesystem');
  assert.equal((await detectSupportEnvironment({
    platform: 'win32', architecture: 'x64', nodeVersion: '24.16.0', wsl: false,
  })).os, 'windows');
  assert.equal(nodeMajor('24.16.0'), 24);
  assert.throws(() => nodeMajor('not-a-version'), /invalid Node/);
});

test('support inspection accepts Node 24 and 26 candidate profiles only', async () => {
  const supported = await inspectSupport({
    matrix,
    environment: { os: 'macos', architecture: 'arm64', nodeMajor: 24, nodeVersion: '24.16.0' },
  });
  assert.equal(supported.supported, true);
  assert.equal(supported.profile.id, 'macos-arm64-node24');
  assert.deepEqual(supported.diagnostics.map(({ status }) => status), ['pass', 'pass']);

  const node26 = await inspectSupport({
    matrix,
    environment: { os: 'macos', architecture: 'arm64', nodeMajor: 26, nodeVersion: '26.5.0' },
  });
  assert.equal(node26.supported, true);
  assert.equal(node26.profile.id, 'macos-arm64-node26');

  const wrongNode = await inspectSupport({
    matrix,
    environment: { os: 'macos', architecture: 'arm64', nodeMajor: 25, nodeVersion: '25.1.0' },
  });
  assert.equal(wrongNode.supported, false);
  assert.equal(wrongNode.reasonCode, 'PREREQUISITE_NODE_VERSION');
  assert.deepEqual(wrongNode.diagnostics.map(({ status }) => status), ['fail', 'fail']);

  const experimental = await inspectSupport({
    matrix,
    environment: { os: 'macos', architecture: 'x64', nodeMajor: 26, nodeVersion: '26.5.0' },
  });
  assert.equal(experimental.supported, false);
  assert.equal(experimental.reasonCode, 'UNSUPPORTED_SUPPORT_PROFILE');
  assert.deepEqual(experimental.diagnostics.map(({ status }) => status), ['pass', 'warn']);

  const windows = await inspectSupport({
    matrix,
    environment: { os: 'windows', architecture: 'x64', nodeMajor: 24, nodeVersion: '24.16.0' },
  });
  assert.equal(windows.supported, false);
  assert.equal(windows.reasonCode, 'UNSUPPORTED_WINDOWS_PROCESS_CONTROL');
});

test('lesson runtime support enforces the manifest and assigned profile majors', () => {
  const lesson04 = inspectLessonRuntimeSupport({
    ...lessonContract,
    lessonId: '04',
    environment: { os: 'macos', architecture: 'arm64', nodeMajor: 26 },
  });
  assert.equal(lesson04.supported, true);

  const lesson06 = inspectLessonRuntimeSupport({
    ...lessonContract,
    lessonId: '06',
    environment: { os: 'macos', architecture: 'arm64', nodeMajor: 26 },
  });
  assert.equal(lesson06.supported, false);
  assert.equal(lesson06.reasonCode, 'UNSUPPORTED_LESSON_NODE_VERSION');
  assert.equal(lesson06.diagnostic.status, 'fail');

  const wrongPlatform = inspectLessonRuntimeSupport({
    ...lessonContract,
    lessonId: '04',
    environment: { os: 'linux', architecture: 'x64', nodeMajor: 26 },
  });
  assert.equal(wrongPlatform.supported, false);
  assert.equal(wrongPlatform.reasonCode, 'UNSUPPORTED_LESSON_SUPPORT_PROFILE');

  const experimental = inspectLessonRuntimeSupport({
    ...lessonContract,
    lessonId: '04',
    environment: { os: 'macos', architecture: 'x64', nodeMajor: 26 },
  });
  assert.equal(experimental.supported, false);
  assert.equal(experimental.reasonCode, 'UNSUPPORTED_LESSON_SUPPORT_PROFILE');
  assert.equal(experimental.diagnostic.expected.includes('macos-x64-node26'), false);
});

test('WSL candidate requires the repository on the Linux filesystem', () => {
  const environment = { os: 'wsl2-linux-filesystem' };
  const windowsMount = inspectWslRepositoryPlacement({ environment, repositoryRealpath: '/mnt/c/src/course' });
  assert.equal(windowsMount.supported, false);
  assert.equal(windowsMount.reasonCode, 'UNSUPPORTED_WSL_WINDOWS_FILESYSTEM');
  const linuxHome = inspectWslRepositoryPlacement({ environment, repositoryRealpath: '/home/learner/src/course' });
  assert.equal(linuxHome.supported, true);
  assert.equal(linuxHome.reasonCode, null);
  assert.equal(inspectWslRepositoryPlacement({
    environment: { os: 'linux' },
    repositoryRealpath: '/mnt/c/src/course',
  }), null);
});
