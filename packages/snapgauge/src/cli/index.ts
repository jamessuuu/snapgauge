#!/usr/bin/env node
/**
 * The `snapgauge` bin — the only place in the codebase that touches
 * process.exit / process streams (SPEC §3: src/cli is the only home of
 * process.exit / env / cwd).
 */
import { runCli } from "./run.js";

const code = await runCli(
  process.argv.slice(2),
  {
    stdout: (text) => {
      process.stdout.write(`${text}\n`);
    },
    stderr: (text) => {
      process.stderr.write(`${text}\n`);
    },
  },
  { cwd: process.cwd(), env: process.env },
);
process.exit(code);
