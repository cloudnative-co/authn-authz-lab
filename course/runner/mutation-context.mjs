import { AsyncLocalStorage } from 'node:async_hooks';

const mutationStorage = new AsyncLocalStorage();

export function runWithMutationHooks(hooks, callback) {
  if (!hooks || typeof hooks.prepare !== 'function' || typeof hooks.applied !== 'function') {
    throw new TypeError('mutation hooks are required');
  }
  if (typeof callback !== 'function') throw new TypeError('mutation callback is required');
  return mutationStorage.run(hooks, callback);
}

export function currentMutationHooks() {
  return mutationStorage.getStore() ?? null;
}
