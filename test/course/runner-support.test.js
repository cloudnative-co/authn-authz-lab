import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectSupportEnvironment,
  inspectSupport,
  inspectWslRepositoryPlacement,
  nodeMajor,
} from '../../course/runner/support.mjs';

const matrix = {
  profiles: [
    { id: 'macos-arm64-node24', os: 'macos', architecture: 'arm64', nodeMajor: 24, status: 'candidate' },
    { id: 'wsl2-x64-node24', os: 'wsl2-linux-filesystem', architecture: 'x64', nodeMajor: 24, status: 'candidate' },
    { id: 'windows-x64-node24', os: 'windows', architecture: 'x64', nodeMajor: 24, status: 'experimental' },
  ],
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

test('support inspection accepts only the Node 24 candidate profile', async () => {
  const supported = await inspectSupport({
    matrix,
    environment: { os: 'macos', architecture: 'arm64', nodeMajor: 24, nodeVersion: '24.16.0' },
  });
  assert.equal(supported.supported, true);
  assert.equal(supported.profile.id, 'macos-arm64-node24');
  assert.deepEqual(supported.diagnostics.map(({ status }) => status), ['pass', 'pass']);

  const wrongNode = await inspectSupport({
    matrix,
    environment: { os: 'macos', architecture: 'arm64', nodeMajor: 26, nodeVersion: '26.5.0' },
  });
  assert.equal(wrongNode.supported, false);
  assert.equal(wrongNode.reasonCode, 'PREREQUISITE_NODE_VERSION');
  assert.deepEqual(wrongNode.diagnostics.map(({ status }) => status), ['fail', 'pass']);

  const windows = await inspectSupport({
    matrix,
    environment: { os: 'windows', architecture: 'x64', nodeMajor: 24, nodeVersion: '24.16.0' },
  });
  assert.equal(windows.supported, false);
  assert.equal(windows.reasonCode, 'UNSUPPORTED_WINDOWS_PROCESS_CONTROL');
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
