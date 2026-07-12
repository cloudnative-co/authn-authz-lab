import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { probeTcpPort } from '../../course/runner/port.mjs';

async function listen() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  return server;
}

async function close(server) {
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise());
  });
}

test('port probe distinguishes an available loopback port from an occupied one', async () => {
  const reserved = await listen();
  const { port } = reserved.address();
  try {
    assert.deepEqual(await probeTcpPort({ host: '127.0.0.1', port }), {
      available: false,
      reasonCode: 'EADDRINUSE',
    });
  } finally {
    await close(reserved);
  }
  assert.deepEqual(await probeTcpPort({ host: '127.0.0.1', port }), {
    available: true,
    reasonCode: null,
  });
});

test('port probe rejects unsafe or aborted input before binding', async () => {
  await assert.rejects(probeTcpPort({ host: '0.0.0.0', port: 3000 }), TypeError);
  const controller = new AbortController();
  controller.abort(new Error('test abort'));
  await assert.rejects(
    probeTcpPort({ host: '127.0.0.1', port: 3000, signal: controller.signal }),
    /test abort/,
  );
});
