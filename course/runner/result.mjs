import { constants as osConstants } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  COURSE_COMMANDS,
  EXIT_CODES,
  LESSON_COMMANDS,
  RESULT_SCHEMA_PATH,
  RESULT_STATUSES,
  SIGNAL_EXIT_CODE_BASE,
} from './constants.mjs';
import { canonicalJson } from './canonical.mjs';

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

export function createRunnerResult({
  runId = randomUUID(),
  courseId = 'auth-authz',
  scope,
  lessonId = null,
  command,
  status,
  checkIds = [],
  diagnostics = [],
  reasonCode = null,
  recovery = [],
  durationMs = 0,
  evidenceId = null,
}) {
  requireString(runId, 'runId');
  requireString(courseId, 'courseId');
  requireString(command, 'command');
  if (!['course', 'lesson'].includes(scope)) throw new TypeError('scope must be course or lesson');
  if ((scope === 'course' && lessonId !== null) || (scope === 'lesson' && !lessonId)) {
    throw new TypeError('lessonId must be null for course scope and non-empty for lesson scope');
  }
  if (!RESULT_STATUSES.includes(status)) throw new TypeError(`unsupported result status: ${status}`);
  const supportedCommands = scope === 'course' ? COURSE_COMMANDS : LESSON_COMMANDS;
  if (!supportedCommands.includes(command)) throw new TypeError(`unsupported ${scope} command: ${command}`);
  if (!Number.isInteger(durationMs) || durationMs < 0) throw new TypeError('durationMs must be a non-negative integer');
  if (!Array.isArray(checkIds) || new Set(checkIds).size !== checkIds.length) {
    throw new TypeError('checkIds must be a unique array');
  }
  if (checkIds.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError('checkIds must contain non-empty strings');
  }
  if (!Array.isArray(diagnostics)) throw new TypeError('diagnostics must be an array');
  for (const [index, diagnostic] of diagnostics.entries()) {
    if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) {
      throw new TypeError(`diagnostics[${index}] must be an object`);
    }
    const keys = Object.keys(diagnostic).sort().join(',');
    if (keys !== 'actual,expected,id,message,status') {
      throw new TypeError(`diagnostics[${index}] has unsupported fields`);
    }
    if (!/^[a-z][a-z0-9.-]*$/.test(diagnostic.id)
        || !['pass', 'fail', 'warn'].includes(diagnostic.status)
        || (diagnostic.actual !== null && typeof diagnostic.actual !== 'string')
        || (diagnostic.expected !== null && typeof diagnostic.expected !== 'string')
        || typeof diagnostic.message !== 'string'
        || diagnostic.message.length === 0) {
      throw new TypeError(`diagnostics[${index}] is invalid`);
    }
  }
  if (!Array.isArray(recovery) || new Set(recovery).size !== recovery.length) {
    throw new TypeError('recovery must be a unique array');
  }
  if (recovery.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError('recovery must contain non-empty strings');
  }
  if (reasonCode !== null && (typeof reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(reasonCode))) {
    throw new TypeError('reasonCode must be null or an uppercase machine code');
  }
  if (evidenceId !== null && (typeof evidenceId !== 'string' || evidenceId.length === 0)) {
    throw new TypeError('evidenceId must be null or a non-empty string');
  }

  return {
    $schema: RESULT_SCHEMA_PATH,
    schemaVersion: 1,
    runId,
    courseId,
    scope,
    lessonId,
    command,
    status,
    checkIds: [...checkIds],
    diagnostics: diagnostics.map((diagnostic) => ({ ...diagnostic })),
    reasonCode,
    recovery: [...recovery],
    durationMs,
    evidenceId,
  };
}

export function exitCodeForResult(result) {
  if (result.status === 'pass' || result.status === 'safe-noop') return EXIT_CODES.SUCCESS;
  if (result.reasonCode?.startsWith('TIMEOUT_')) return EXIT_CODES.TIMEOUT;
  if (/^(?:PREREQUISITE_|UNSUPPORTED_|DOCTOR_)/.test(result.reasonCode ?? '')) return EXIT_CODES.PREREQUISITE;
  if (result.reasonCode?.startsWith('LOCK_')) return EXIT_CODES.LOCK_CONFLICT;
  if (/^(?:INTERNAL_|INFRASTRUCTURE_|CLEANUP_|PROCESS_|STATE_)/.test(result.reasonCode ?? '')) {
    return EXIT_CODES.INFRASTRUCTURE;
  }
  if (result.reasonCode?.startsWith('CHECK_') || result.status === 'fail') return EXIT_CODES.CHECK_FAILED;
  return EXIT_CODES.INFRASTRUCTURE;
}

export function exitCodeForSignal(signal) {
  const number = typeof signal === 'number' ? signal : osConstants.signals[signal];
  if (!Number.isInteger(number) || number <= 0) throw new TypeError(`unknown signal: ${signal}`);
  return SIGNAL_EXIT_CODE_BASE + number;
}

export function formatRunnerResult(result, { json = false } = {}) {
  if (json) return `${canonicalJson(result)}\n`;
  const target = result.scope === 'lesson' ? `lesson ${result.lessonId}` : 'course';
  const lines = [
    `[${result.status.toUpperCase()}] ${target} ${result.command}`,
    `runId: ${result.runId}`,
    `durationMs: ${result.durationMs}`,
  ];
  if (result.checkIds.length > 0) lines.push(`checkIds: ${result.checkIds.join(', ')}`);
  for (const diagnostic of result.diagnostics) {
    const comparison = diagnostic.expected === null
      ? `actual=${diagnostic.actual ?? 'n/a'}`
      : `actual=${diagnostic.actual ?? 'n/a'}, expected=${diagnostic.expected}`;
    lines.push(`diagnostic[${diagnostic.status}]: ${diagnostic.id} (${comparison}) ${diagnostic.message}`);
  }
  if (result.reasonCode) lines.push(`reasonCode: ${result.reasonCode}`);
  for (const recovery of result.recovery) lines.push(`recovery: ${recovery}`);
  if (result.evidenceId) lines.push(`evidenceId: ${result.evidenceId}`);
  return `${lines.join('\n')}\n`;
}

export const renderRunnerResult = formatRunnerResult;
