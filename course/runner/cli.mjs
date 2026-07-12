import {
  COURSE_COMMANDS,
  COURSE_USAGE,
  EXIT_CODES,
  LESSON_COMMANDS,
  LESSON_USAGE,
} from './constants.mjs';

export class CliUsageError extends Error {
  constructor(message) {
    super(`${message}\nUsage:\n  ${COURSE_USAGE}\n  ${LESSON_USAGE}`);
    this.name = 'CliUsageError';
    this.exitCode = EXIT_CODES.USAGE;
    this.reasonCode = 'USAGE_ERROR';
  }
}

function parseTimeout(value) {
  if (!/^[1-9]\d*$/.test(value ?? '')) {
    throw new CliUsageError('--timeout must be an integer from 1 to 3600 seconds');
  }
  const timeoutSeconds = Number(value);
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds > 3600) {
    throw new CliUsageError('--timeout must be an integer from 1 to 3600 seconds');
  }
  return timeoutSeconds * 1000;
}

function validateDestructiveFlags(action, flags) {
  if (flags.yes && action !== 'purge') throw new CliUsageError('--yes is valid only with purge');
  if (action === 'purge' && !flags.yes) {
    throw new CliUsageError('purge requires --yes');
  }
}

function parseTokens(argv) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
    throw new TypeError('argv must be an array of strings');
  }
  const flags = { json: false, nonInteractive: false, timeoutMs: null, yes: false };
  const positionals = [];
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const [name, inlineValue] = token.split(/=(.*)/s, 2);
    if (!['--json', '--non-interactive', '--timeout', '--yes'].includes(name)) {
      throw new CliUsageError(`unknown option: ${name}`);
    }
    if (seen.has(name)) throw new CliUsageError(`duplicate option: ${name}`);
    seen.add(name);

    if (name === '--timeout') {
      const value = inlineValue ?? argv[++index];
      flags.timeoutMs = parseTimeout(value);
      continue;
    }
    if (inlineValue !== undefined) throw new CliUsageError(`${name} does not accept a value`);
    if (name === '--json') flags.json = true;
    if (name === '--non-interactive') flags.nonInteractive = true;
    if (name === '--yes') flags.yes = true;
  }
  return { flags, positionals };
}

export function parseCli(argv = process.argv.slice(2)) {
  const { flags, positionals } = parseTokens(argv);
  if (positionals[0] === 'lesson') {
    if (positionals.length !== 3) {
      throw new CliUsageError('lesson commands require exactly <id> and <action>');
    }
    const [, lessonId, action] = positionals;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,63})$/.test(lessonId)) {
      throw new CliUsageError(`invalid lesson id: ${lessonId}`);
    }
    if (!LESSON_COMMANDS.includes(action)) {
      throw new CliUsageError(`unknown lesson action: ${action}`);
    }
    validateDestructiveFlags(action, flags);
    return { scope: 'lesson', lessonId, action, flags };
  }

  if (positionals.length !== 1 || !COURSE_COMMANDS.includes(positionals[0])) {
    const action = positionals[0] ?? '(missing)';
    throw new CliUsageError(`unknown course action: ${action}`);
  }
  validateDestructiveFlags(positionals[0], flags);
  return { scope: 'course', lessonId: null, action: positionals[0], flags };
}
