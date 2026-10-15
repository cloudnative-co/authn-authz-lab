import { ManagedComposeError } from '../../runner/managed-compose-command.mjs';

export function composeSecretReaderIdentity({
  uid = process.getuid?.(),
  gid = process.getgid?.(),
} = {}) {
  if (!Number.isSafeInteger(uid) || uid <= 0 || uid > 0xffff_fffe
      || !Number.isSafeInteger(gid) || gid < 0 || gid > 0xffff_fffe) {
    throw new ManagedComposeError(
      'CONTAINER_HOST_IDENTITY_UNSUPPORTED',
      'file-backed secrets require a non-root POSIX user',
    );
  }
  return Object.freeze({ COURSE_HOST_UID: String(uid), COURSE_HOST_GID: String(gid) });
}
