import { describe, expect, it } from "vitest";
import { BoardFileSchema, BoardRowSchema, RosterSchema } from "./schema.js";

describe("RosterSchema (SPEC §8/§11 Q1: the board target list)", () => {
  it("accepts the shipped empty roster", () => {
    const parsed = RosterSchema.safeParse({ targets: {} });
    expect(parsed.success).toBe(true);
  });

  it("accepts a minimal target (url only)", () => {
    const parsed = RosterSchema.safeParse({
      targets: { acme: { url: "https://mcp.acme.example/mcp" } },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an http:// (non-TLS) url — the board is unauthenticated read-only, https only", () => {
    const parsed = RosterSchema.safeParse({
      targets: { acme: { url: "http://mcp.acme.example/mcp" } },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a target carrying auth headers — structurally, there is no field for it", () => {
    const parsed = RosterSchema.safeParse({
      targets: {
        acme: { url: "https://mcp.acme.example/mcp", headers: { Authorization: "Bearer x" } },
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a target declaring probes — structurally, the board never calls tools/call", () => {
    const parsed = RosterSchema.safeParse({
      targets: {
        acme: {
          url: "https://mcp.acme.example/mcp",
          probes: [{ id: "x", tool: "y", arguments: {} }],
        },
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts reportedAt/publishedAt disclosure-workflow metadata", () => {
    const parsed = RosterSchema.safeParse({
      targets: {
        acme: {
          url: "https://mcp.acme.example/mcp",
          reportedAt: "2026-08-01T00:00:00.000Z",
          publishedAt: "2026-08-08T00:00:00.000Z",
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown keys (strict object, SPEC §9)", () => {
    const parsed = RosterSchema.safeParse({ targets: {}, extra: true });
    expect(parsed.success).toBe(false);
  });
});

describe("BoardRowSchema", () => {
  const minimal = {
    server: "acme",
    url: "https://mcp.acme.example/mcp",
    checkedAt: "2026-08-09T00:00:00.000Z",
    command: "snapgauge compat acme --config boards/roster.json",
    resultUrl: "https://github.com/jamessuuu/snapgauge/blob/main/boards/2026-08-09.json#acme",
    status: "ok",
    mustViolationCount: 0,
    publishable: true,
  };

  it("accepts a minimal publishable row with no findings attached", () => {
    expect(BoardRowSchema.safeParse(minimal).success).toBe(true);
  });

  it("accepts a full row with assertions/findings/era/supportedVersions", () => {
    const parsed = BoardRowSchema.safeParse({
      ...minimal,
      era: "modern-only",
      supportedVersions: ["2026-07-28"],
      assertions: [{ id: "transport.get_not_405", level: "SHOULD", verdict: "pass", detail: "d", cite: "c" }],
      findings: [{ ruleId: "compat.era", class: "info", subject: "discover", message: "m" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts unreachable/auth_required rows with a statusDetail and no findings", () => {
    expect(
      BoardRowSchema.safeParse({
        ...minimal,
        status: "unreachable",
        statusDetail: "PROBE_FAILURE: connection refused",
      }).success,
    ).toBe(true);
    expect(
      BoardRowSchema.safeParse({ ...minimal, status: "auth_required" }).success,
    ).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(BoardRowSchema.safeParse({ ...minimal, status: "flaky" }).success).toBe(false);
  });

  it("rejects unknown keys (strict object)", () => {
    expect(BoardRowSchema.safeParse({ ...minimal, score: 42 }).success).toBe(false);
  });
});

describe("BoardFileSchema", () => {
  it("accepts a well-formed board file with zero rows", () => {
    const parsed = BoardFileSchema.safeParse({
      date: "2026-08-09",
      generatedAt: "2026-08-09T06:17:00.000Z",
      snapgaugeVersion: "1.0.0-rc.1",
      rows: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed date stem", () => {
    const parsed = BoardFileSchema.safeParse({
      date: "08-09-2026",
      generatedAt: "2026-08-09T06:17:00.000Z",
      snapgaugeVersion: "1.0.0-rc.1",
      rows: [],
    });
    expect(parsed.success).toBe(false);
  });
});
