import { spawn } from 'node:child_process';
import { digestCanonical } from './canonical.mjs';
import { MAX_DEFAULT_OUTPUT_BYTES } from './managed-compose-constants.mjs';

export class ManagedComposeError extends Error {
  constructor(reasonCode, message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ManagedComposeError';
    this.reasonCode = reasonCode;
  }
}

export function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function assertSignal(signal) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError('signal must be an AbortSignal');
  }
}

function commandEnvironment(extra = {}) {
  const environment = {};
  for (const name of [
    'PATH', 'HOME', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR',
  ]) {
    if (typeof process.env[name] === 'string') environment[name] = process.env[name];
  }
  for (const [name, value] of Object.entries(extra)) environment[name] = value;
  return environment;
}

export async function runBoundedCommand(executable, args, {
  cwd,
  env = {},
  signal,
  timeoutMs = 30_000,
  maxOutputBytes = MAX_DEFAULT_OUTPUT_BYTES,
  stdin = null,
  spawnImplementation = spawn,
} = {}) {
  if (typeof executable !== 'string' || executable.length === 0) throw new TypeError('executable is required');
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    throw new TypeError('args must be an array of strings');
  }
  if (typeof cwd !== 'string' || cwd.length === 0) throw new TypeError('cwd is required');
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('env must be an object');
  for (const [name, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || typeof value !== 'string') {
      throw new TypeError('env contains an invalid entry');
    }
  }
  assertSignal(signal);
  positiveInteger(timeoutMs, 'timeoutMs');
  positiveInteger(maxOutputBytes, 'maxOutputBytes');
  if (stdin !== null && typeof stdin !== 'string' && !Buffer.isBuffer(stdin)) {
    throw new TypeError('stdin must be a string, Buffer, or null');
  }
  if (stdin !== null && Buffer.byteLength(stdin) > 64 * 1024) {
    throw new TypeError('stdin exceeds the command input limit');
  }
  if (typeof spawnImplementation !== 'function') throw new TypeError('spawnImplementation must be a function');
  if (signal?.aborted) throw signal.reason ?? new ManagedComposeError('OPERATION_ABORTED', 'operation aborted');

  let child;
  try {
    child = spawnImplementation(executable, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw error;
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let terminalError = null;
    let forceTimer = null;

    const terminate = (error) => {
      terminalError ??= error;
      child.kill('SIGTERM');
      forceTimer ??= setTimeout(() => child.kill('SIGKILL'), 500);
      forceTimer.unref?.();
    };
    const collect = (target, chunk, stream) => {
      const bytes = Buffer.from(chunk);
      if (stream === 'stdout') stdoutBytes += bytes.length;
      else stderrBytes += bytes.length;
      if (stdoutBytes + stderrBytes > maxOutputBytes) {
        terminate(new ManagedComposeError(
          'CONTAINER_COMMAND_OUTPUT_LIMIT',
          'container command exceeded its output limit',
        ));
        return;
      }
      target.push(bytes);
    };
    const onAbort = () => terminate(signal.reason ?? new ManagedComposeError('OPERATION_ABORTED', 'operation aborted'));
    const timeout = setTimeout(() => terminate(new ManagedComposeError(
      'CONTAINER_COMMAND_TIMEOUT',
      'container command timed out',
    )), timeoutMs);
    timeout.unref?.();
    const cleanup = () => {
      clearTimeout(timeout);
      if (forceTimer !== null) clearTimeout(forceTimer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    child.stdout?.on('data', (chunk) => collect(stdout, chunk, 'stdout'));
    child.stderr?.on('data', (chunk) => collect(stderr, chunk, 'stderr'));
    if (stdin !== null) {
      child.stdin.once('error', (error) => terminate(new ManagedComposeError(
        'CONTAINER_COMMAND_STDIN_FAILED',
        'container command input failed',
        { cause: error },
      )));
      child.stdin.end(stdin);
    }
    child.once('error', (error) => finish(() => rejectPromise(error)));
    child.once('close', (code, exitSignal) => finish(() => {
      if (terminalError) rejectPromise(terminalError);
      else resolvePromise({
        code,
        signal: exitSignal,
        stdout: Buffer.concat(stdout, stdoutBytes).toString('utf8'),
        stderr: Buffer.concat(stderr, stderrBytes).toString('utf8'),
      });
    }));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function commandRunner(dependencies) {
  return dependencies?.runCommand ?? runBoundedCommand;
}

export async function runDocker(args, {
  repoRoot,
  env = {},
  signal,
  timeoutMs,
  maxOutputBytes = MAX_DEFAULT_OUTPUT_BYTES,
  stdin = null,
  returnResult = false,
  acceptedExitCodes = [0],
  reasonCode = 'CONTAINER_COMMAND_FAILED',
  dependencies,
} = {}) {
  if (!Array.isArray(acceptedExitCodes)
      || acceptedExitCodes.length === 0
      || acceptedExitCodes.some((code) => !Number.isSafeInteger(code) || code < 0 || code > 255)
      || new Set(acceptedExitCodes).size !== acceptedExitCodes.length) {
    throw new TypeError('acceptedExitCodes must be a non-empty unique exit code array');
  }
  let result;
  try {
    result = await commandRunner(dependencies)('docker', args, {
      cwd: repoRoot,
      env: commandEnvironment(env),
      signal,
      timeoutMs,
      maxOutputBytes,
      stdin,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new ManagedComposeError('PREREQUISITE_DOCKER_CLI', 'Docker CLI is not installed', { cause: error });
    }
    throw error;
  }
  if (!acceptedExitCodes.includes(result.code) || result.signal !== null) {
    throw new ManagedComposeError(reasonCode, 'Docker command failed');
  }
  return returnResult ? result : result.stdout;
}

export function environmentObject(entries) {
  return Object.fromEntries(entries.map(({ name, value }) => [name, value]));
}

export function composeArguments(record, command, extra = []) {
  return [
    'compose', '--project-name', record.composeProject, '--file', record.composeFile,
    command, ...extra,
  ];
}

export async function resolvedConfigDigest(record, { repoRoot, signal, dependencies }) {
  const source = await runDocker(composeArguments(record, 'config', ['--format', 'json']), {
    repoRoot,
    env: environmentObject(record.composeEnvironment),
    signal,
    timeoutMs: 10_000,
    reasonCode: 'CONTAINER_CONFIG_INVALID',
    dependencies,
  });
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new ManagedComposeError('CONTAINER_CONFIG_INVALID', 'Compose config is not JSON', { cause: error });
  }
  return digestCanonical(parsed);
}

export async function inspectDockerPrerequisites({ repoRoot, signal, dependencies } = {}) {
  const diagnostics = [];
  try {
    const version = (await runDocker(['--version'], {
      repoRoot, signal, timeoutMs: 5_000, reasonCode: 'PREREQUISITE_DOCKER_CLI', dependencies,
    })).trim();
    diagnostics.push({
      id: 'docker.cli', status: 'pass', actual: version.split(',')[0] || 'available',
      expected: 'Docker CLI', message: 'Docker CLIを確認しました',
    });
  } catch (error) {
    return {
      supported: false,
      reasonCode: error.reasonCode ?? 'PREREQUISITE_DOCKER_CLI',
      diagnostics: [{
        id: 'docker.cli', status: 'fail', actual: 'unavailable', expected: 'Docker CLI',
        message: 'Docker DesktopまたはDocker EngineのCLIを導入してください',
      }],
    };
  }

  try {
    const serverVersion = JSON.parse((await runDocker(
      ['version', '--format', '{{json .Server.Version}}'],
      { repoRoot, signal, timeoutMs: 5_000, reasonCode: 'PREREQUISITE_DOCKER_DAEMON', dependencies },
    )).trim());
    diagnostics.push({
      id: 'docker.daemon', status: 'pass', actual: String(serverVersion), expected: 'reachable',
      message: 'Docker daemonへ接続できました',
    });
  } catch (error) {
    return {
      supported: false,
      reasonCode: error.reasonCode === 'PREREQUISITE_DOCKER_CLI'
        ? error.reasonCode
        : 'PREREQUISITE_DOCKER_DAEMON',
      diagnostics: [...diagnostics, {
        id: 'docker.daemon', status: 'fail', actual: 'unreachable', expected: 'reachable',
        message: 'Docker DesktopまたはDocker daemonを起動してください',
      }],
    };
  }

  try {
    const compose = (await runDocker(['compose', 'version', '--short'], {
      repoRoot, signal, timeoutMs: 5_000, reasonCode: 'PREREQUISITE_DOCKER_COMPOSE', dependencies,
    })).trim();
    diagnostics.push({
      id: 'docker.compose', status: 'pass', actual: compose || 'available', expected: 'Compose v2',
      message: 'Docker Compose v2を確認しました',
    });
  } catch (error) {
    return {
      supported: false,
      reasonCode: error.reasonCode === 'PREREQUISITE_DOCKER_CLI'
        ? error.reasonCode
        : 'PREREQUISITE_DOCKER_COMPOSE',
      diagnostics: [...diagnostics, {
        id: 'docker.compose', status: 'fail', actual: 'unavailable', expected: 'Compose v2',
        message: 'docker composeが利用できるDocker環境へ更新してください',
      }],
    };
  }
  return { supported: true, reasonCode: null, diagnostics };
}
