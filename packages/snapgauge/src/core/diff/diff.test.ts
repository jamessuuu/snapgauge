import { describe, expect, it } from "vitest";
import { SnapgaugeError } from "../errors.js";
import { probeSpecHash, type ProbeSpec } from "../snapshot/canonical.js";
import { RULESET_VERSION, SnapshotV1Schema, type SnapshotV1 } from "../snapshot/schema.js";
import { SNAPGAUGE_VERSION } from "../version.js";
import { diffSnapshots, gateFailed, parseTier, tierRank, TIERS } from "./diff.js";

const SPEC: ProbeSpec = { probes: [], profiles: ["modern-full"] };

type TestTool = { name: string } & Record<string, unknown>;

function tool(name: string, extra?: Record<string, unknown>): TestTool {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    ...extra,
  };
}

function snap(options?: {
  tools?: TestTool[];
  version?: string;
  probeSpec?: ProbeSpec;
  recordedAt?: string;
}): SnapshotV1 {
  const tools = options?.tools ?? [];
  return SnapshotV1Schema.parse({
    formatVersion: 1,
    snapgaugeVersion: SNAPGAUGE_VERSION,
    rulesetVersion: RULESET_VERSION,
    probeSpecHash: probeSpecHash(options?.probeSpec ?? SPEC),
    recordedAt: options?.recordedAt ?? "2026-08-08T00:00:00Z",
    target: {
      transport: "fixture",
      host: "t",
      path: "",
      protocolVersion: "2026-07-28",
      auth: "none",
    },
    discover: {
      supportedVersions: ["2026-07-28"],
      capabilities: {},
      serverInfo: { name: "t", version: options?.version ?? "1.0.0" },
    },
    tools,
    toolsList: { order: tools.map((t) => t.name), pages: 1, orderStable: true },
  });
}

function findingKeys(a: SnapshotV1, b: SnapshotV1): string[] {
  return diffSnapshots(a, b).findings.map((f) => `${f.tier}|${f.ruleId}|${f.subject}`);
}

