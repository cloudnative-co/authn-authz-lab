export const LESSON_08_SUCCESSFUL_LOGIN_OPERATIONS = Object.freeze([
  'service-bind',
  'structured-user-search',
  'resolved-user-bind',
  'structured-group-search',
  'explicit-group-to-role-mapping',
]);

export function validLesson08Principal(value) {
  return typeof value === 'string'
    && value.length >= 6
    && value.length <= 128
    && /^[a-z0-9._-]+@ad\.example\.test$/iu.test(value);
}

export function validLesson08Password(value) {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= 1
    && Buffer.byteLength(value, 'utf8') <= 256
    && !/[\u0000\r\n]/u.test(value);
}

export async function authenticateDirectoryLogin({
  principal,
  password,
  bindService,
  searchUser,
  bindResolvedUser,
  searchGroups,
  mapRoles,
} = {}) {
  const operations = [];
  if (!validLesson08Principal(principal) || !validLesson08Password(password)) {
    return Object.freeze({ authenticated: false, operations: Object.freeze(operations) });
  }
  if (
    typeof bindService !== 'function'
    || typeof searchUser !== 'function'
    || typeof bindResolvedUser !== 'function'
    || typeof searchGroups !== 'function'
    || typeof mapRoles !== 'function'
  ) {
    throw new TypeError('directory login operations are required');
  }

  try {
    await bindService();
    operations.push('service-bind');

    const user = await searchUser(principal);
    operations.push('structured-user-search');
    if (!user || user.disabled) {
      return Object.freeze({ authenticated: false, operations: Object.freeze(operations) });
    }

    await bindResolvedUser(user.dn, password);
    operations.push('resolved-user-bind');

    const groups = await searchGroups(user.dn);
    operations.push('structured-group-search');
    const roles = mapRoles(groups);
    operations.push('explicit-group-to-role-mapping');

    return Object.freeze({
      authenticated: true,
      operations: Object.freeze(operations),
      state: Object.freeze({ ...user, groups, roles }),
    });
  } catch {
    return Object.freeze({ authenticated: false, operations: Object.freeze(operations) });
  }
}
