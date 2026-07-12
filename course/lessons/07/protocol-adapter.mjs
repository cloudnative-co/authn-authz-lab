const CLIENT = 'client';
const KDC = 'kdc';
const PRINCIPAL = 'alice@EXAMPLE.TEST';
const TGT = 'krbtgt/EXAMPLE.TEST@EXAMPLE.TEST';
const HTTP_SERVICE = 'HTTP/app.example.test@EXAMPLE.TEST';
const WRONG_SERVICE = 'HTTP/missing.example.test@EXAMPLE.TEST';
const PROTECTED_URL = 'http://app.example.test:3000/kerberos/me';
const DIAGNOSTICS_URL = 'http://app.example.test:3000/__course/diagnostics';
const STATUS_MARKER = '\n__COURSE_HTTP_STATUS__:';
const COMMAND_TIMEOUT_MS = 15_000;
const COMMAND_OUTPUT_LIMIT = 64 * 1024;

export class Lesson07ProtocolError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson07ProtocolError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson07ProtocolError(reasonCode, message);
}

function assertPassword(password) {
  if (typeof password !== 'string'
      || Buffer.byteLength(password, 'utf8') < 12
      || Buffer.byteLength(password, 'utf8') > 256
      || /[\u0000\r\n]/u.test(password)) {
    throw new TypeError('password does not satisfy the lesson secret boundary');
  }
}

function normalizeResult(value) {
  const exited = Number.isInteger(value?.code) && value.signal === null;
  const signaled = value?.code === null && typeof value.signal === 'string';
  if (!value || typeof value !== 'object'
      || (!exited && !signaled)
      || typeof value.stdout !== 'string'
      || typeof value.stderr !== 'string') {
    fail('CONTAINER_COMMAND_RESULT_INVALID', 'container command returned an invalid result');
  }
  return value;
}

function parseHttpResult(stdout) {
  const marker = stdout.lastIndexOf(STATUS_MARKER);
  if (marker < 0) fail('KERBEROS_HTTP_RESULT_INVALID', 'HTTP observation did not contain a status marker');
  const statusText = stdout.slice(marker + STATUS_MARKER.length).trim();
  if (!/^\d{3}$/u.test(statusText)) fail('KERBEROS_HTTP_RESULT_INVALID', 'HTTP status was invalid');
  const bodyText = stdout.slice(0, marker).trim();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    fail('KERBEROS_HTTP_RESULT_INVALID', 'HTTP response body was not JSON');
  }
  return Object.freeze({ status: Number(statusText), body });
}

function parseTicketList(stdout) {
  const serviceLines = stdout.split(/\r?\n/u).map((value) => value.trim());
  const tgt = serviceLines.some((line) => line.endsWith(TGT));
  const httpService = serviceLines.some((line) => line.endsWith(HTTP_SERVICE));
  return Object.freeze({
    principal: serviceLines.some((line) => line === `Default principal: ${PRINCIPAL}`),
    tgt,
    httpService,
    servicePrincipals: Object.freeze([
      ...(tgt ? [TGT] : []),
      ...(httpService ? [HTTP_SERVICE] : []),
    ]),
  });
}

function parseHighestKvno(stdout) {
  const values = stdout.split(/\r?\n/u).map((line) => /^\s*(\d+)\s+HTTP\/app\.example\.test@EXAMPLE\.TEST/u.exec(line)?.[1])
    .filter(Boolean).map(Number);
  if (values.length === 0) fail('KEYTAB_METADATA_INVALID', 'keytab metadata did not contain the service principal');
  return Math.max(...values);
}

