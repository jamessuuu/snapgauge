/**
 * The three additional M3 gates beside the golden set (SPEC §7 / §10):
 *
 * - FALSE-POSITIVE suite: clean→clean under EVERY registered profile must
 *   yield zero findings (the loop covers all nine automatically when the
 *   M4 profiles land — it iterates profileNames()).
 * - STABILITY eval: record the same fixture twice → byte-identical
 *   canonical snapshot files (recordedAt pinned via --recorded-at).
 * - DETERMINISM eval: a fixture that serves the identical surface with
 *   scrambled wire KEY order must produce an IDENTICAL snapshot —
 *   serialization noise never reaches the committed format (Decision 2).
 */
import { getFixtureEntry } from "@snapgauge/fixtures";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalStringify,
  createFixtureTransport,
  DiffOutputSchema,
  getProfile,
  profileNames,
  record,
  type SnapshotTarget,
} from "snapgauge";
import { runCli, type CliIo } from "snapgauge/bin";
import { afterAll, describe, expect, it } from "vitest";

const PINNED_AT = "2026-08-08T00:00:00Z";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t) => { out.push(t); }, stderr: (t) => { err.push(t); } },
    out,
    err,
  };
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "snapgauge-suites-"));
  tempDirs.push(dir);
  return dir;
}

async function recordTo(
  dir: string,
  target: string,
  fixture: string,
  profile: string,
): Promise<string> {
  const { io, err } = capture();
  const code = await runCli(
    [
      "record", target,
      "--fixture", fixture,
      "--profile", profile,
      "--dir", dir,
      "--recorded-at", PINNED_AT,
    ],
    io,
  );
  expect(code, err.join("\n")).toBe(0);
  return join(dir, `${target}.snapshot.json`);
}

describe("false-positive suite (SPEC §7: clean→clean, every profile, zero findings)", () => {
  for (const profile of profileNames()) {
    it(`profile ${profile}: identical pair yields ZERO findings and exit 0`, async () => {
      const dir = tempDir();
      const a = await recordTo(dir, "a", "clean@v1", profile);
      const b = await recordTo(dir, "b", "clean@v2-identical", profile);
      const { io, out, err } = capture();
      const code = await runCli(["diff", a, b, "--json", "--fail-on", "cosmetic"], io);
      expect(code, err.join("\n")).toBe(0);
      const output = DiffOutputSchema.parse(JSON.parse(out.join("\n")));
      expect(output.findings).toEqual([]);
    });
  }
});

describe("stability eval (SPEC §7: record twice → byte-identical)", () => {
  it("two records of clean@v1 with a pinned recordedAt are byte-identical files", async () => {
    const dir = tempDir();
    const first = await recordTo(dir, "one", "clean@v1", "modern-full");
    const second = await recordTo(dir, "two", "clean@v1", "modern-full");
    expect(readFileSync(first, "utf8")).toBe(readFileSync(second, "utf8"));
  });
});

describe("determinism eval (SPEC §7: shuffled wire key order → identical snapshot)", () => {
  it("clean@v1 and clean@v1-shuffled produce the same canonical snapshot", async () => {
    const clean = getFixtureEntry("clean@v1");
    const shuffled = getFixtureEntry("clean@v1-shuffled");
    const profile = getProfile("modern-full");
    if (clean === undefined || shuffled === undefined || profile === undefined) {
      throw new Error("fixture or profile missing");
    }
    // Same declared target identity for both — the shuffle is transport
    // noise, not a different target.
    const target: SnapshotTarget = {
      transport: "fixture",
      host: "determinism",
      path: "",
      protocolVersion: profile.protocolVersion,
      auth: "none",
    };
    const outcomes = await Promise.all(
      [clean, shuffled].map((entry) =>
        record({
          transport: createFixtureTransport(entry.server, profile, entry.raw),
          target,
          probeSpec: { probes: entry.probes, profiles: [profile.name] },
          recordedAt: PINNED_AT,
          clientCapabilities: profile.clientCapabilities,
        }),
      ),
    );
    const [a, b] = outcomes;
    if (a === undefined || b === undefined) throw new Error("record failed");
    expect(a.probeFailures).toEqual([]);
    expect(b.probeFailures).toEqual([]);
    expect(canonicalStringify(b.snapshot)).toBe(canonicalStringify(a.snapshot));
  });
});
