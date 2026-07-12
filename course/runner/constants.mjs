export const COURSE_COMMANDS = Object.freeze([
  'doctor',
  'setup',
  'diagnose',
  'stop',
  'reset',
  'purge',
]);

export const LESSON_COMMANDS = Object.freeze([
  'doctor',
  'setup',
  'demo',
  'observe',
  'check',
  'diagnose',
  'reset',
  'stop',
  'purge',
]);

export const CLI_FLAGS = Object.freeze([
  '--json',
  '--non-interactive',
  '--timeout',
  '--yes',
]);

export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  USAGE: 2,
  CHECK_FAILED: 10,
  PREREQUISITE: 20,
  LOCK_CONFLICT: 21,
  INFRASTRUCTURE: 30,
  TIMEOUT: 31,
});

export const RESULT_SCHEMA_PATH = 'curriculum/schemas/runner-result.schema.json';
export const EVIDENCE_SCHEMA_PATH = 'curriculum/schemas/evidence.schema.json';
export const MANIFEST_PATH = 'curriculum/manifest.json';

export const COURSE_USAGE =
  'node course.mjs doctor|setup|diagnose|stop|reset|purge [--json] [--non-interactive] [--timeout <seconds>] [--yes]';
export const LESSON_USAGE =
  'node course.mjs lesson <id> doctor|setup|demo|observe|check|diagnose|reset|stop|purge [--json] [--non-interactive] [--timeout <seconds>] [--yes]';

export const RESULT_STATUSES = Object.freeze(['pass', 'fail', 'blocked', 'safe-noop']);

export const SIGNAL_EXIT_CODE_BASE = 128;
