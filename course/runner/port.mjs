import { createServer } from 'node:net';

function assertPort(port) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('port must be an integer from 1 to 65535');
  }
}

export async function probeTcpPort({ host, port, signal } = {}) {
  if (!['127.0.0.1', '::1'].includes(host)) throw new TypeError('host must be an exact loopback address');
  assertPort(port);
  if (signal?.aborted) throw signal.reason ?? new Error('port probe aborted');
  const server = createServer();
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const cleanup = () => {
      server.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onError = (error) => finish(() => {
      if (['EADDRINUSE', 'EACCES'].includes(error.code)) {
        resolvePromise({ available: false, reasonCode: error.code });
      } else {
        rejectPromise(error);
      }
    });
    const onAbort = () => {
      server.close(() => finish(() => rejectPromise(signal.reason ?? new Error('port probe aborted'))));
    };
    server.once('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    server.listen(port, host, () => {
      server.close((error) => finish(() => {
        if (error) rejectPromise(error);
        else resolvePromise({ available: true, reasonCode: null });
      }));
    });
  });
}