describe("diffSnapshots — the six M1 rules (SPEC §5, §10)", () => {
  it("tool.removed (breaking)", () => {
    const a = snap({ tools: [tool("kept"), tool("gone")] });
    const b = snap({ tools: [tool("kept")] });
    expect(findingKeys(a, b)).toEqual(["breaking|tool.removed|tools.gone"]);
  });

  it("tool.input.required.added (breaking) for an existing property made required", () => {
    const a = snap({
      tools: [tool("t", { inputSchema: { type: "object", properties: { x: {}, y: {} }, required: ["x"] } })],
    });
    const b = snap({
      tools: [tool("t", { inputSchema: { type: "object", properties: { x: {}, y: {} }, required: ["x", "y"] } })],
    });
    expect(findingKeys(a, b)).toEqual([
      "breaking|tool.input.required.added|tools.t.inputSchema.required.y",
    ]);
  });

  it("a NEW required property fires required.added only — never also optional.added", () => {
    const a = snap({
      tools: [tool("t", { inputSchema: { type: "object", properties: { x: {} }, required: ["x"] } })],
    });
    const b = snap({
      tools: [tool("t", { inputSchema: { type: "object", properties: { x: {}, d: {} }, required: ["x", "d"] } })],
    });
    expect(findingKeys(a, b)).toEqual([
      "breaking|tool.input.required.added|tools.t.inputSchema.required.d",
    ]);
  });

  it("tool.description.changed (risky — SPEC §5: descriptions are the trigger surface) with before/after", () => {
    const a = snap({ tools: [tool("t", { description: "old words" })] });
    const b = snap({ tools: [tool("t", { description: "new words" })] });
    const [finding, ...rest] = diffSnapshots(a, b).findings;
    expect(rest).toEqual([]);
    if (finding === undefined) throw new Error("expected one finding");
    expect(finding.ruleId).toBe("tool.description.changed");
    expect(finding.tier).toBe("risky");
    expect(finding.before).toBe("old words");
    expect(finding.after).toBe("new words");
  });

  it("tool.input.optional.added (compatible)", () => {
    const a = snap({
      tools: [tool("t", { inputSchema: { type: "object", properties: { x: {} }, required: ["x"] } })],
    });
    const b = snap({
      tools: [tool("t", { inputSchema: { type: "object", properties: { x: {}, opt: {} }, required: ["x"] } })],
    });
    expect(findingKeys(a, b)).toEqual([
      "compatible|tool.input.optional.added|tools.t.inputSchema.properties.opt",
    ]);
  });

  it("tool.icons.changed (cosmetic), including icons appearing", () => {
    const a = snap({ tools: [tool("t")] });
    const b = snap({ tools: [tool("t", { icons: [{ src: "icons/new.svg" }] })] });
    expect(findingKeys(a, b)).toEqual(["cosmetic|tool.icons.changed|tools.t.icons"]);
  });

  it("serverInfo.version.changed (cosmetic) with before/after", () => {
    const a = snap({ version: "1.0.0" });
    const b = snap({ version: "2.0.0" });
    const [finding, ...rest] = diffSnapshots(a, b).findings;
    expect(rest).toEqual([]);
    if (finding === undefined) throw new Error("expected one finding");
    expect(finding.ruleId).toBe("serverInfo.version.changed");
    expect(finding.before).toBe("1.0.0");
    expect(finding.after).toBe("2.0.0");
  });

  it("identical snapshots produce zero findings, even recorded at different times", () => {
    const a = snap({ tools: [tool("t")], recordedAt: "2026-08-08T00:00:00Z" });
    const b = snap({ tools: [tool("t")], recordedAt: "2026-08-09T00:00:00Z" });
    expect(diffSnapshots(a, b).findings).toEqual([]);
  });

  it("orders findings by tier (breaking first), then ruleId, then subject", () => {
    const a = snap({ tools: [tool("gone"), tool("t", { icons: [{ src: "1.svg" }] })], version: "1.0.0" });
    const b = snap({ tools: [tool("t", { icons: [{ src: "2.svg" }] })], version: "2.0.0" });
    const tiers = diffSnapshots(a, b).findings.map((f) => f.tier);
    expect(tiers).toEqual(["breaking", "cosmetic", "cosmetic"]);
  });

  it("refuses to compare across differing probe specs (SPEC §2 Decision 3 -> exit 4)", () => {
    const a = snap();
    const b = snap({ probeSpec: { probes: [], profiles: ["modern-full", "extra"] } });
    try {
      diffSnapshots(a, b);
      expect.unreachable("expected SPEC_MISMATCH");
    } catch (error) {
      if (!(error instanceof SnapgaugeError)) throw error;
      expect(error.code).toBe("SPEC_MISMATCH");
    }
  });
});

describe("gate (SPEC §5: default failOn risky)", () => {
  const cosmeticOnly = diffSnapshots(snap({ version: "1.0.0" }), snap({ version: "1.0.1" }));
  const breaking = diffSnapshots(snap({ tools: [tool("gone")] }), snap({ tools: [] }));

  it("cosmetic-only drift passes the default gate but fails a cosmetic gate", () => {
    expect(gateFailed(cosmeticOnly, "risky")).toBe(false);
    expect(gateFailed(cosmeticOnly, "cosmetic")).toBe(true);
  });

  it("breaking drift fails every gate", () => {
    for (const tier of TIERS) {
      expect(gateFailed(breaking, tier)).toBe(true);
    }
  });

  it("tierRank is ascending severity", () => {
    expect(tierRank("breaking")).toBeGreaterThan(tierRank("risky"));
    expect(tierRank("risky")).toBeGreaterThan(tierRank("compatible"));
    expect(tierRank("compatible")).toBeGreaterThan(tierRank("cosmetic"));
  });

  it("parseTier accepts the four tiers and rejects anything else as USAGE", () => {
    expect(parseTier("breaking")).toBe("breaking");
    try {
      parseTier("catastrophic");
      expect.unreachable("expected USAGE");
    } catch (error) {
      if (!(error instanceof SnapgaugeError)) throw error;
      expect(error.code).toBe("USAGE");
    }
  });
});
