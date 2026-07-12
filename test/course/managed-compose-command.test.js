import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import {
  deriveComposeProjectName,
  inspectDockerPrerequisites,
  ManagedComposeError,
  runBoundedCommand,
} from '../../course/runner/managed-compose.mjs';

function fakeChild({ stdin = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = stdin;
  child.kill = (signal) => {
    queueMicrotask(() => child.emit('close', null, signal));
    return true;
  };
  return child;
}

test('bounded command settles on close and captures data emitted after exit', async () => {
  const child = fakeChild();
  const resultPromise = runBoundedCommand('fake', [], {
    cwd: '/tmp',
    spawnImplementation: () => child,
  });
  child.emit('exit', 0, null);
  child.stdout.write('after-exit');
  child.stdout.end();
  child.stderr.end();
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'after-exit');
});

test('bounded command rejects stdin failure only after the child closes', async () => {
  const input = new EventEmitter();
  input.end = () => queueMicrotask(() => input.emit('error', Object.assign(new Error('EPIPE'), { code: 'EPIPE' })));
  const child = fakeChild({ stdin: input });
  await assert.rejects(
    runBoundedCommand('fake', [], {
      cwd: '/tmp',
      stdin: 'input',
      spawnImplementation: () => child,
    }),
    (error) => error instanceof ManagedComposeError
      && error.reasonCode === 'CONTAINER_COMMAND_STDIN_FAILED',
  );
});

test('bounded command enforces combined output, timeout, abort and stdin limits', async (context) => {
  await context.test('combined output', async () => {
    const child = fakeChild();
    const promise = runBoundedCommand('fake', [], {
      cwd: '/tmp',
      maxOutputBytes: 4,
      spawnImplementation: () => child,
    });
    child.stdout.write('123');
    child.stderr.write('45');
    await assert.rejects(promise, (error) => (
      error.reasonCode === 'CONTAINER_COMMAND_OUTPUT_LIMIT'
    ));
  });

  await context.test('timeout', async () => {
    const child = fakeChild();
    await assert.rejects(runBoundedCommand('fake', [], {
      cwd: '/tmp',
      timeoutMs: 1,
      spawnImplementation: () => child,
    }), (error) => error.reasonCode === 'CONTAINER_COMMAND_TIMEOUT');
  });

  await context.test('abort', async () => {
    const child = fakeChild();
    const controller = new AbortController();
    const promise = runBoundedCommand('fake', [], {
      cwd: '/tmp',
      signal: controller.signal,
      spawnImplementation: () => child,
    });
    controller.abort(new ManagedComposeError('OPERATION_ABORTED', 'aborted'));
    await assert.rejects(promise, (error) => error.reasonCode === 'OPERATION_ABORTED');
  });

  await context.test('stdin size', async () => {
    await assert.rejects(runBoundedCommand('fake', [], {
      cwd: '/tmp',
      stdin: Buffer.alloc(64 * 1024 + 1),
      spawnImplementation: () => {
        throw new Error('must not spawn');
      },
    }), /input limit/u);
  });
});

function dockerResult(code, stdout = '', stderr = '') {
  return { code, signal: null, stdout, stderr };
}

test('Docker prerequisite diagnostics distinguish CLI, daemon and Compose failures', async (context) => {
  await context.test('CLI', async () => {
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const result = await inspectDockerPrerequisites({
      repoRoot: '/tmp',
      dependencies: { runCommand: async () => { throw error; } },
    });
    assert.equal(result.reasonCode, 'PREREQUISITE_DOCKER_CLI');
  });

  await context.test('daemon', async () => {
    const result = await inspectDockerPrerequisites({
      repoRoot: '/tmp',
      dependencies: {
        runCommand: async (_executable, args) => (
          args[0] === '--version'
            ? dockerResult(0, 'Docker version 1')
            : dockerResult(1, '', 'daemon unavailable')
        ),
      },
    });
    assert.equal(result.reasonCode, 'PREREQUISITE_DOCKER_DAEMON');
  });

  await context.test('Compose', async () => {
    const result = await inspectDockerPrerequisites({
      repoRoot: '/tmp',
      dependencies: {
        runCommand: async (_executable, args) => {
          if (args[0] === '--version') return dockerResult(0, 'Docker version 1');
          if (args[0] === 'version') return dockerResult(0, '"1"');
          return dockerResult(1, '', 'compose missing');
        },
      },
    });
    assert.equal(result.reasonCode, 'PREREQUISITE_DOCKER_COMPOSE');
  });
});

test('Compose project identity is deterministic and isolated by resource', () => {
  const base = { courseId: 'auth-authz', installId: 'a'.repeat(32) };
  const ldap = deriveComposeProjectName({ ...base, resourceId: 'ldap-directory' });
  const kerberos = deriveComposeProjectName({ ...base, resourceId: 'kerberos-lab' });
  assert.notEqual(ldap, kerberos);
  assert.equal(ldap, deriveComposeProjectName({ ...base, resourceId: 'ldap-directory' }));
  assert.match(ldap, /^[a-z0-9-]+$/u);
});
