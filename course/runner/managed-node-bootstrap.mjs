import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  inspectManagedProcessResource,
  loadManagedCleanupContext,
} from './managed-process-state.mjs';

const REQUIRED_ENVIRONMENT = [
  'COURSE_INSTALL_ID',
  'COURSE_RUN_ID',
  'COURSE_PROCESS_INSTANCE_ID',
  'COURSE_PROCESS_ORIGIN',
  'COURSE_PROCESS_SHUTDOWN_TOKEN',
  'COURSE_MANAGED_REPOSITORY_ROOT',
  'COURSE_MANAGED_STATE_ROOT',
  'COURSE_MANAGED_RESOURCE_ID',
  'COURSE_MANAGED_GENERATION_ID',
  'COURSE_MANAGED_GATE_TIMEOUT_MS',
];

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} is required`);
  return value;
}

function pathInside(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

function gateTimeout(value) {
  if (!/^[1-9][0-9]{2,4}$/.test(value)) throw new TypeError('managed gate timeout is invalid');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 5_000) {
    throw new TypeError('managed gate timeout is outside the supported range');
  }
  return parsed;
}

function exactActivation(snapshot, expected) {
  const current = snapshot.current;
  return snapshot.pointer?.generationId === expected.generationId
    && current?.intent.generationId === expected.generationId
    && current.intent.launchProtocol === 'current-record-gated-v1'
    && current.intent.status === 'pending'
    && current.intent.installId === expected.installId
    && current.intent.instanceId === expected.instanceId
    && current.intent.origin === expected.origin
    && current.record?.status === 'running'
    && current.record.pid === process.pid
    && current.record.instanceId === expected.instanceId
    && current.record.origin === expected.origin
    && current.control.status === 'active'
    && current.control.instanceId === expected.instanceId
    && current.control.shutdownToken === expected.shutdownToken;
}

async function waitForDurableActivation({ context, resourceId, expected, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const snapshot = await inspectManagedProcessResource({
        context,
        resourceId,
        allowOperation: true,
        allowStaleGenerations: true,
      });
      if (exactActivation(snapshot, expected)) return;
      const expectedGeneration = snapshot.history.find(
        ({ intent }) => intent.generationId === expected.generationId,
      );
      if (expectedGeneration?.intent.status === 'aborted') {
        throw new Error('managed activation was aborted');
      }
    } catch (error) {
      if (error?.message === 'managed activation was aborted') throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('managed activation was not durably committed');
}

async function main() {
  for (const name of REQUIRED_ENVIRONMENT) requiredEnvironment(name);
  const [targetScript, ...targetArguments] = process.argv.slice(2);
  if (typeof targetScript !== 'string' || targetScript.length === 0) {
    throw new TypeError('managed target script is required');
  }

  const repositoryRoot = await realpath(requiredEnvironment('COURSE_MANAGED_REPOSITORY_ROOT'));
  const targetRealpath = await realpath(resolve(targetScript));
  if (!pathInside(repositoryRoot, targetRealpath)) throw new TypeError('managed target escapes the repository');
  const context = await loadManagedCleanupContext({
    stateRoot: requiredEnvironment('COURSE_MANAGED_STATE_ROOT'),
    repoRoot: repositoryRoot,
  });
  const expected = {
    generationId: requiredEnvironment('COURSE_MANAGED_GENERATION_ID'),
    installId: requiredEnvironment('COURSE_INSTALL_ID'),
    instanceId: requiredEnvironment('COURSE_PROCESS_INSTANCE_ID'),
    origin: new URL(requiredEnvironment('COURSE_PROCESS_ORIGIN')).origin,
    shutdownToken: requiredEnvironment('COURSE_PROCESS_SHUTDOWN_TOKEN'),
  };
  await waitForDurableActivation({
    context,
    resourceId: requiredEnvironment('COURSE_MANAGED_RESOURCE_ID'),
    expected,
    timeoutMs: gateTimeout(requiredEnvironment('COURSE_MANAGED_GATE_TIMEOUT_MS')),
  });

  process.argv = [process.argv[0], targetRealpath, ...targetArguments];
  await import(pathToFileURL(targetRealpath).href);
}

main().catch(() => {
  process.stderr.write('{"error":"MANAGED_BOOTSTRAP_FAILED"}\n');
  process.exit(1);
});
