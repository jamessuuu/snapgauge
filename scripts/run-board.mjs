#!/usr/bin/env node
// The weekly board job's payload (SPEC §8/§10 M6), invoked by
// .github/workflows/board.yml. Imports the BUILT package (like
// scripts/generate-rules.mjs) — run `pnpm --filter snapgauge build` first.
//
// Deliberately a NO-OP when boards/roster.json has zero targets (this
// build's hard rule: the roster stays empty, no third-party target is
// probed) — it reads the roster, logs that there is nothing to check, and
// exits 0 without writing or committing anything. A malformed roster.json
// is NOT swallowed the same way: that is a config bug the job should
// surface loudly, not hide.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoardRow, SNAPGAUGE_VERSION } from "../packages/snapgauge/dist/index.js";
import { checkBoardTarget, readRosterFile, writeBoardFileAtomic } from "../packages/snapgauge/dist/node/index.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const rosterPath = resolve(repoRoot, "boards/roster.json");

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const roster = readRosterFile(rosterPath);
  const names = Object.keys(roster.targets).sort();

  if (names.length === 0) {
    console.log("boards/roster.json has zero targets — no-op (SPEC §11 Q1: the roster is James's go/no-go).");
    return;
  }

  const date = todayUtc();
  const generatedAt = new Date().toISOString();
  const resultBase = `https://github.com/jamessuuu/snapgauge/blob/main/boards/${date}.json`;

  const rows = [];
  for (const name of names) {
    const target = roster.targets[name];
    const checkedAt = new Date().toISOString();
    console.log(`checking ${name} (${target.url}) ...`);
    const outcome = await checkBoardTarget({
      url: target.url,
      protocolVersion: target.protocolVersion,
    });
    const row = buildBoardRow({
      server: name,
      url: target.url,
      checkedAt,
      command: `snapgauge compat ${name} --config boards/roster.json`,
      resultUrl: `${resultBase}#${name}`,
      status: outcome.status,
      statusDetail: outcome.statusDetail,
      era: outcome.era,
      supportedVersions: outcome.supportedVersions,
      assertions: outcome.assertions,
      findings: outcome.findings,
      reportedAt: target.reportedAt,
      publishedAt: target.publishedAt,
    });
    console.log(
      `  status=${row.status} mustViolationCount=${String(row.mustViolationCount)} publishable=${String(row.publishable)}`,
    );
    rows.push(row);
  }

  const boardPath = resolve(repoRoot, `boards/${date}.json`);
  writeBoardFileAtomic(boardPath, { date, generatedAt, snapgaugeVersion: SNAPGAUGE_VERSION, rows });
  console.log(`wrote ${boardPath} (${String(rows.length)} row(s))`);
}

await main();
