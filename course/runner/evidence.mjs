import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestCanonical } from './canonical.mjs';
import { EVIDENCE_SCHEMA_PATH, RESULT_SCHEMA_PATH } from './constants.mjs';
import { loadAndValidateManifest } from './manifest.mjs';
import { allowlistRedactAndDigest } from './redact.mjs';
import { assertValidSchema, loadJsonSchema } from './schema.mjs';
import {
  assertStateMatchesManifest,
  ensureStateDirectory,
  loadStateContext,
  resolveStatePath,
  writeJsonAtomically,
} from './state.mjs';
import { inspectSupport } from './support.mjs';

const EVIDENCE_COMMANDS = new Set(['demo', 'observe', 'check', 'diagnose', 'reset', 'stop', 'purge']);

function normalizeInputs(context) {
  return context.inputs ?? {
    articleContentDigest: context.articleContentDigest ?? null,
    manifestDigest: context.manifestDigest,
    sampleSourceDigest: context.sampleSourceDigest,
    sampleRevision: context.sampleRevision ?? null,
    stateEpoch: context.stateEpoch,
    stateMarkerDigest: context.stateMarkerDigest,
  };
}

function validateInputs(inputs) {
  if (!Number.isInteger(inputs?.stateEpoch) || inputs.stateEpoch < 1) {
    throw new TypeError('evidence inputs.stateEpoch must be a positive integer');
  }
  if (typeof inputs.stateMarkerDigest !== 'string' || !/^[a-f0-9]{64}$/.test(inputs.stateMarkerDigest)) {
    throw new TypeError('evidence inputs.stateMarkerDigest must be a lowercase SHA-256 digest');
  }
  return inputs;
}

function normalizeObservations(result, context) {
  const observations = context.observations ?? [];
  if (!Array.isArray(observations)) throw new TypeError('context.observations must be an array');
  const expected = new Set(result.checkIds);
  const seen = new Set();
  const classes = new Set();
  const normalized = observations.map((observation, index) => {
    if (!observation || typeof observation !== 'object') throw new TypeError(`observation[${index}] must be an object`);
    const { checkId, outcome, reasonCode = null, data = {} } = observation;
    if (!expected.has(checkId)) throw new TypeError(`observation uses unknown result checkId: ${checkId}`);
    if (seen.has(checkId)) throw new TypeError(`duplicate observation checkId: ${checkId}`);
    if (!['pass', 'fail', 'blocked'].includes(outcome)) throw new TypeError(`invalid observation outcome: ${outcome}`);
    if (reasonCode !== null && (typeof reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(reasonCode))) {
      throw new TypeError(`invalid observation reasonCode: ${reasonCode}`);
    }
    seen.add(checkId);
    const hasData = data && typeof data === 'object' && Object.keys(data).length > 0;
    const allowlist = observation.allowlist ?? context.observationAllowlist;
    if (hasData && allowlist === undefined) {
      throw new TypeError(`observation ${checkId} has data but no allowlist`);
    }
    const result_ = allowlistRedactAndDigest(
      { checkId, outcome, reasonCode, data },
      { allowlist: ['checkId', 'outcome', 'reasonCode', ...(allowlist ?? []).map((path) => `data.${path}`)] },
    );
    result_.redactedFieldClasses.forEach((value) => classes.add(value));
    return { checkId, outcome, reasonCode, normalizedDigest: result_.digest };
  });
  for (const checkId of expected) {
    if (!seen.has(checkId)) throw new TypeError(`missing observation for result checkId: ${checkId}`);
  }
  return { observations: normalized, redactedFieldClasses: [...classes].sort() };
}

