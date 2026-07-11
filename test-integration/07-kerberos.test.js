import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { before, test } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = new URL('..', import.meta.url).pathname;

// Requires the kdc + app + kdc-client containers (`npm run compose:up`).
function compose(args) {
  return execFileAsync('docker', ['compose', ...args], { cwd: REPO_ROOT });
}

before(async () => {
  try {
    await compose(['ps', '--services', '--status=running']);
  } catch (error) {
    throw new Error(`docker compose stack not available. Run \`npm run compose:up\` first. (${error.message})`);
  }
});

test('07 kinit + curl --negotiate authenticates over SPNEGO and returns the principal', async () => {
  const script = 'echo password-alice | kinit alice@EXAMPLE.TEST && curl -s --negotiate -u : http://app.example.test:3000/kerberos/me';
  const { stdout } = await compose(['exec', '-T', 'kdc-client', 'sh', '-c', script]);
  const body = JSON.parse(stdout.trim().split('\n').pop());
  assert.equal(body.principal, 'alice@EXAMPLE.TEST');
});

test('07 the SPNEGO endpoint challenges an unauthenticated request', async () => {
  const script = 'curl -s -i http://app.example.test:3000/kerberos/me';
  const { stdout } = await compose(['exec', '-T', 'kdc-client', 'sh', '-c', script]);
  assert.match(stdout, /HTTP\/1\.1 401/);
  assert.match(stdout, /WWW-Authenticate: Negotiate/i);
});
