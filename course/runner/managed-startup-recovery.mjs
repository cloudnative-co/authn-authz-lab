import { abortableDelay } from './process.mjs';

export async function retryManagedStartupStop({ stop, timeoutMs, signal }) {
  const deadline = performance.now() + timeoutMs;
  let remaining = timeoutMs;
  while (true) {
    signal?.throwIfAborted();
    const result = await stop(remaining);
    if (result.status !== 'blocked' || result.reasonCode !== 'HEALTH_UNREACHABLE') return result;
    remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) return result;
    await abortableDelay(Math.min(25, remaining), { signal });
    remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) return result;
  }
}
