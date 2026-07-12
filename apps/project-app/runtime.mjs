const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;

function requiredEnvironment(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} is required`);
  return value;
}

function identifier(env, name) {
  const value = requiredEnvironment(env, name);
  if (!IDENTIFIER_PATTERN.test(value)) throw new TypeError(`${name} has an invalid format`);
  return value;
}

export function readProjectAppRuntime(env = process.env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('env must be an object');
  const installId = identifier(env, 'COURSE_INSTALL_ID');
  const runId = identifier(env, 'COURSE_RUN_ID');
  const instanceId = requiredEnvironment(env, 'COURSE_PROCESS_INSTANCE_ID');
  if (instanceId !== `${installId}.${runId}`) throw new TypeError('COURSE_PROCESS_INSTANCE_ID is inconsistent');

  const origin = new URL(requiredEnvironment(env, 'COURSE_PROCESS_ORIGIN'));
  if (
    origin.protocol !== 'http:'
    || !['127.0.0.1', '[::1]'].includes(origin.hostname)
    || !origin.port
    || origin.username
    || origin.password
    || origin.pathname !== '/'
    || origin.search
    || origin.hash
  ) {
    throw new TypeError('COURSE_PROCESS_ORIGIN must be an origin-only loopback HTTP URL');
  }
  const port = Number(origin.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('COURSE_PROCESS_ORIGIN has an invalid port');
  }

  const shutdownToken = requiredEnvironment(env, 'COURSE_PROCESS_SHUTDOWN_TOKEN');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(shutdownToken)
      || Buffer.from(shutdownToken, 'base64url').length !== 32
      || Buffer.from(shutdownToken, 'base64url').toString('base64url') !== shutdownToken) {
    throw new TypeError('COURSE_PROCESS_SHUTDOWN_TOKEN has an invalid format');
  }

  const lesson06Names = [
    'LESSON06_LDAP_URL',
    'LESSON06_LDAP_BASE_DN',
    'LESSON06_LDAP_PEOPLE_BASE_DN',
    'LESSON06_LDAP_GROUPS_BASE_DN',
    'LESSON06_LDAP_BIND_DN',
    'LESSON06_LDAP_BIND_PASSWORD_FILE',
  ];
  const configured = lesson06Names.filter((name) => typeof env[name] === 'string' && env[name].length > 0);
  let lesson06Directory = null;
  if (configured.length > 0) {
    if (configured.length !== lesson06Names.length) throw new TypeError('Lesson 06 LDAP environment is incomplete');
    const ldapUrl = new URL(env.LESSON06_LDAP_URL);
    if (ldapUrl.protocol !== 'ldap:'
        || ldapUrl.hostname !== '127.0.0.1'
        || !ldapUrl.port
        || ldapUrl.username
        || ldapUrl.password
        || !['', '/'].includes(ldapUrl.pathname)
        || ldapUrl.search
        || ldapUrl.hash) {
      throw new TypeError('LESSON06_LDAP_URL must be an exact loopback LDAP URL');
    }
    for (const name of [
      'LESSON06_LDAP_BASE_DN',
      'LESSON06_LDAP_PEOPLE_BASE_DN',
      'LESSON06_LDAP_GROUPS_BASE_DN',
      'LESSON06_LDAP_BIND_DN',
    ]) {
      if (env[name].length > 512 || /[\u0000\r\n]/u.test(env[name])) {
        throw new TypeError(`${name} is invalid`);
      }
    }
    const managedStateRoot = resolve(requiredEnvironment(env, 'COURSE_MANAGED_STATE_ROOT'));
    const bindPasswordFile = resolve(env.LESSON06_LDAP_BIND_PASSWORD_FILE);
    const fromState = relative(managedStateRoot, bindPasswordFile);
    if (!isAbsolute(managedStateRoot)
        || isAbsolute(fromState)
        || fromState === '..'
        || fromState.startsWith(`..${sep}`)
        || fromState !== `containers${sep}ldap-directory${sep}service-password`) {
      throw new TypeError('LESSON06_LDAP_BIND_PASSWORD_FILE must be the managed Lesson 06 secret');
    }
    lesson06Directory = Object.freeze({
      url: ldapUrl.href,
      baseDn: env.LESSON06_LDAP_BASE_DN,
      peopleBaseDn: env.LESSON06_LDAP_PEOPLE_BASE_DN,
      groupsBaseDn: env.LESSON06_LDAP_GROUPS_BASE_DN,
      bindDn: env.LESSON06_LDAP_BIND_DN,
      bindPasswordFile,
      managedStateRoot,
    });
  }

  return {
    identity: { pid: process.pid, instanceId, installId, runId },
    listen: { host: origin.hostname === '[::1]' ? '::1' : origin.hostname, port },
    shutdownToken,
    lesson06Directory,
  };
}
import { isAbsolute, relative, resolve, sep } from 'node:path';
