import { isAbsolute, relative, sep } from 'node:path';

export const LESSON_08_RESOURCE_ID = 'identity-platform-lab';
export const LESSON_08_SERVICES = Object.freeze(['app', 'client', 'dc']);
export const LESSON_08_SECRET_FILES = Object.freeze([
  'admin-password',
  'alice-password',
  'control-token',
  'service-password',
  'stable-id-key',
]);

export function lesson08ManagedComposeSpec({ secretDirectory, repoRoot } = {}) {
  if (typeof secretDirectory !== 'string' || !isAbsolute(secretDirectory)
      || typeof repoRoot !== 'string' || !isAbsolute(repoRoot)) {
    throw new TypeError('secretDirectory and repoRoot must be absolute paths');
  }
  const fromRoot = relative(repoRoot, secretDirectory);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new TypeError('secretDirectory must be inside repoRoot');
  }
  return Object.freeze({
    resourceId: LESSON_08_RESOURCE_ID,
    composeFile: 'docker/samba-ad/compose.yml',
    buildServices: LESSON_08_SERVICES,
    targetServices: Object.freeze(['client']),
    expectedServices: LESSON_08_SERVICES,
    expectedNetworks: Object.freeze(['default']),
    expectedVolumes: Object.freeze([
      'lesson08_ca_public',
      'lesson08_directory_data',
      'lesson08_samba_tls',
    ]),
    noDependencies: false,
    publishedPorts: Object.freeze([]),
    composeEnvironment: Object.freeze({ LESSON08_SECRET_DIR: secretDirectory }),
    supplementalFiles: LESSON_08_SECRET_FILES,
  });
}
