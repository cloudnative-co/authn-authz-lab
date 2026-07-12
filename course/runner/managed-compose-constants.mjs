export const RECORD_SCHEMA = 'curriculum/schemas/managed-compose-service.schema.json';
export const RECORD_FILE = 'record.json';
export const CONTAINERS_DIRECTORY = 'containers';
export const MAX_DEFAULT_OUTPUT_BYTES = 1024 * 1024;
export const SAFE_RESOURCE_ID = /^[a-z][a-z0-9-]{2,63}$/u;
export const SAFE_SERVICE_NAME = /^[a-z][a-z0-9-]{0,62}$/u;
export const SAFE_SUPPLEMENTAL_FILE = /^[a-z][a-z0-9-]{0,62}$/u;
export const TEMPORARY_FILE = /^\.[0-9a-f-]{32,36}\.tmp$/u;

export const LABELS = Object.freeze({
  courseId: 'io.cloudnative.course.id',
  installId: 'io.cloudnative.course.install-id',
  resourceId: 'io.cloudnative.course.resource-id',
  composeProject: 'com.docker.compose.project',
  composeService: 'com.docker.compose.service',
  composeConfigHash: 'com.docker.compose.config-hash',
  composeNetwork: 'com.docker.compose.network',
  composeVolume: 'com.docker.compose.volume',
});
