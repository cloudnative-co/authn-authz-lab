#!/usr/bin/env node

import { runCli } from './course/runner/main.mjs';

process.exitCode = await runCli();
