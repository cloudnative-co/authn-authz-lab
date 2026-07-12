#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const integrationRoot = resolve(repositoryRoot, 'test-integration');
const testFiles = (await readdir(integrationRoot))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => resolve(integrationRoot, name));

const child = spawn(process.execPath, [
  '--test',
  '--test-concurrency=1',
  ...testFiles,
], {
  cwd: repositoryRoot,
  env: { ...process.env, COURSE_TEST_DOCKER: '1' },
  stdio: 'inherit',
});

const exitCode = await new Promise((resolvePromise, rejectPromise) => {
  child.once('error', rejectPromise);
  child.once('exit', (code, signal) => {
    if (signal) {
      rejectPromise(new Error(`integration test process exited with signal ${signal}`));
      return;
    }
    resolvePromise(code ?? 1);
  });
});

process.exitCode = exitCode;
