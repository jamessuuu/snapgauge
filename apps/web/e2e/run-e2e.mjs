#!/usr/bin/env node
/**
 * Orchestrates the e2e:smoke run around a deliberately STALE
 * `boards/<date>.json` fixture (SPEC §6/§10 M6 dead-man banner). Plain Node,
 * invoked directly (not through Playwright's `globalSetup`): Playwright
 * starts `webServer` (which runs `next build` — the STATIC generation step
 * that reads `boards/` off disk) BEFORE `globalSetup` runs
 * (microsoft/playwright#7597 / #24470 — this is documented, current
 * behavior, not a bug this repo can fix), so the fixture has to exist
 * before `playwright test` is invoked at all, not inside its lifecycle.
 *
 * The repo commits with `boards/` absent (no board runs exist yet, M6 is
 * not built) — this fixture is removed again once the run finishes,
 * regardless of pass/fail, so the working tree is unaffected.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const BOARDS_DIR = resolve(import.meta.dirname, "../../../boards");

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function plant() {
  mkdirSync(BOARDS_DIR, { recursive: true });
  const staleDate = isoDateDaysAgo(15);
  writeFileSync(
    resolve(BOARDS_DIR, `${staleDate}.json`),
    JSON.stringify(
      {
        rows: [
          { server: "e2e-fixture.example", era: "modern-only", checkedAt: `${staleDate}T00:00:00.000Z` },
        ],
      },
      null,
      2,
    ),
  );
}

function remove() {
  rmSync(BOARDS_DIR, { recursive: true, force: true });
}

plant();

// shell:true is required on Windows to resolve the pnpm.cmd shim; argv here
// is always locally/CI-supplied (playwright CLI flags), never remote input.
const playwright = spawn("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
});

playwright.on("close", (code) => {
  remove();
  process.exit(code ?? 1);
});

// Belt-and-suspenders: never leave the fixture behind even if the process
// is killed rather than exiting normally.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    remove();
    process.exit(1);
  });
}
