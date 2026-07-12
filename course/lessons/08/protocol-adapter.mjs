const RESOURCE_ID = 'identity-platform-lab';
const ALLOWED_SERVICES = Object.freeze(['app', 'client', 'dc']);
const COMMAND_TIMEOUT_MS = 20_000;
const COMMAND_OUTPUT_LIMIT = 64 * 1024;
const PRINCIPAL = 'alice@AD.EXAMPLE.TEST';

export class Lesson08ProtocolError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson08ProtocolError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson08ProtocolError(reasonCode, message);
}

function assertPassword(password) {
  if (typeof password !== 'string'
      || Buffer.byteLength(password, 'utf8') < 20
      || Buffer.byteLength(password, 'utf8') > 256
      || /[\u0000\r\n]/u.test(password)) {
    throw new TypeError('password does not satisfy the lesson secret boundary');
  }
}

function normalizeResult(value) {
  if (!value || typeof value !== 'object'
      || !Number.isInteger(value.code)
      || value.signal !== null
      || typeof value.stdout !== 'string'
      || typeof value.stderr !== 'string') {
    fail('CONTAINER_COMMAND_RESULT_INVALID', 'container command returned an invalid result');
  }
  return value;
}

function parseJsonLine(stdout, reasonCode) {
  if (Buffer.byteLength(stdout, 'utf8') > COMMAND_OUTPUT_LIMIT) {
    fail(reasonCode, 'container response exceeded the output boundary');
  }
  let value;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    fail(reasonCode, 'container response was not JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(reasonCode, 'container response was invalid');
  }
  return value;
}

export function createLesson08ProtocolAdapter({ executeOwnedService } = {}) {
  if (typeof executeOwnedService !== 'function') throw new TypeError('executeOwnedService is required');

  async function execute(serviceName, argv, {
    stdin = null,
    signal,
    acceptedExitCodes = [0],
  } = {}) {
    if (!ALLOWED_SERVICES.includes(serviceName)) throw new TypeError('serviceName is not allowed');
    if (!Array.isArray(argv) || argv.length === 0 || argv.some((value) => typeof value !== 'string')) {
      throw new TypeError('argv must be a non-empty string array');
    }
    try {
      return normalizeResult(await executeOwnedService({
        resourceId: RESOURCE_ID,
        serviceName,
        argv: Object.freeze([...argv]),
        stdin,
        signal,
        timeoutMs: COMMAND_TIMEOUT_MS,
        maxOutputBytes: COMMAND_OUTPUT_LIMIT,
        acceptedExitCodes,
      }));
    } catch (error) {
      if (error instanceof Lesson08ProtocolError) throw error;
      fail(error?.reasonCode ?? 'CONTAINER_COMMAND_FAILED', 'container command failed');
    }
  }

  async function admin(stage, signal) {
    if (!['reset', 'joiner', 'mover', 'leaver'].includes(stage)) {
      throw new TypeError('admin stage is invalid');
    }
    const result = await execute('dc', ['/usr/local/bin/lesson08-admin', stage], { signal });
    const value = parseJsonLine(result.stdout, 'JML_ADMIN_RESULT_INVALID');
    if (value.stage !== stage || value.applied !== true) {
      fail('JML_ADMIN_RESULT_INVALID', 'JML admin result did not match the requested stage');
    }
    return Object.freeze(value);
  }

  async function app(action, input = {}, signal) {
    const allowed = ['health', 'login', 'policy', 'reset', 'revalidate', 'session', 'write-probe'];
    if (!allowed.includes(action)) throw new TypeError('app action is invalid');
    const stdin = `${JSON.stringify(input)}\n`;
    if (Buffer.byteLength(stdin, 'utf8') > 4096) throw new TypeError('app input is too large');
    const result = await execute('app', ['node', 'client.mjs', action], { stdin, signal });
    const value = parseJsonLine(result.stdout, 'DIRECTORY_APP_RESULT_INVALID');
    if (!Number.isInteger(value.status) || !value.body || typeof value.body !== 'object') {
      fail('DIRECTORY_APP_RESULT_INVALID', 'directory app result was invalid');
    }
    return Object.freeze(value);
  }

  async function login(password, signal) {
    assertPassword(password);
    return app('login', { principal: PRINCIPAL, password }, signal);
  }

  async function wrongPassword(signal) {
    return app('login', {
      principal: PRINCIPAL,
      password: 'not-the-runtime-password-for-lesson-08',
    }, signal);
  }

  async function kerberos(password, signal) {
    assertPassword(password);
    await execute('client', ['kdestroy', '-A'], { signal, acceptedExitCodes: [0, 1] });
    await execute('client', ['kinit', PRINCIPAL], { stdin: `${password}\n`, signal });
    const listed = await execute('client', ['klist'], { signal });
    const canonicalPrincipal = /^Default principal:\s+alice@AD\.EXAMPLE\.TEST$/mu.test(listed.stdout);
    const tgtPresent = /krbtgt\/AD\.EXAMPLE\.TEST@AD\.EXAMPLE\.TEST/mu.test(listed.stdout);
    await execute('client', ['kdestroy', '-A'], { signal, acceptedExitCodes: [0, 1] });
    return Object.freeze({ canonicalPrincipal, tgtPresent });
  }

  return Object.freeze({
    admin,
    health: (signal) => app('health', {}, signal),
    kerberos,
    login,
    policy: (signal) => app('policy', {}, signal),
    resetApp: (signal) => app('reset', {}, signal),
    revalidate: (sessionToken, signal) => app('revalidate', { sessionToken }, signal),
    session: (sessionToken, signal) => app('session', { sessionToken }, signal),
    serviceWriteProbe: (signal) => app('write-probe', {}, signal),
    wrongPassword,
  });
}

export const lesson08ProtocolConstants = Object.freeze({
  resourceId: RESOURCE_ID,
  principal: PRINCIPAL,
  commandTimeoutMs: COMMAND_TIMEOUT_MS,
  commandOutputLimit: COMMAND_OUTPUT_LIMIT,
});
