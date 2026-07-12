import { isAbsolute, relative, sep } from 'node:path';

export const LESSON_07_RESOURCE_ID = 'kerberos-lab';
export const LESSON_07_SERVICES = Object.freeze(['app', 'client', 'kdc']);

export function lesson07ManagedComposeSpec({ secretDirectory, repoRoot } = {}) {
  if (typeof secretDirectory !== 'string' || !isAbsolute(secretDirectory)
      || typeof repoRoot !== 'string' || !isAbsolute(repoRoot)) {
    throw new TypeError('secretDirectory and repoRoot must be absolute paths');
  }
  const fromRoot = relative(repoRoot, secretDirectory);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new TypeError('secretDirectory must be inside repoRoot');
  }
  return Object.freeze({
    resourceId: LESSON_07_RESOURCE_ID,
    composeFile: 'docker/kerberos/compose.yml',
    buildServices: Object.freeze(['kdc', 'app', 'client']),
    targetServices: Object.freeze(['client']),
    expectedServices: LESSON_07_SERVICES,
    expectedNetworks: Object.freeze(['default']),
    expectedVolumes: Object.freeze(['lesson07_keytabs']),
    noDependencies: false,
    publishedPorts: Object.freeze([]),
    composeEnvironment: Object.freeze({ LESSON07_SECRET_DIR: secretDirectory }),
    supplementalFiles: Object.freeze(['alice-password', 'kdc-master-password']),
  });
}
