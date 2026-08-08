/**
 * The offline demo's engine (SPEC §4/§10 M5): the SAME core `record` +
 * `diffSnapshots` the CLI's `record`/`diff` commands run, against the
 * bundled fixture servers, entirely in-process — zero network. This module
 * only imports the isomorphic "." entry of "snapgauge" (core: zero I/O) plus
 * "@snapgauge/fixtures" (itself zero I/O at runtime — see packages/fixtures
 * server.ts: only type-only imports from "snapgauge"), so it is safe to run
 * inside a browser Web Worker exactly as it runs inside the CLI or a Vercel
 * function (SPEC §3 boundary).
 */
import {
  createFixtureTransport,
  diffSnapshots,
  EXIT,
  exitCodeForError,
  gateFailed,
  MODERN_FULL,
  SnapgaugeError,
  record,
  type ExitCode,
  type Finding,
  type SnapshotTarget,
  type Tier,
} from "snapgauge";
import { getFixtureEntry } from "@snapgauge/fixtures";
import { DEMO_BASE_FIXTURE, isDemoPairId } from "./demo-pairs.js";

/** Pinned (not `Date.now()`): the offline demo has no clock reason to vary,
 * and `recordedAt` is metadata excluded from every diff anyway (SPEC §2 D2). */
const RECORDED_AT = "2026-01-01T00:00:00.000Z";

export interface DemoRunResult {
  ok: boolean;
  pairId: string;
  findings?: Finding[];
  summary?: Record<Tier, number>;
  gate?: { failOn: Tier; failed: boolean };
  incomplete?: boolean;
  probeFailures?: string[];
  exitCode: ExitCode;
  error?: { code: string; message: string };
}

function fixtureTarget(fixture: string): SnapshotTarget {
  return {
    transport: "fixture",
    host: fixture,
    path: "",
    protocolVersion: MODERN_FULL.protocolVersion,
    auth: "none",
  };
}

export async function runDemoPair(pairId: string): Promise<DemoRunResult> {
  if (!isDemoPairId(pairId)) {
    return {
      ok: false,
      pairId,
      exitCode: EXIT.USAGE,
      error: { code: "USAGE", message: `unknown demo pair: "${pairId}"` },
    };
  }
  const baseEntry = getFixtureEntry(DEMO_BASE_FIXTURE);
  const targetEntry = getFixtureEntry(pairId);
  if (baseEntry === undefined || targetEntry === undefined) {
    return {
      ok: false,
      pairId,
      exitCode: EXIT.INTERNAL,
      error: { code: "INTERNAL", message: `fixture registry is missing "${DEMO_BASE_FIXTURE}" or "${pairId}"` },
    };
  }

  // Both sides of every pair record under the SAME declared probe spec —
  // clean@v1's — so probeSpecHash always matches (SPEC §2 Decision 3: a
  // snapshot is only comparable to one recorded under the same probe spec).
  // This is what lets even a wholly unrelated fixture (degrader-liar,
  // nonconformant-legacy) diff cleanly against the clean@v1 baseline instead
  // of throwing SPEC_MISMATCH.
  const probeSpec = { probes: baseEntry.probes, profiles: [MODERN_FULL.name] };

  try {
    const [before, after] = await Promise.all([
      record({
        transport: createFixtureTransport(baseEntry.server, MODERN_FULL, baseEntry.raw),
        target: fixtureTarget(DEMO_BASE_FIXTURE),
        probeSpec,
        recordedAt: RECORDED_AT,
        clientCapabilities: MODERN_FULL.clientCapabilities,
      }),
      record({
        transport: createFixtureTransport(targetEntry.server, MODERN_FULL, targetEntry.raw),
        target: fixtureTarget(pairId),
        probeSpec,
        recordedAt: RECORDED_AT,
        clientCapabilities: MODERN_FULL.clientCapabilities,
      }),
    ]);
    const probeFailures = [...before.probeFailures, ...after.probeFailures].map(
      (failure) => `${failure.probeId}: ${failure.message}`,
    );
    const diff = diffSnapshots(before.snapshot, after.snapshot);
    const failOn: Tier = "risky";
    const failed = gateFailed(diff, failOn);
    const incomplete = probeFailures.length > 0;
    const exitCode: ExitCode = incomplete ? EXIT.PROBE : failed ? EXIT.DRIFT : EXIT.CLEAN;
    return {
      ok: true,
      pairId,
      findings: diff.findings,
      summary: diff.summary,
      gate: { failOn, failed },
      incomplete,
      probeFailures,
      exitCode,
    };
  } catch (error) {
    if (error instanceof SnapgaugeError) {
      return {
        ok: false,
        pairId,
        exitCode: exitCodeForError(error.code),
        error: { code: error.code, message: error.message },
      };
    }
    return {
      ok: false,
      pairId,
      exitCode: EXIT.INTERNAL,
      error: { code: "INTERNAL", message: error instanceof Error ? error.message : String(error) },
    };
  }
}
