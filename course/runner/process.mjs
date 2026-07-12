import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile, readlink, realpath } from 'node:fs/promises';
import { release as osRelease } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]']);
const PS_ENV = Object.freeze({ LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin' });
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

export class ProcessControlError extends Error {
  constructor(reasonCode, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'ProcessControlError';
    this.reasonCode = reasonCode;
  }
}

export function detectProcessPlatform({
  platform = process.platform,
  release = osRelease(),
  env = process.env,
} = {}) {
  if (platform === 'darwin') return { status: 'supported', profile: 'macos' };
  if (platform === 'linux') {
    const wsl = /microsoft/i.test(release) || Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
    return { status: 'supported', profile: wsl ? 'wsl' : 'linux' };
  }
  if (platform === 'win32') {
    return {
      status: 'unsupported',
      reasonCode: 'UNSUPPORTED_WINDOWS_NATIVE',
      message: 'native Windows process ownership is unsupported; use WSL',
    };
  }
  return {
    status: 'unsupported',
    reasonCode: 'UNSUPPORTED_PLATFORM',
    message: `process ownership is unsupported on ${platform}`,
  };
}

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
}

function assertAbortSignal(signal) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError('signal must be an AbortSignal');
  }
}

function abortError(signal, fallbackReasonCode = 'OPERATION_ABORTED') {
  if (signal?.reason instanceof ProcessControlError) return signal.reason;
  return new ProcessControlError(fallbackReasonCode, 'process operation was aborted', {
    cause: signal?.reason instanceof Error ? signal.reason : undefined,
  });
}

