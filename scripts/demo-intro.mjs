#!/usr/bin/env node

import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runCli } from '../course/runner/main.mjs';
import { loadCourseFoundation } from '../course/runner/lifecycle.mjs';
import { inspectProjectAppProcess, projectAppStateRoot } from '../course/runner/project-app-runtime.mjs';
import { readLesson04Runtime } from '../course/lessons/04/workspace.mjs';
import { runLesson04 } from '../course/lessons/04/runner.mjs';
import { beginMutation, commitTransaction, withMutationContext } from '../course/runner/transaction.mjs';
import { loadStateContext } from '../course/runner/state.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const successStatuses = new Set(['pass', 'safe-noop']);

class IntroDemoError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function buffer() {
  return { value: '', write(chunk) { this.value += String(chunk); } };
}

function belongsToRun(current, runId) {
  return typeof runId === 'string' && current.record?.instanceId?.split('.')[1] === runId;
}

async function stopIntroProcess({ foundation, stateRoot, setupRunId }) {
  const repoRoot = foundation.repositoryRealpath;
  const runId = randomUUID();
  const timestamp = new Date().toISOString();
  const signal = AbortSignal.timeout(10_000);
  const { lock, transaction } = await beginMutation({
    repoRoot, stateRoot, runId, timestamp, signal, mode: 'write',
    courseId: foundation.manifest.courseId,
    sourceRevision: foundation.courseLock.sourceRevision,
    sourceDigest: foundation.sourceDigest,
    nodeMajor: Number(process.versions.node.split('.')[0]),
    operationId: 'lesson:04:stop', command: 'stop',
  });
  try {
    const current = await inspectProjectAppProcess({ foundation, stateRoot });
    let result;
    if (current.status === 'running' && belongsToRun(current, setupRunId)) {
      result = await withMutationContext(transaction, () => runLesson04({
        action: 'stop', repoRoot, foundation, stateRoot, runId, timestamp, signal,
      }));
    } else if (['absent', 'stopped'].includes(current.status)) {
      result = { status: 'safe-noop' };
    } else {
      result = { status: 'blocked', reasonCode: 'INTRO_PROCESS_OWNERSHIP_CHANGED' };
    }
    const { state } = await loadStateContext({ repoRoot, stateRoot });
    await commitTransaction(transaction, { stateEpochAfter: state?.epoch ?? null, timestamp, signal });
    return result;
  } finally {
    await lock.release();
  }
}

export function validateIntroEvidence(runtime) {
  if (runtime?.schemaVersion !== 1 || runtime?.lessonId !== '04'
      || runtime.evidenceBasis !== 'project-app-runtime-http-cookie-project-core'
      || runtime.runtimeEvidence !== true || runtime.wireEvidence !== true
      || runtime.enforcement?.principalSource !== 'cookie-session'
      || runtime.enforcement?.callerRoleHeadersAccepted !== false
      || runtime.viewer?.status !== 403 || runtime.viewer?.projectPresentAfter !== true
      || runtime.owner?.status !== 204 || runtime.owner?.projectPresentAfter !== false) {
    throw new IntroDemoError('実 HTTP の観察結果が期待値と一致しません。Lesson 04 の diagnose を確認してください。');
  }
  return { bob: runtime.viewer.status, alice: runtime.owner.status };
}

function runtimeDependencies(repoRoot) {
  let foundation;
  async function context() {
    foundation ??= await loadCourseFoundation({ repoRoot });
    return { foundation, stateRoot: projectAppStateRoot(foundation) };
  }
  return {
    async command(args) {
      const stdout = buffer();
      const stderr = buffer();
      const exitCode = await runCli([...args, '--json'], { repoRoot, stdout, stderr });
      let result;
      try { result = JSON.parse(stdout.value); } catch {
        throw new IntroDemoError('runner の結果を読み取れませんでした。node course.mjs diagnose を確認してください。');
      }
      return { exitCode, result };
    },
    async inspectProcess() {
      return inspectProjectAppProcess(await context());
    },
    async readRuntime() {
      const { stateRoot } = await context();
      return readLesson04Runtime({ stateRoot, repoRoot });
    },
    async stopOwned(setupRunId) {
      return stopIntroProcess({ ...await context(), setupRunId });
    },
  };
}

export async function runIntroDemo({
  repoRoot = repositoryRoot,
  stdout = process.stdout,
  stderr = process.stderr,
  signal,
  dependencies = runtimeDependencies(repoRoot),
} = {}) {
  let setupRunId;
  let exitCode = 0;
  let observed;

  function requireNotInterrupted() {
    if (signal?.aborted) throw new IntroDemoError('初回デモを中断しました。', 130);
  }

  async function command(args) {
    requireNotInterrupted();
    const outcome = await dependencies.command(args);
    if (args.join(' ') === 'lesson 04 setup') setupRunId = outcome.result?.runId;
    if (outcome.exitCode !== 0 || !successStatuses.has(outcome.result?.status)) {
      const result = outcome.result ?? {};
      const explanation = [result.reasonCode, ...(result.recovery ?? [])].filter(Boolean).join('\n');
      throw new IntroDemoError(
        `node course.mjs ${args.join(' ')} が完了しませんでした。\n${explanation}`,
        outcome.exitCode || 1,
      );
    }
    stdout.write(`[PASS] ${args.join(' ')}\n`);
    return outcome.result;
  }

  try {
    await command(['doctor']);
    await command(['setup']);
    const initial = await dependencies.inspectProcess();
    if (!['absent', 'stopped'].includes(initial.status)) {
      throw new IntroDemoError(
        '既存の project-app を検出したため中断しました。実習の作業を終えてから node course.mjs lesson 04 stop を実行してください。',
      );
    }
    await command(['lesson', '04', 'doctor']);
    await command(['lesson', '04', 'setup']);
    const started = await dependencies.inspectProcess();
    if (started.status !== 'running' || !belongsToRun(started, setupRunId)) {
      throw new IntroDemoError('このデモが起動した project-app と確認できないため中断しました。');
    }
    await command(['lesson', '04', 'demo']);
    requireNotInterrupted();
    observed = validateIntroEvidence(await dependencies.readRuntime());
  } catch (error) {
    exitCode = error.exitCode || 1;
    stderr.write(`${error.message}\n`);
  } finally {
    if (setupRunId) {
      try {
        const result = await dependencies.stopOwned(setupRunId);
        if (!successStatuses.has(result?.status)) throw new IntroDemoError(
          `project-app を安全に停止できませんでした。${result?.reasonCode ?? ''}`,
        );
        stdout.write('[PASS] lesson 04 stop\n');
      } catch (error) {
        exitCode ||= error.exitCode || 1;
        stderr.write(`${error.message}\n停止状態は node course.mjs lesson 04 diagnose で確認してください。\n`);
      }
    }
  }
  if (signal?.aborted && exitCode === 0) {
    stderr.write('初回デモを中断しました。\n');
    exitCode = 130;
  }
  if (exitCode === 0) {
    stdout.write(`\nBob: HTTP ${observed.bob}（ログイン済みでも削除権限がないため拒否）\n`);
    stdout.write(`Alice: HTTP ${observed.alice}（所有者として削除に成功）\n`);
    stdout.write('観察結果: .lab/submissions/04/runtime.json\n');
    stdout.write('初回デモが完了しました。project-app は停止済みです。回答と観察結果は保存しています。\n');
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    if (process.argv.length > 2) throw new IntroDemoError('追加引数はありません。npm run demo:01 を実行してください。');
    process.exitCode = await runIntroDemo({ signal: controller.signal });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode || 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