export function buildEvidence({ result, context = {} }) {
  if (result.scope !== 'lesson' || !result.lessonId) throw new TypeError('evidence requires a lesson-scoped result');
  if (!EVIDENCE_COMMANDS.has(result.command)) throw new TypeError(`command does not emit evidence: ${result.command}`);
  if (typeof context.supportProfileId !== 'string' || context.supportProfileId.length === 0) {
    throw new TypeError('context.supportProfileId is required');
  }
  const evidenceId = result.evidenceId ?? context.evidenceId ?? `evidence-${randomUUID()}`;
  if (typeof evidenceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(evidenceId)) {
    throw new TypeError('evidenceId must be a path-safe identifier of at most 128 characters');
  }
  const resultWithEvidence = { ...result, evidenceId };
  const { observations, redactedFieldClasses } = normalizeObservations(resultWithEvidence, context);
  const evidence = {
    $schema: EVIDENCE_SCHEMA_PATH,
    schemaVersion: 1,
    evidenceId,
    courseId: result.courseId,
    lessonId: result.lessonId,
    runId: result.runId,
    command: result.command,
    status: result.status,
    checkIds: [...result.checkIds],
    generatedAt: context.generatedAt ?? new Date().toISOString(),
    inputs: validateInputs(normalizeInputs(context)),
    supportProfileId: context.supportProfileId,
    runnerResultDigest: digestCanonical(resultWithEvidence),
    redaction: {
      policyVersion: 1,
      redactedFieldClasses,
      rawSensitiveValuesStored: false,
    },
    observations,
  };
  return { evidence, result: resultWithEvidence };
}

export async function writeEvidence({ stateRoot, result, context = {} }) {
  if (!stateRoot) throw new TypeError('stateRoot is required');
  if (typeof context.repoRoot !== 'string' || context.repoRoot.length === 0) {
    throw new TypeError('context.repoRoot is required');
  }
  const initialState = await loadStateContext({ stateRoot, repoRoot: context.repoRoot });
  if (!initialState.state) throw new TypeError('evidence requires initialized state.json');
  const repoRoot = initialState.repositoryRealpath;
  const manifestResult = await loadAndValidateManifest({ repoRoot });
  const ownedState = await loadStateContext({
    stateRoot,
    repoRoot,
    courseId: manifestResult.manifest.courseId,
    sourceRevision: initialState.marker.sourceRevision,
    sourceDigest: manifestResult.sourceDigest,
  });
  assertStateMatchesManifest(ownedState.state, manifestResult.manifest);
  const matrix = JSON.parse(await readFile(resolve(repoRoot, 'curriculum/support-matrix.json'), 'utf8'));
  const support = await inspectSupport({ matrix, environment: context.supportEnvironment });
  if (!support.supported || context.supportProfileId !== support.profile?.id) {
    throw new TypeError('supportProfileId must match the detected candidate environment');
  }
  const suppliedInputs = normalizeInputs(context);
  const authoritativeInputs = {
    articleContentDigest: suppliedInputs.articleContentDigest ?? null,
    manifestDigest: manifestResult.manifestDigest,
    sampleSourceDigest: manifestResult.sourceDigest,
    sampleRevision: ownedState.marker.sourceRevision,
    stateEpoch: ownedState.state.epoch,
    stateMarkerDigest: ownedState.markerDigest,
  };
  for (const key of ['manifestDigest', 'sampleSourceDigest', 'sampleRevision', 'stateEpoch', 'stateMarkerDigest']) {
    if (suppliedInputs[key] !== undefined && suppliedInputs[key] !== authoritativeInputs[key]) {
      throw new TypeError(`evidence inputs.${key} does not match owned runtime state`);
    }
  }
  const built = buildEvidence({ result, context: { ...context, inputs: authoritativeInputs } });
  const [resultSchema, evidenceSchema] = await Promise.all([
    loadJsonSchema(resolve(repoRoot, RESULT_SCHEMA_PATH)),
    loadJsonSchema(resolve(repoRoot, EVIDENCE_SCHEMA_PATH)),
  ]);
  assertValidSchema(built.result, resultSchema, 'runner result');
  assertValidSchema(built.evidence, evidenceSchema, 'evidence');
  await ensureStateDirectory(
    ownedState,
    'evidence',
    `epoch-${String(built.evidence.inputs.stateEpoch).padStart(6, '0')}`,
  );
  const path = resolveStatePath(ownedState, 'evidence', `epoch-${String(built.evidence.inputs.stateEpoch).padStart(6, '0')}`, `${built.evidence.evidenceId}.json`);
  await writeJsonAtomically({
    anchor: ownedState.stateRoot,
    path,
    value: built.evidence,
    exclusive: true,
    label: 'evidence',
  });
  return { ...built, path };
}
