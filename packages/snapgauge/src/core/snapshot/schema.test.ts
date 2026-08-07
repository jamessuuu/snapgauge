import { describe, expect, it } from "vitest";
import { SNAPGAUGE_VERSION } from "../version.js";
import { probeSpecHash } from "./canonical.js";
import { RULESET_VERSION, SnapshotV1Schema } from "./schema.js";

function base(): Record<string, unknown> {
  return {
    formatVersion: 1,
    snapgaugeVersion: SNAPGAUGE_VERSION,
    rulesetVersion: RULESET_VERSION,
    probeSpecHash: probeSpecHash({ probes: [], profiles: ["modern-full"] }),
    recordedAt: "2026-08-08T10:20:30Z",
    target: {
      transport: "fixture",
      host: "clean@v1",
      path: "",
      protocolVersion: "2026-07-28",
      auth: "none",
    },
    discover: {
      supportedVersions: ["2026-07-28"],
      capabilities: {},
      serverInfo: { name: "t", version: "1.0.0" },
      ttlMs: 60000,
      cacheScope: "public",
    },
    tools: [
      {
        name: "get_weather",
        description: "d",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
    toolsList: { order: ["get_weather"], pages: 1, ttlMs: 60000, cacheScope: "public", orderStable: true },
  };
}

describe("SnapshotV1Schema (SPEC §2)", () => {
  it("accepts a well-formed v1 snapshot", () => {
    expect(SnapshotV1Schema.safeParse(base()).success).toBe(true);
  });

  it("rejects unknown top-level keys (strict format: unknown keys belong to a higher formatVersion)", () => {
    expect(SnapshotV1Schema.safeParse({ ...base(), surprise: true }).success).toBe(false);
  });

  it("rejects a higher formatVersion (Decision 3: readers refuse, never guess)", () => {
    expect(SnapshotV1Schema.safeParse({ ...base(), formatVersion: 2 }).success).toBe(false);
  });

  it("rejects unknown keys inside a tool entry", () => {
    const snapshot = base();
    snapshot.tools = [
      {
        name: "t",
        inputSchema: {},
        futureField: 1,
      },
    ];
    expect(SnapshotV1Schema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects a malformed probeSpecHash", () => {
    expect(SnapshotV1Schema.safeParse({ ...base(), probeSpecHash: "xyz" }).success).toBe(false);
  });

  it("rejects a non-ISO recordedAt", () => {
    expect(SnapshotV1Schema.safeParse({ ...base(), recordedAt: "yesterday" }).success).toBe(false);
  });
});
