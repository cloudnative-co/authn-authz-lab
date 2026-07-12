import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ensureLesson09ManagedComposeWithRetry,
  ManagedComposeError,
} from '../../course/lessons/09/container.mjs';
import { lesson09ManagedComposeSpec } from '../../course/lessons/09/lab-contract.mjs';
import { createLesson09ProtocolAdapter } from '../../course/lessons/09/protocol-adapter.mjs';

test('Lesson 09 Compose contract owns three private services and no host port', () => {
  const spec = lesson09ManagedComposeSpec({
    repoRoot: '/repo',
    secretDirectory: '/repo/.lab/containers/saml-lab',
  });
  assert.equal(spec.resourceId, 'saml-lab');
  assert.deepEqual(spec.expectedServices, ['keycloak', 'sp', 'user-agent']);
  assert.deepEqual(spec.expectedNetworks, ['default']);
  assert.deepEqual(spec.expectedVolumes, []);
  assert.deepEqual(spec.publishedPorts, []);
  assert.equal(spec.noDependencies, false);
});

test('Lesson 09 adapter executes only the owned user-agent with bounded output and time', async () => {
  let call;
  const adapter = createLesson09ProtocolAdapter({
    executeOwnedService: async (value) => {
      call = value;
      return { code: 0, signal: null, stdout: '{"schemaVersion":1}', stderr: '' };
    },
  });
  assert.deepEqual(await adapter.runScenario(), { schemaVersion: 1 });
  assert.equal(call.resourceId, 'saml-lab');
  assert.equal(call.serviceName, 'user-agent');
  assert.deepEqual(call.argv, ['node', 'client.mjs', 'scenario']);
  assert.equal(call.timeoutMs, 90_000);
  assert.equal(call.maxOutputBytes, 1024 * 1024);
  assert.deepEqual(call.acceptedExitCodes, [0]);
});

test('Lesson 09 keeps node-saml and direct XML dependencies exact-pinned', async () => {
  const packageJson = (await import('../../package.json', { with: { type: 'json' } })).default;
  assert.equal(packageJson.dependencies['@node-saml/node-saml'], '5.1.0');
  assert.equal(packageJson.dependencies['@xmldom/xmldom'], '0.8.13');
  assert.equal(packageJson.dependencies['xml-crypto'], '6.1.2');
});

test('Lesson 09 retries one container start failure after the secret mount sync wait', async () => {
  const calls = [];
  const waits = [];
  const options = { signal: new AbortController().signal };
  const result = await ensureLesson09ManagedComposeWithRetry(options, {
    ensureProject: async (received) => {
      calls.push(received);
      if (calls.length === 1) {
        throw new ManagedComposeError('CONTAINER_START_FAILED', 'Docker command failed');
      }
      return { status: 'running', healthy: true };
    },
    waitForRetry: async (signal) => waits.push(signal),
  });

  assert.deepEqual(result, { status: 'running', healthy: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [options, options]);
  assert.deepEqual(waits, [options.signal]);
});

test('Lesson 09 does not retry unrelated managed Compose failures', async () => {
  let calls = 0;
  await assert.rejects(
    ensureLesson09ManagedComposeWithRetry({}, {
      ensureProject: async () => {
        calls += 1;
        throw new ManagedComposeError('CONTAINER_CONFIG_INVALID', 'Compose config is invalid');
      },
      waitForRetry: async () => assert.fail('wait must not run'),
    }),
    (error) => error.reasonCode === 'CONTAINER_CONFIG_INVALID',
  );
  assert.equal(calls, 1);
});
