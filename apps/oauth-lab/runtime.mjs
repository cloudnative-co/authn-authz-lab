const IDENTIFIER = /^[A-Za-z0-9_-]{3,128}$/u;

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} is required`);
  return value;
}

export function readManagedLabRuntime(env = process.env) {
  const installId = required(env, 'COURSE_INSTALL_ID');
  const runId = required(env, 'COURSE_RUN_ID');
  if (!IDENTIFIER.test(installId) || !IDENTIFIER.test(runId)) {
    throw new TypeError('managed identifiers are invalid');
  }
  const instanceId = required(env, 'COURSE_PROCESS_INSTANCE_ID');
  if (instanceId !== `${installId}.${runId}`) throw new TypeError('managed instance identity is inconsistent');
  const origin = new URL(required(env, 'COURSE_PROCESS_ORIGIN'));
  if (origin.href !== 'http://127.0.0.1:4100/') {
    throw new TypeError('OAuth lab managed origin must be fixed loopback port 4100');
  }
  const shutdownToken = required(env, 'COURSE_PROCESS_SHUTDOWN_TOKEN');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(shutdownToken)
      || Buffer.from(shutdownToken, 'base64url').length !== 32
      || Buffer.from(shutdownToken, 'base64url').toString('base64url') !== shutdownToken) {
    throw new TypeError('managed shutdown token is invalid');
  }
  return Object.freeze({
    identity: Object.freeze({ pid: process.pid, installId, runId, instanceId }),
    shutdownToken,
  });
}
