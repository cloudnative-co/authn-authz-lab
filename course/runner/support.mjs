import { readFile } from 'node:fs/promises';

export class SupportError extends Error {
  constructor(message, { reasonCode = 'PREREQUISITE_SUPPORT_PROFILE' } = {}) {
    super(message);
    this.name = 'SupportError';
    this.reasonCode = reasonCode;
  }
}

export function nodeMajor(version = process.versions.node) {
  const match = /^(\d+)\./.exec(version);
  if (!match) throw new TypeError(`invalid Node.js version: ${version}`);
  return Number(match[1]);
}

async function isWsl(read = readFile) {
  if (process.platform !== 'linux') return false;
  try {
    const release = await read('/proc/sys/kernel/osrelease', 'utf8');
    return /microsoft|wsl/i.test(release);
  } catch {
    return false;
  }
}

export async function detectSupportEnvironment({
  platform = process.platform,
  architecture = process.arch,
  nodeVersion = process.versions.node,
  read = readFile,
  wsl = null,
} = {}) {
  let os;
  if (platform === 'darwin') os = 'macos';
  else if (platform === 'win32') os = 'windows';
  else if (platform === 'linux') os = (wsl ?? await isWsl(read)) ? 'wsl2-linux-filesystem' : 'linux';
  else os = platform;
  return { os, architecture, nodeMajor: nodeMajor(nodeVersion), nodeVersion };
}

export async function inspectSupport({ matrix, environment } = {}) {
  if (!matrix || !Array.isArray(matrix.profiles)) throw new TypeError('support matrix is required');
  const detected = environment ?? await detectSupportEnvironment();
  const matchesContainer = (candidate) => detected.containerEngine === undefined
    || candidate.containerEngine === detected.containerEngine;
  const platformProfile = matrix.profiles.find((candidate) => candidate.os === detected.os
    && candidate.architecture === detected.architecture
    && matchesContainer(candidate)) ?? null;
  const profile = matrix.profiles.find((candidate) => candidate.os === detected.os
    && candidate.architecture === detected.architecture
    && candidate.nodeMajor === detected.nodeMajor
    && matchesContainer(candidate)) ?? null;
  const diagnostics = [
    {
      id: 'node.version',
      status: detected.nodeMajor === 24 ? 'pass' : 'fail',
      actual: `v${detected.nodeVersion}`,
      expected: '24.x',
      message: detected.nodeMajor === 24
        ? '教材の固定Node.jsメジャーバージョンです'
        : 'Node.js 24で実行してください',
    },
    {
      id: 'runtime.platform',
      status: platformProfile?.status === 'candidate' ? 'pass' : (platformProfile ? 'warn' : 'fail'),
      actual: `${detected.os}/${detected.architecture}`,
      expected: 'curriculum/support-matrix.jsonのcandidate profile',
      message: platformProfile
        ? `${platformProfile.id}は${platformProfile.status}です`
        : 'このOS・CPU・Node.jsの組み合わせはsupport matrixにありません',
    },
  ];

  let reasonCode = null;
  if (detected.nodeMajor !== 24) reasonCode = 'PREREQUISITE_NODE_VERSION';
  else if (!platformProfile) reasonCode = 'UNSUPPORTED_SUPPORT_PROFILE';
  else if (platformProfile.os === 'windows') reasonCode = 'UNSUPPORTED_WINDOWS_PROCESS_CONTROL';
  else if (!profile) reasonCode = 'UNSUPPORTED_SUPPORT_PROFILE';
  else if (profile.status !== 'candidate') reasonCode = 'UNSUPPORTED_SUPPORT_PROFILE';
  return { detected, profile, diagnostics, supported: reasonCode === null, reasonCode };
}

export function inspectWslRepositoryPlacement({ environment, repositoryRealpath } = {}) {
  if (environment?.os !== 'wsl2-linux-filesystem') return null;
  if (typeof repositoryRealpath !== 'string' || !repositoryRealpath.startsWith('/')) {
    throw new TypeError('repositoryRealpath must be an absolute POSIX path');
  }
  const windowsMounted = /^\/mnt\/[a-z](?:\/|$)/iu.test(repositoryRealpath);
  return {
    diagnostic: {
      id: 'runtime.wsl-filesystem',
      status: windowsMounted ? 'fail' : 'pass',
      actual: windowsMounted ? 'windows-mounted-filesystem' : 'wsl-linux-filesystem',
      expected: 'WSL2のLinux filesystem（例: ~/src）',
      message: windowsMounted
        ? 'repositoryを/mnt/c等ではなくWSL2のhome配下へcloneしてください'
        : 'repositoryはWSL2のLinux filesystem上にあります',
    },
    supported: !windowsMounted,
    reasonCode: windowsMounted ? 'UNSUPPORTED_WSL_WINDOWS_FILESYSTEM' : null,
  };
}