export function createCleanupScope({ timeoutMs = null, signal } = {}) {
  assertAbortSignal(signal);
  if (timeoutMs !== null) assertPositiveInteger(timeoutMs, 'timeoutMs');

  const controller = new AbortController();
  let timedOut = false;
  let cleaned = false;
  let timer = null;
  const onAbort = () => controller.abort(abortError(signal));

  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  if (timeoutMs !== null && !controller.signal.aborted) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new ProcessControlError('OPERATION_TIMEOUT', `operation exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref?.();
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

export function abortableDelay(delayMs, { signal } = {}) {
  assertPositiveInteger(delayMs, 'delayMs');
  assertAbortSignal(signal);
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(abortError(signal));
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      rejectPromise(abortError(signal));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolvePromise();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function normalizeOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (error) {
    throw new TypeError('origin must be an absolute loopback HTTP URL', { cause: error });
  }
  if (
    parsed.protocol !== 'http:'
    || !LOOPBACK_HOSTS.has(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || !parsed.port
  ) {
    throw new TypeError('origin must be an origin-only HTTP URL using 127.0.0.1 or ::1 and an explicit port');
  }
  return parsed.origin;
}

function endpoint(origin, path) {
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9/_-]*$/.test(path)) {
    throw new TypeError('endpoint path must be an absolute path without query or fragment');
  }
  const url = new URL(path, `${origin}/`);
  if (url.origin !== origin) throw new TypeError('endpoint must retain the recorded loopback origin');
  return url;
}

function assertIdentifier(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(value)) {
    throw new TypeError(`${name} must contain 3-128 URL-safe characters`);
  }
}

function composeInstanceId(installId, runId) {
  assertIdentifier(installId, 'installId');
  assertIdentifier(runId, 'runId');
  return `${installId}.${runId}`;
}

function splitInstanceId(instanceId) {
  if (typeof instanceId !== 'string') throw new TypeError('instanceId must be a string');
  const separator = instanceId.indexOf('.');
  if (separator <= 0 || instanceId.indexOf('.', separator + 1) !== -1) {
    throw new TypeError('instanceId must encode installId and runId');
  }
  const installId = instanceId.slice(0, separator);
  const runId = instanceId.slice(separator + 1);
  assertIdentifier(installId, 'installId');
  assertIdentifier(runId, 'runId');
  return { installId, runId };
}

function assertRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('record must be an object');
  assertPositiveInteger(record.pid, 'record.pid');
  splitInstanceId(record.instanceId);
  normalizeOrigin(record.origin);
  if (typeof record.startFingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(record.startFingerprint)) {
    throw new TypeError('record.startFingerprint must be a SHA-256 fingerprint');
  }
}

async function readDarwinPsField(pid, field) {
  try {
    const { stdout } = await execFileAsync('/bin/ps', ['-ww', '-p', String(pid), '-o', `${field}=`], {
      encoding: 'utf8',
      env: PS_ENV,
      maxBuffer: 64 * 1024,
      timeout: 2_000,
    });
    return stdout.trim();
  } catch (error) {
    if (error.code === 1) return null;
    throw new ProcessControlError('FINGERPRINT_UNAVAILABLE', `could not inspect pid ${pid}`, { cause: error });
  }
}

async function darwinProcessMaterial(pid) {
  const startedBefore = await readDarwinPsField(pid, 'lstart');
  if (!startedBefore) return null;
  const executable = await readDarwinPsField(pid, 'comm');
  const command = await readDarwinPsField(pid, 'command');
  const startedAfter = await readDarwinPsField(pid, 'lstart');
  if (!executable || !command || !startedAfter) return null;
  if (startedBefore !== startedAfter) {
    throw new ProcessControlError('FINGERPRINT_RACE', `pid ${pid} changed while it was inspected`);
  }
  return { profile: 'macos', startedAt: startedBefore, executable, arguments: command };
}

async function linuxProcessMaterial(pid, profile) {
  try {
    const [stat, bootId, executable, commandLine] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      readlink(`/proc/${pid}/exe`),
      readFile(`/proc/${pid}/cmdline`),
    ]);
    const close = stat.lastIndexOf(')');
    const fields = close === -1 ? [] : stat.slice(close + 2).trim().split(/\s+/);
    const startedAt = fields[19];
    if (!startedAt) throw new Error('missing Linux starttime field');
    const argv = commandLine.toString('utf8').split('\0').filter(Boolean);
    if (argv.length === 0) throw new Error('empty Linux command line');
    return {
      profile,
      startedAt: `${bootId.trim()}:${startedAt}`,
      executable,
      arguments: argv,
    };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw new ProcessControlError('FINGERPRINT_UNAVAILABLE', `could not inspect pid ${pid}`, { cause: error });
  }
}

export async function captureProcessStartFingerprint(pid, {
  instanceId,
  platformSupport = detectProcessPlatform(),
} = {}) {
  assertPositiveInteger(pid, 'pid');
  splitInstanceId(instanceId);
  if (platformSupport.status !== 'supported') {
    throw new ProcessControlError(platformSupport.reasonCode, platformSupport.message);
  }
  const material = platformSupport.profile === 'macos'
    ? await darwinProcessMaterial(pid)
    : await linuxProcessMaterial(pid, platformSupport.profile);
  if (material === null) return null;
  const serialized = JSON.stringify({ ...material, instanceId });
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

async function fingerprintMatch(record, platformSupport) {
  try {
    const current = await captureProcessStartFingerprint(record.pid, {
      instanceId: record.instanceId,
      platformSupport,
    });
    if (current === null) return { status: 'gone' };
    if (current !== record.startFingerprint) return { status: 'mismatch' };
    return { status: 'match' };
  } catch (error) {
    return { status: 'unverifiable', error };
  }
}

async function boundedJson(response) {
  const maximumBytes = 16_384;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ProcessControlError('HEALTH_INVALID_RESPONSE', 'health response is too large');
  }
  const chunks = [];
  let receivedBytes = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        if (receivedBytes > maximumBytes) {
          await reader.cancel().catch(() => {});
          throw new ProcessControlError('HEALTH_INVALID_RESPONSE', 'health response is too large');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
  }
  const body = Buffer.concat(chunks, receivedBytes).toString('utf8');
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new ProcessControlError('HEALTH_INVALID_RESPONSE', 'health response is not JSON', { cause: error });
  }
}

export async function verifyHealthIdentity({
  record,
  healthPath = '/__course/health',
  timeoutMs = 500,
  signal,
} = {}) {
  assertRecord(record);
  assertPositiveInteger(timeoutMs, 'timeoutMs');
  const { installId, runId } = splitInstanceId(record.instanceId);
  const scope = createCleanupScope({ timeoutMs, signal });
  try {
    const response = await fetch(endpoint(record.origin, healthPath), {
      method: 'GET',
      redirect: 'error',
      signal: scope.signal,
      headers: { accept: 'application/json', connection: 'close' },
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      throw new ProcessControlError('HEALTH_INVALID_RESPONSE', `health endpoint returned HTTP ${response.status}`);
    }
    const identity = await boundedJson(response);
    if (
      identity?.pid !== record.pid
      || identity?.instanceId !== record.instanceId
      || identity?.installId !== installId
      || identity?.runId !== runId
    ) {
      throw new ProcessControlError('HEALTH_IDENTITY_MISMATCH', 'health identity does not match the owned process');
    }
    return { status: 'verified', identity };
  } catch (error) {
    if (scope.signal.aborted) {
      throw new ProcessControlError(scope.timedOut ? 'HEALTH_TIMEOUT' : 'OPERATION_ABORTED',
        scope.timedOut ? 'health request timed out' : 'health request was aborted', { cause: error });
    }
    if (error instanceof ProcessControlError) throw error;
    throw new ProcessControlError('HEALTH_UNREACHABLE', 'health endpoint could not be reached', { cause: error });
  } finally {
    scope.cleanup();
  }
}

async function waitForHealth({ record, healthPath, timeoutMs, retryIntervalMs, signal, child }) {
  const scope = createCleanupScope({ timeoutMs, signal });
  try {
    while (true) {
      if (child.exitCode !== null) {
        throw new ProcessControlError('PROCESS_EXITED_EARLY', `child exited with code ${child.exitCode}`);
      }
      try {
        return await verifyHealthIdentity({
          record,
          healthPath,
          timeoutMs: Math.min(250, timeoutMs),
          signal: scope.signal,
        });
      } catch (error) {
        if (scope.signal.aborted) throw abortError(scope.signal);
        if (!['HEALTH_UNREACHABLE', 'HEALTH_TIMEOUT'].includes(error.reasonCode)) throw error;
      }
      await abortableDelay(retryIntervalMs, { signal: scope.signal });
    }
  } catch (error) {
    if (scope.timedOut || (scope.signal.aborted && scope.signal.reason?.reasonCode === 'OPERATION_TIMEOUT')) {
      throw new ProcessControlError('HEALTH_TIMEOUT', `health identity was not verified within ${timeoutMs} ms`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    scope.cleanup();
  }
}

function assertExplicitEnvironment(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('env must be an explicit object');
  for (const [name, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== 'string') {
      throw new TypeError('env names must be valid and every value must be a string');
    }
  }
}

function pathInside(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

async function ensureSafeLogDirectory(anchor, directory) {
  if (!pathInside(anchor, directory)) {
    throw new ProcessControlError('PROCESS_UNSAFE_LOG_PATH', 'log path escapes the child working directory');
  }
  let current = anchor;
  for (const segment of relative(anchor, directory).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
      stats = await lstat(current);
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new ProcessControlError('PROCESS_UNSAFE_LOG_PATH', 'log directory contains an unsafe path component');
    }
  }
}

async function openPrivateLog(path, anchor) {
  const absolutePath = resolve(path);
  await ensureSafeLogDirectory(anchor, dirname(absolutePath));
  let handle;
  try {
    handle = await open(
      absolutePath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | O_NOFOLLOW,
      0o600,
    );
    const stats = await handle.stat();
    if (!stats.isFile() || stats.nlink !== 1) {
      throw new ProcessControlError('PROCESS_UNSAFE_LOG_PATH', 'log target is not a new regular file');
    }
    return handle;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof ProcessControlError) throw error;
    throw new ProcessControlError('PROCESS_UNSAFE_LOG_PATH', 'log file must be new and must not be a symlink', {
      cause: error,
    });
  }
}

async function waitForSpawn(child) {
  await new Promise((resolvePromise, rejectPromise) => {
    const onSpawn = () => {
      child.off('error', onError);
      resolvePromise();
    };
    const onError = (error) => {
      child.off('spawn', onSpawn);
      rejectPromise(error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

async function waitForChildHandleExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolvePromise) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
    };
    const onExit = () => {
      cleanup();
      resolvePromise(true);
    };
    timer = setTimeout(() => {
      cleanup();
      resolvePromise(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

async function rollbackSpawnTransaction(child) {
  if (await waitForChildHandleExit(child, 1)) return { status: 'exited' };
  child.kill('SIGTERM');
  if (await waitForChildHandleExit(child, 1_000)) return { status: 'exited', method: 'child-handle-sigterm' };
  child.kill('SIGKILL');
  if (await waitForChildHandleExit(child, 1_000)) return { status: 'exited', method: 'child-handle-sigkill' };
  return { status: 'timeout', reasonCode: 'SPAWN_ROLLBACK_TIMEOUT' };
}

export async function waitForOwnedProcessExit({
  record,
  timeoutMs = 2_000,
  retryIntervalMs = 25,
  signal,
  platformSupport = detectProcessPlatform(),
} = {}) {
  if (platformSupport.status !== 'supported') return platformSupport;
  assertRecord(record);
  const scope = createCleanupScope({ timeoutMs, signal });
  try {
    while (!scope.signal.aborted) {
      const matched = await fingerprintMatch(record, platformSupport);
      if (matched.status === 'gone') return { status: 'exited' };
      if (matched.status === 'mismatch') return { status: 'exited', reasonCode: 'PID_REUSED' };
      if (matched.status === 'unverifiable') {
        return { status: 'blocked', reasonCode: 'PROCESS_FINGERPRINT_UNVERIFIABLE' };
      }
      await abortableDelay(retryIntervalMs, { signal: scope.signal });
    }
  } catch (error) {
    if (!scope.timedOut) throw error;
  } finally {
    scope.cleanup();
  }
  return { status: 'timeout', reasonCode: 'PROCESS_EXIT_TIMEOUT' };
}

export async function startOwnedNode({
  scriptPath,
  args = [],
  cwd,
  env,
  origin,
  installId,
  runId = randomUUID(),
  shutdownToken: suppliedShutdownToken,
  stdoutPath,
  stderrPath,
  healthPath = '/__course/health',
  timeoutMs = 5_000,
  retryIntervalMs = 50,
  signal,
  platformSupport = detectProcessPlatform(),
  fingerprintCapture = captureProcessStartFingerprint,
  onOwnedSpawn,
} = {}) {
  if (platformSupport.status !== 'supported') return platformSupport;
  if (typeof scriptPath !== 'string' || !scriptPath) throw new TypeError('scriptPath is required');
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    throw new TypeError('args must be an array of strings');
  }
  if (typeof cwd !== 'string' || !cwd) throw new TypeError('cwd is required');
  if (typeof stdoutPath !== 'string' || !stdoutPath || typeof stderrPath !== 'string' || !stderrPath) {
    throw new TypeError('stdoutPath and stderrPath are required');
  }
  assertExplicitEnvironment(env);
  if (onOwnedSpawn !== undefined && typeof onOwnedSpawn !== 'function') {
    throw new TypeError('onOwnedSpawn must be a function');
  }
  assertAbortSignal(signal);
  assertPositiveInteger(timeoutMs, 'timeoutMs');
  assertPositiveInteger(retryIntervalMs, 'retryIntervalMs');
  const normalizedOrigin = normalizeOrigin(origin);
  const instanceId = composeInstanceId(installId, runId);
  const shutdownToken = suppliedShutdownToken ?? randomBytes(32).toString('base64url');
  if (!/^[A-Za-z0-9_-]{43}$/.test(shutdownToken)
      || Buffer.from(shutdownToken, 'base64url').length !== 32
      || Buffer.from(shutdownToken, 'base64url').toString('base64url') !== shutdownToken) {
    throw new TypeError('shutdownToken must be a canonical 256-bit base64url value');
  }
  const requestedCwd = resolve(cwd);
  const canonicalCwd = await realpath(cwd);
  const requestedLogs = [resolve(stdoutPath), resolve(stderrPath)];
  if (requestedLogs.some((path) => !pathInside(requestedCwd, path))) {
    throw new ProcessControlError('PROCESS_UNSAFE_LOG_PATH', 'log path escapes the child working directory');
  }
  const logs = requestedLogs.map((path) => resolve(canonicalCwd, relative(requestedCwd, path)));
  if (logs[0] === logs[1]) throw new TypeError('stdoutPath and stderrPath must be different files');
  let stdout;
  let stderr;
  try {
    stdout = await openPrivateLog(logs[0], canonicalCwd);
    stderr = await openPrivateLog(logs[1], canonicalCwd);
  } catch (error) {
    await stdout?.close();
    throw error;
  }
  let child;
  try {
    child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: canonicalCwd,
      env: {
        ...env,
        COURSE_INSTALL_ID: installId,
        COURSE_RUN_ID: runId,
        COURSE_PROCESS_INSTANCE_ID: instanceId,
        COURSE_PROCESS_ORIGIN: normalizedOrigin,
        COURSE_PROCESS_SHUTDOWN_TOKEN: shutdownToken,
      },
      shell: false,
      stdio: ['ignore', stdout.fd, stderr.fd],
      windowsHide: true,
    });
    await waitForSpawn(child);
  } finally {
    await Promise.all([stdout.close(), stderr.close()]);
  }

  let startFingerprint;
  try {
    startFingerprint = await fingerprintCapture(child.pid, { instanceId, platformSupport });
    if (startFingerprint === null) {
      throw new ProcessControlError('PROCESS_EXITED_EARLY', 'child exited before ownership could be recorded');
    }
  } catch (error) {
    error.cleanup = await rollbackSpawnTransaction(child);
    throw error;
  }
  const record = Object.freeze({
    pid: child.pid,
    instanceId,
    origin: normalizedOrigin,
    startFingerprint,
  });

  try {
    await onOwnedSpawn?.({
      record,
      child,
      shutdownToken,
      stdoutPath: logs[0],
      stderrPath: logs[1],
    });
    await waitForHealth({ record, healthPath, timeoutMs, retryIntervalMs, signal, child });
    return { status: 'started', record, shutdownToken, child, stdoutPath: logs[0], stderrPath: logs[1] };
  } catch (error) {
    error.cleanup = await rollbackSpawnTransaction(child);
    throw error;
  }
}

async function requestAuthenticatedShutdown({ record, shutdownToken, shutdownPath, timeoutMs, signal }) {
  if (typeof shutdownToken !== 'string' || shutdownToken.length < 32) {
    throw new TypeError('shutdownToken is required');
  }
  const scope = createCleanupScope({ timeoutMs, signal });
  try {
    const response = await fetch(endpoint(record.origin, shutdownPath), {
      method: 'POST',
      redirect: 'error',
      signal: scope.signal,
      headers: {
        connection: 'close',
        'content-length': '0',
        'x-course-control-token': shutdownToken,
        'x-course-instance-id': record.instanceId,
      },
    });
    if (![200, 202, 204].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      throw new ProcessControlError('SHUTDOWN_REJECTED', `shutdown endpoint returned HTTP ${response.status}`);
    }
    if (response.headers.get('x-course-instance-id') !== record.instanceId) {
      await response.body?.cancel().catch(() => {});
      throw new ProcessControlError('SHUTDOWN_IDENTITY_MISMATCH', 'shutdown response identity did not match');
    }
    await response.body?.cancel().catch(() => {});
    return { status: 'accepted' };
  } catch (error) {
    if (scope.signal.aborted) {
      throw new ProcessControlError(scope.timedOut ? 'SHUTDOWN_TIMEOUT' : 'OPERATION_ABORTED',
        scope.timedOut ? 'shutdown request timed out' : 'shutdown request was aborted', { cause: error });
    }
    if (error instanceof ProcessControlError) throw error;
    throw new ProcessControlError('SHUTDOWN_UNREACHABLE', 'shutdown endpoint could not be reached', { cause: error });
  } finally {
    scope.cleanup();
  }
}

export async function stopOwnedProcess({
  record,
  shutdownToken,
  healthPath = '/__course/health',
  shutdownPath = '/__course/shutdown',
  timeoutMs = 3_000,
  signal,
  platformSupport = detectProcessPlatform(),
} = {}) {
  if (platformSupport.status !== 'supported') return platformSupport;
  assertRecord(record);
  assertAbortSignal(signal);
  assertPositiveInteger(timeoutMs, 'timeoutMs');

  const beforeHealth = await fingerprintMatch(record, platformSupport);
  if (beforeHealth.status === 'gone') return { status: 'safe-noop', reasonCode: 'PROCESS_NOT_RUNNING' };
  if (beforeHealth.status !== 'match') {
    return {
      status: 'blocked',
      reasonCode: beforeHealth.status === 'mismatch'
        ? 'PROCESS_FINGERPRINT_MISMATCH'
        : 'PROCESS_FINGERPRINT_UNVERIFIABLE',
    };
  }

  try {
    await verifyHealthIdentity({ record, healthPath, timeoutMs: Math.min(500, timeoutMs), signal });
  } catch (error) {
    if (error.reasonCode === 'OPERATION_ABORTED') throw error;
    return { status: 'blocked', reasonCode: error.reasonCode ?? 'HEALTH_UNVERIFIED' };
  }

  const beforeShutdown = await fingerprintMatch(record, platformSupport);
  if (beforeShutdown.status !== 'match') {
    return {
      status: beforeShutdown.status === 'gone' ? 'safe-noop' : 'blocked',
      reasonCode: beforeShutdown.status === 'gone'
        ? 'PROCESS_NOT_RUNNING'
        : beforeShutdown.status === 'mismatch'
          ? 'PROCESS_FINGERPRINT_MISMATCH'
          : 'PROCESS_FINGERPRINT_UNVERIFIABLE',
    };
  }

  try {
    await requestAuthenticatedShutdown({
      record,
      shutdownToken,
      shutdownPath,
      timeoutMs: Math.min(1_000, timeoutMs),
      signal,
    });
    const exited = await waitForOwnedProcessExit({ record, timeoutMs, signal, platformSupport });
    if (exited.status === 'exited') return { status: 'stopped', method: 'authenticated-shutdown' };
    return { status: 'blocked', reasonCode: exited.reasonCode ?? 'PROCESS_EXIT_TIMEOUT' };
  } catch (error) {
    if (error.reasonCode === 'OPERATION_ABORTED') throw error;
    return { status: 'blocked', reasonCode: error.reasonCode ?? 'SHUTDOWN_FAILED' };
  }
}
