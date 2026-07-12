import {
  assertProjectId,
  assertSubjectId,
  LESSON_04_ACTION,
  LESSON_04_REASONS,
} from './domain.mjs';

const MAX_CONFIGURED_ENTRIES = 4096;
const DECISIONS = new Set(['allow', 'deny']);
const REASONS = new Set(Object.values(LESSON_04_REASONS));
const STATUS_BY_REASON = Object.freeze({
  [LESSON_04_REASONS.OWNER]: 204,
  [LESSON_04_REASONS.INSUFFICIENT_ROLE]: 403,
  [LESSON_04_REASONS.CONCEALED]: 404,
});

function assertMaximum(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CONFIGURED_ENTRIES) {
    throw new TypeError(`maxEntries must be between 1 and ${MAX_CONFIGURED_ENTRIES}`);
  }
  return value;
}

function normalizeEntry(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('audit entry must be an object');
  }
  const subject = assertSubjectId(candidate.subject, 'audit.subject');
  const resource = assertProjectId(candidate.resource, 'audit.resource');
  if (candidate.action !== LESSON_04_ACTION) {
    throw new TypeError(`audit.action must be ${LESSON_04_ACTION}`);
  }
  if (!DECISIONS.has(candidate.decision)) {
    throw new TypeError('audit.decision must be allow or deny');
  }
  if (!REASONS.has(candidate.reason)) {
    throw new TypeError('audit.reason is not a supported policy reason');
  }
  if (candidate.status !== STATUS_BY_REASON[candidate.reason]) {
    throw new TypeError('audit.status does not match audit.reason');
  }
  const expectedDecision = candidate.status === 204 ? 'allow' : 'deny';
  if (candidate.decision !== expectedDecision) {
    throw new TypeError('audit.decision does not match audit.status');
  }

  return Object.freeze({
    subject,
    resource,
    action: LESSON_04_ACTION,
    decision: candidate.decision,
    status: candidate.status,
    reason: candidate.reason,
  });
}

export function createEmptyAuditState(maxEntries = 128) {
  return Object.freeze({
    maxEntries: assertMaximum(maxEntries),
    droppedEntryCount: 0,
    entries: Object.freeze([]),
  });
}

export function appendAuditEntry(state, candidate) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.entries)) {
    throw new TypeError('audit state is invalid');
  }
  const entry = normalizeEntry(candidate);
  const overflow = Math.max(0, state.entries.length + 1 - state.maxEntries);
  const entries = [...state.entries, entry].slice(overflow);
  return Object.freeze({
    maxEntries: state.maxEntries,
    droppedEntryCount: state.droppedEntryCount + overflow,
    entries: Object.freeze(entries),
  });
}

export function snapshotAuditState(state) {
  return structuredClone({
    maxEntries: state.maxEntries,
    retainedEntryCount: state.entries.length,
    droppedEntryCount: state.droppedEntryCount,
    entries: state.entries,
  });
}
