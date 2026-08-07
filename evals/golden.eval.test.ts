/**
 * Golden eval cases (SPEC §7, CI stage 5). Each case names a fixture pair +
 * profile and the EXACT expected set of finding (ruleId, tier, subject)
 * triples; scoring is set equality, so a false positive fails the case as
 * hard as a miss. Cases run through the real CLI (`runCli`) — record two
 * snapshots over the fixture transport, then offline diff — so the golden
 * set exercises the same path CI consumers run, exit codes included.
 *
 * M1 bar: 3 cases at 100% exact match. The set grows to ≥30 at M3 (SPEC §7).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiffOutputSchema, TIERS } from "snapgauge";
import { runCli, type CliIo } from "snapgauge/bin";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

const CaseSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  fixtureA: z.string().min(1),
  fixtureB: z.string().min(1),
  profile: z.string().min(1),
  failOn: z.enum(TIERS),
  expectedExit: z.number().int().nonnegative(),
  expectedFindings: z.array(
    z.strictObject({ ruleId: z.string(), tier: z.enum(TIERS), subject: z.string() }),
  ),
});
type GoldenCase = z.infer<typeof CaseSchema>;

const casesDir = new URL("./cases/", import.meta.url);
const caseFiles = readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort();
const cases: GoldenCase[] = caseFiles.map((file) =>
  CaseSchema.parse(JSON.parse(readFileSync(new URL(file, casesDir), "utf8"))),
);

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

async function recordPair(golden: GoldenCase): Promise<{ a: string; b: string }> {
  const dir = mkdtempSync(join(tmpdir(), "snapgauge-eval-"));
  tempDirs.push(dir);
  for (const [target, fixture] of [
    ["a", golden.fixtureA],
    ["b", golden.fixtureB],
  ] as const) {
    const { io, err } = capture();
    const code = await runCli(
      ["record", target, "--fixture", fixture, "--profile", golden.profile, "--dir", dir],
      io,
    );
    expect(code, `record ${fixture}: ${err.join("\n")}`).toBe(0);
  }
  return { a: join(dir, "a.snapshot.json"), b: join(dir, "b.snapshot.json") };
}

function findingKey(f: { ruleId: string; tier: string; subject: string }): string {
  return `${f.tier}|${f.ruleId}|${f.subject}`;
}

describe("golden eval set (SPEC §7: 100% exact match)", () => {
  it("carries exactly the M1 case count (grows to ≥30 at M3)", () => {
    expect(cases).toHaveLength(3);
  });

  for (const golden of cases) {
    it(golden.name, async () => {
      const files = await recordPair(golden);
      const { io, out, err } = capture();
      const code = await runCli(
        ["diff", files.a, files.b, "--json", "--fail-on", golden.failOn],
        io,
      );
      expect(code, err.join("\n")).toBe(golden.expectedExit);

      const output = DiffOutputSchema.parse(JSON.parse(out.join("\n")));
      const actual = output.findings.map(findingKey).sort();
      const expected = golden.expectedFindings.map(findingKey).sort();
      // Set equality: any miss OR any false positive fails the case.
      expect(actual).toEqual(expected);
    });
  }

  it("cosmetic-only: the findings are LISTED in human output even though the gate passes", async () => {
    const golden = cases.find((c) => c.name === "cosmetic-only-listed-not-gated");
    if (golden === undefined) throw new Error("cosmetic case missing");
    const files = await recordPair(golden);
    const { io, out } = capture();
    const code = await runCli(["diff", files.a, files.b], io);
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("tool.icons.changed");
    expect(text).toContain("serverInfo.version.changed");
    expect(text).toContain("below the gate");
  });
});