export function createLesson07ProtocolAdapter({ executeOwnedService } = {}) {
  if (typeof executeOwnedService !== 'function') throw new TypeError('executeOwnedService is required');

  async function execute(serviceName, argv, { stdin = null, signal, acceptedExitCodes = [0] } = {}) {
    if (![CLIENT, KDC].includes(serviceName)) throw new TypeError('serviceName is not allowed');
    if (!Array.isArray(argv) || argv.length === 0 || argv.some((value) => typeof value !== 'string')) {
      throw new TypeError('argv must be a non-empty string array');
    }
    let result;
    try {
      result = normalizeResult(await executeOwnedService({
        resourceId: 'kerberos-lab',
        serviceName,
        argv: Object.freeze([...argv]),
        stdin,
        signal,
        timeoutMs: COMMAND_TIMEOUT_MS,
        maxOutputBytes: COMMAND_OUTPUT_LIMIT,
        acceptedExitCodes,
      }));
    } catch (error) {
      if (error instanceof Lesson07ProtocolError) throw error;
      fail(error?.reasonCode ?? 'CONTAINER_COMMAND_FAILED', 'container command failed');
    }
    if (!acceptedExitCodes.includes(result.code) || result.signal !== null) {
      fail('CONTAINER_COMMAND_FAILED', 'container command was rejected');
    }
    return result;
  }

  async function destroyTickets(signal) {
    await execute(CLIENT, ['kdestroy', '-A'], { signal, acceptedExitCodes: [0, 1] });
  }

  async function acquireTgt(password, signal) {
    assertPassword(password);
    const result = await execute(CLIENT, ['kinit', PRINCIPAL], {
      stdin: `${password}\n`, signal,
    });
    if (result.code !== 0 || result.signal !== null) fail('KINIT_REJECTED', 'Kerberos initial authentication failed');
  }

  async function listTickets(signal) {
    const result = await execute(CLIENT, ['klist'], { signal });
    return parseTicketList(result.stdout);
  }

  async function inspectCapabilities(signal) {
    const result = await execute(CLIENT, ['curl', '--version'], { signal });
    return Object.freeze({
      curl: /^curl \d+/mu.test(result.stdout),
      gssApi: /^Features:.*\bGSS-API\b/mu.test(result.stdout),
      spnego: /^Features:.*\bSPNEGO\b/mu.test(result.stdout),
    });
  }

  async function unauthenticated(signal) {
    const result = await execute(CLIENT, [
      'curl', '--silent', '--show-error', '--include',
      '--max-time', '10', PROTECTED_URL,
    ], { signal });
    const boundary = result.stdout.indexOf('\r\n\r\n');
    if (boundary < 0) fail('KERBEROS_HTTP_RESULT_INVALID', 'challenge response was invalid');
    const headers = result.stdout.slice(0, boundary);
    const status = Number(/^HTTP\/\S+\s+(\d{3})/mu.exec(headers)?.[1]);
    const challenge = /^www-authenticate:\s*([^\r\n]+)/imu.exec(headers)?.[1]?.trim() ?? null;
    if (!Number.isInteger(status)) fail('KERBEROS_HTTP_RESULT_INVALID', 'challenge response was invalid');
    let body;
    try {
      body = JSON.parse(result.stdout.slice(boundary + 4));
    } catch {
      fail('KERBEROS_HTTP_RESULT_INVALID', 'challenge response body was invalid');
    }
    return Object.freeze({ status, challenge, body });
  }

  async function requestWithNegotiate({ clockOffset = null, signal } = {}) {
    if (clockOffset !== null && clockOffset !== '+10 minutes') {
      throw new TypeError('clockOffset is not allowed');
    }
    const curlArgs = [
      'curl', '--silent', '--show-error', '--negotiate', '--user', ':', '--max-time', '10',
      '--write-out', `${STATUS_MARKER}%{http_code}\n`, PROTECTED_URL,
    ];
    const argv = clockOffset === null ? curlArgs : ['faketime', clockOffset, ...curlArgs];
    const result = await execute(CLIENT, argv, { signal });
    return parseHttpResult(result.stdout);
  }

  async function requestWrongSpn(signal) {
    const result = await execute(CLIENT, ['kvno', WRONG_SERVICE], { signal, acceptedExitCodes: [0, 1] });
    const rejected = result.code !== 0 && result.signal === null;
    const classified = /server.*not found|not found in kerberos database|unknown principal/iu.test(result.stderr);
    return Object.freeze({
      rejected,
      stage: 'TGS',
      reason: rejected && classified ? 'SERVICE_PRINCIPAL_UNKNOWN' : 'TGS_REJECTION_UNCLASSIFIED',
    });
  }

  async function readDiagnostics(signal) {
    const result = await execute(CLIENT, [
      'curl', '--silent', '--show-error', '--max-time', '10', DIAGNOSTICS_URL,
    ], { signal });
    let value;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      fail('KERBEROS_DIAGNOSTICS_INVALID', 'Kerberos diagnostics were not JSON');
    }
    if (value?.schemaVersion !== 1 || typeof value.counters?.lastReason !== 'string') {
      fail('KERBEROS_DIAGNOSTICS_INVALID', 'Kerberos diagnostics were invalid');
    }
    return value;
  }

  async function selectKeytab(role, signal) {
    if (!['current', 'stale'].includes(role)) throw new TypeError('keytab role is invalid');
    await execute(KDC, ['/usr/local/bin/keytab-select', role], { signal });
  }

  async function inspectKeytabOrdering(signal) {
    const current = await execute(KDC, ['klist', '-k', '/keytabs/current.keytab'], { signal });
    const stale = await execute(KDC, ['klist', '-k', '/keytabs/stale.keytab'], { signal });
    return Object.freeze({ currentGreaterThanStale: parseHighestKvno(current.stdout) > parseHighestKvno(stale.stdout) });
  }

  return Object.freeze({
    acquireTgt,
    destroyTickets,
    inspectCapabilities,
    inspectKeytabOrdering,
    listTickets,
    readDiagnostics,
    requestWithNegotiate,
    requestWrongSpn,
    selectKeytab,
    unauthenticated,
  });
}

export const lesson07ProtocolConstants = Object.freeze({
  principal: PRINCIPAL,
  tgt: TGT,
  httpService: HTTP_SERVICE,
  wrongService: WRONG_SERVICE,
  commandTimeoutMs: COMMAND_TIMEOUT_MS,
  commandOutputLimit: COMMAND_OUTPUT_LIMIT,
});
