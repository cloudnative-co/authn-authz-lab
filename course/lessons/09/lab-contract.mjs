import { isAbsolute, relative, sep } from 'node:path';

export const LESSON_09_RESOURCE_ID = 'saml-lab';
export const LESSON_09_SERVICES = Object.freeze(['keycloak', 'sp', 'user-agent']);

export function lesson09ManagedComposeSpec({ secretDirectory, repoRoot } = {}) {
  if (typeof secretDirectory !== 'string' || !isAbsolute(secretDirectory)
      || typeof repoRoot !== 'string' || !isAbsolute(repoRoot)) {
    throw new TypeError('secretDirectory and repoRoot must be absolute paths');
  }
  const fromRoot = relative(repoRoot, secretDirectory);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new TypeError('secretDirectory must be inside repoRoot');
  }
  return Object.freeze({
    resourceId: LESSON_09_RESOURCE_ID,
    composeFile: 'docker/saml/compose.yml',
    buildServices: Object.freeze(['keycloak', 'sp', 'user-agent']),
    targetServices: Object.freeze(['user-agent']),
    expectedServices: LESSON_09_SERVICES,
    expectedNetworks: Object.freeze(['default']),
    expectedVolumes: Object.freeze([]),
    noDependencies: false,
    publishedPorts: Object.freeze([]),
    composeEnvironment: Object.freeze({ LESSON09_SECRET_DIR: secretDirectory }),
    supplementalFiles: Object.freeze(['control-token', 'user-password']),
  });
}
