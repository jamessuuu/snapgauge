import { describe, expect, it } from "vitest";
import { buildBoardRow, isPublishable, mustViolationCountOf } from "./disclosure.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const REPORTED = "2026-08-01T00:00:00.000Z";
const plus = (ms: number): string => new Date(Date.parse(REPORTED) + ms).toISOString();

describe("isPublishable (SPEC §8 binding disclosure policy)", () => {
  it("zero MUST-level violations is always publishable, even with no dates", () => {
    expect(isPublishable({ mustViolationCount: 0 })).toBe(true);
  });

  it("a MUST-level violation with no reportedAt is not publishable", () => {
    expect(isPublishable({ mustViolationCount: 1 })).toBe(false);
  });

  it("reportedAt set but no publishedAt is not publishable", () => {
    expect(isPublishable({ mustViolationCount: 1, reportedAt: REPORTED })).toBe(false);
  });

  it("boundary: 7 days minus 1ms is NOT publishable", () => {
    expect(
      isPublishable({
        mustViolationCount: 1,
        reportedAt: REPORTED,
        publishedAt: plus(SEVEN_DAYS_MS - 1),
      }),
    ).toBe(false);
  });

  it("boundary: exactly 7 days later IS publishable (\"≥7 days\" is inclusive)", () => {
    expect(
      isPublishable({
        mustViolationCount: 1,
        reportedAt: REPORTED,
        publishedAt: plus(SEVEN_DAYS_MS),
      }),
    ).toBe(true);
  });

  it("boundary: 7 days plus 1ms is publishable", () => {
    expect(
      isPublishable({
        mustViolationCount: 1,
        reportedAt: REPORTED,
        publishedAt: plus(SEVEN_DAYS_MS + 1),
      }),
    ).toBe(true);
  });

  it("well past the embargo is publishable", () => {
    expect(
      isPublishable({ mustViolationCount: 3, reportedAt: REPORTED, publishedAt: plus(30 * SEVEN_DAYS_MS) }),
    ).toBe(true);
  });

  it("publishedAt before reportedAt is never publishable (negative gap)", () => {
    expect(
      isPublishable({ mustViolationCount: 1, reportedAt: REPORTED, publishedAt: plus(-1) }),
    ).toBe(false);
  });

  it("unparseable dates never validate to true", () => {
    expect(
      isPublishable({ mustViolationCount: 1, reportedAt: "not-a-date", publishedAt: "also-not-a-date" }),
    ).toBe(false);
  });
});

describe("mustViolationCountOf", () => {
  it("counts failed MUST assertions and violation-class findings, nothing else", () => {
    const count = mustViolationCountOf({
      assertions: [
        { id: "a1", level: "MUST", verdict: "fail", detail: "d", cite: "c" },
        { id: "a2", level: "MUST", verdict: "pass", detail: "d", cite: "c" },
        { id: "a3", level: "SHOULD", verdict: "warn", detail: "d", cite: "c" },
        { id: "a4", level: "SHOULD", verdict: "fail", detail: "d", cite: "c" },
      ],
      findings: [
        { ruleId: "xhdr.empty", class: "violation", subject: "s", message: "m" },
        { ruleId: "degrade.silent", class: "risky", subject: "s", message: "m" },
        { ruleId: "compat.era", class: "info", subject: "s", message: "m" },
      ],
    });
    // a1 (MUST fail) + xhdr.empty (violation-class) = 2. a4 is SHOULD, never counted
    // regardless of verdict; risky/info findings never counted.
    expect(count).toBe(2);
  });

  it("empty input counts zero", () => {
    expect(mustViolationCountOf({})).toBe(0);
  });
});

describe("buildBoardRow (SPEC §8: enforced in code, not just prose)", () => {
  const base = {
    server: "example",
    url: "https://mcp.example.com/mcp",
    checkedAt: "2026-08-09T00:00:00.000Z",
    command: "snapgauge compat example --config boards/roster.json",
    resultUrl: "https://github.com/jamessuuu/snapgauge/blob/main/boards/2026-08-09.json#example",
  };

  it("a clean row (no MUST violations) is publishable and carries its findings", () => {
    const row = buildBoardRow({
      ...base,
      status: "ok",
      era: "modern-only",
      supportedVersions: ["2026-07-28"],
      assertions: [{ id: "transport.get_not_405", level: "SHOULD", verdict: "pass", detail: "d", cite: "c" }],
      findings: [{ ruleId: "compat.era", class: "info", subject: "discover", message: "m" }],
    });
    expect(row.publishable).toBe(true);
    expect(row.mustViolationCount).toBe(0);
    expect(row.era).toBe("modern-only");
    expect(row.assertions).toHaveLength(1);
    expect(row.findings).toHaveLength(1);
  });

  it("a row with an undisclosed MUST violation withholds era/supportedVersions/assertions/findings", () => {
    const row = buildBoardRow({
      ...base,
      status: "ok",
      era: "legacy",
      supportedVersions: ["2025-11-25"],
      assertions: [
        { id: "transport.discover_not_implemented", level: "MUST", verdict: "fail", detail: "d", cite: "c" },
      ],
      findings: [],
    });
    expect(row.mustViolationCount).toBe(1);
    expect(row.publishable).toBe(false);
    expect(row.era).toBeUndefined();
    expect(row.supportedVersions).toBeUndefined();
    expect(row.assertions).toBeUndefined();
    expect(row.findings).toBeUndefined();
  });

  it("a disclosed MUST violation (>=7 days after reportedAt) is publishable with findings intact", () => {
    const row = buildBoardRow({
      ...base,
      status: "ok",
      era: "legacy",
      assertions: [
        { id: "transport.discover_not_implemented", level: "MUST", verdict: "fail", detail: "d", cite: "c" },
      ],
      reportedAt: REPORTED,
      publishedAt: plus(SEVEN_DAYS_MS),
    });
    expect(row.mustViolationCount).toBe(1);
    expect(row.publishable).toBe(true);
    expect(row.era).toBe("legacy");
    expect(row.assertions).toHaveLength(1);
  });

  it("unreachable/auth_required rows carry zero MUST violations and are always publishable", () => {
    const unreachable = buildBoardRow({
      ...base,
      status: "unreachable",
      statusDetail: "PROBE_FAILURE: connection refused",
    });
    expect(unreachable.publishable).toBe(true);
    expect(unreachable.mustViolationCount).toBe(0);
    expect(unreachable.statusDetail).toBe("PROBE_FAILURE: connection refused");

    const authRequired = buildBoardRow({
      ...base,
      status: "auth_required",
      statusDetail: "AUTH: HTTP 401 — authentication failed",
    });
    expect(authRequired.status).toBe("auth_required");
    expect(authRequired.publishable).toBe(true);
  });
});
