/**
 * Compat eval set (SPEC §7 + §10 M4 gate): each degrader fixture — plus
 * nonconformant-legacy, paginated, bad-x-mcp-header and xhdr-live-bad —
 * must produce EXACTLY the expected finding set (set equality over
 * class|ruleId|subject; a false positive fails as hard as a miss), the
 * expected verdict matrix, the expected era, and the expected exit code.
 *
 * Exit 3 vs exit 1 is proven here: degrader-silent (risky, exit 1) against
 * degrader-liar (violation, exit 3) — different owner, different fix.
 */
import { readdirSync, readFileSync } from "node:fs";
import { CheckOutputSchema, ERAS, VERDICTS } from "snapgauge";
import { runCli, type CliIo } from "snapgauge/bin";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const CompatCaseSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  fixture: z.string().min(1),
  profiles: z.array(z.string().min(1)).min(1),
  expectedExit: z.number().int().nonnegative(),
  expectedEra: z.enum(ERAS),
  expectedFindings: z.array(
    z.strictObject({
      ruleId: z.string(),
      class: z.enum(["violation", "risky", "info"]),
      subject: z.string(),
    }),
  ),
  expectedVerdicts: z.record(z.string(), z.record(z.string(), z.enum(VERDICTS))),
});
type CompatCase = z.infer<typeof CompatCaseSchema>;

const casesDir = new URL("./cases/compat/", import.meta.url);
const cases: CompatCase[] = readdirSync(casesDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => CompatCaseSchema.parse(JSON.parse(readFileSync(new URL(file, casesDir), "utf8"))));

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t) => { out.push(t); }, stderr: (t) => { err.push(t); } },
    out,
    err,
  };
}

async function runCompatCase(compatCase: CompatCase) {
  const { io, out, err } = capture();
  const code = await runCli(
    [
      "compat",
      "--fixture", compatCase.fixture,
      "--profiles", compatCase.profiles.join(","),
      "--json",
    ],
    io,
  );
  const output = CheckOutputSchema.parse(JSON.parse(out.join("\n")));
  return { code, output, err };
}

function findingKey(f: { ruleId: string; class: string; subject: string }): string {
  return `${f.class}|${f.ruleId}|${f.subject}`;
}

describe("compat eval set (SPEC §7/§10: exact finding sets)", () => {
  it("covers the SPEC §7 M4 roster", () => {
    const fixtures = new Set(cases.map((c) => c.fixture));
    for (const required of [
      "degrader-honest",
      "degrader-silent",
      "degrader-liar",
      "nonconformant-legacy",
      "paginated",
      "bad-x-mcp-header",
    ]) {
      expect(fixtures.has(required), required).toBe(true);
    }
  });

  for (const compatCase of cases) {
    it(compatCase.name, async () => {
      const { code, output, err } = await runCompatCase(compatCase);
      expect(code, err.join("\n")).toBe(compatCase.expectedExit);
      const compat = output.compat;
      if (compat === undefined) throw new Error("compat section missing");
      expect(compat.era).toBe(compatCase.expectedEra);
      // Set equality: any miss OR any false positive fails the case.
      const actual = compat.findings.map(findingKey).sort();
      const expected = compatCase.expectedFindings.map(findingKey).sort();
      expect(actual).toEqual(expected);
      expect(compat.verdicts).toEqual(compatCase.expectedVerdicts);
      expect(output.exitCode).toBe(compatCase.expectedExit);
    });
  }

  it("exit 3 is DISTINCT from exit 1: silent degradation gates, lying violates (SPEC §5)", async () => {
    const silent = cases.find((c) => c.fixture === "degrader-silent");
    const liar = cases.find((c) => c.fixture === "degrader-liar");
    if (silent === undefined || liar === undefined) throw new Error("degrader cases missing");
    const silentRun = await runCompatCase(silent);
    const liarRun = await runCompatCase(liar);
    expect(silentRun.code).toBe(1);
    expect(liarRun.code).toBe(3);
    expect(silentRun.code).not.toBe(liarRun.code);
  });
});
