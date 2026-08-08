/**
 * Board row rendering (SPEC §8): "Findings are stated as neutral
 * observations... never as scores, grades, or security claims." Enforced
 * with a test over the row-rendering templates — both the fixed label
 * vocabulary this module authors, and the RENDERED OUTPUT across a set of
 * representative rows/findings pulled from the real M4 rule catalog
 * (including one, `xhdr.unsafe_integer`, whose message legitimately
 * contains the word "unsafe" as a technical term — safe-integer range, not
 * a security claim about the server — proving the banned-word check is
 * scoped correctly rather than merely absent of that string by accident).
 */
import { describe, expect, it } from "vitest";
import type { BoardRow } from "snapgauge";
import {
  assertionObservation,
  disclosureLabel,
  findingObservation,
  parseBoardRow,
  statusLabel,
  supportedVersionsLabel,
} from "./board-render.js";

// Deliberately does NOT ban "safe"/"unsafe" (xhdr.unsafe_integer is
// legitimate spec vocabulary — see the module doc above) or "risk"/"risky"
// (an approved SPEC §5 tier name), or "violation" (a spec-conformance term
// used throughout the M4 engine) — none of those are scores, grades, or
// security claims about the server.
const BANNED = /\b(score|scored|scoring|grade[ds]?|grading|rating|rated|vulnerab\w*|insecure|trust[\s-]?score|security\s+risk)\b/i;

function assertNeutral(text: string): void {
  expect(text).not.toMatch(BANNED);
}

const OK_ROW: BoardRow = {
  server: "acme",
  url: "https://mcp.acme.example/mcp",
  checkedAt: "2026-08-09T06:17:00.000Z",
  command: "snapgauge compat acme --config boards/roster.json",
  resultUrl: "https://github.com/jamessuuu/snapgauge/blob/main/boards/2026-08-09.json#acme",
  status: "ok",
  era: "modern-only",
  supportedVersions: ["2026-07-28"],
  mustViolationCount: 0,
  publishable: true,
  assertions: [
    { id: "transport.get_not_405", level: "SHOULD", verdict: "pass", detail: "GET returned 405", cite: "streamable-http: a server SHOULD respond 405 to GET on the MCP endpoint" },
  ],
  findings: [{ ruleId: "compat.era", class: "info", subject: "discover", message: "era: modern-only (server/discover answered, initialize failed)" }],
};

const REDACTED_ROW: BoardRow = {
  server: "legacy-corp",
  url: "https://mcp.legacy-corp.example/mcp",
  checkedAt: "2026-08-09T06:17:00.000Z",
  command: "snapgauge compat legacy-corp --config boards/roster.json",
  resultUrl: "https://github.com/jamessuuu/snapgauge/blob/main/boards/2026-08-09.json#legacy-corp",
  status: "ok",
  mustViolationCount: 2,
  publishable: false,
};

const UNSAFE_INTEGER_FINDING = {
  ruleId: "xhdr.unsafe_integer",
  subject: "tools.t.inputSchema.properties.h",
  message:
    'x-mcp-header "X-Count" involves an unsafe integer — this tool is invisible to conforming clients',
};

describe("board-render (SPEC §8: neutral observations only)", () => {
  it("parseBoardRow accepts a real BoardRowSchema-shaped row and rejects a legacy/malformed one", () => {
    expect(parseBoardRow(OK_ROW)).toEqual(OK_ROW);
    expect(parseBoardRow({ server: "e2e-fixture.example", era: "modern-only", checkedAt: "x" })).toBeUndefined();
  });

  it("statusLabel and disclosureLabel are neutral for a clean, publishable row", () => {
    assertNeutral(statusLabel(OK_ROW));
    assertNeutral(disclosureLabel(OK_ROW));
    expect(statusLabel(OK_ROW)).toBe("checked — era: modern-only");
    expect(disclosureLabel(OK_ROW)).toBe("no MUST-level findings");
  });

  it("statusLabel never guesses for unreachable/auth_required rows", () => {
    const unreachable: BoardRow = { ...OK_ROW, status: "unreachable", era: undefined };
    const authRequired: BoardRow = { ...OK_ROW, status: "auth_required", era: undefined };
    expect(statusLabel(unreachable)).toBe("not tested (unreachable)");
    expect(statusLabel(authRequired)).toBe("not tested (auth required)");
    assertNeutral(statusLabel(unreachable));
    assertNeutral(statusLabel(authRequired));
  });

  it("disclosureLabel for a redacted (not yet publishable) row states a count, not a verdict on the server", () => {
    const label = disclosureLabel(REDACTED_ROW);
    assertNeutral(label);
    expect(label).toContain("2 MUST-level finding(s) pending disclosure");
  });

  it("disclosureLabel for a published, disclosed row states the dates", () => {
    const published: BoardRow = {
      ...REDACTED_ROW,
      publishable: true,
      reportedAt: "2026-08-01T00:00:00.000Z",
      publishedAt: "2026-08-08T00:00:00.000Z",
    };
    const label = disclosureLabel(published);
    assertNeutral(label);
    expect(label).toContain("reported 2026-08-01");
    expect(label).toContain("published 2026-08-08");
  });

  it("assertionObservation and findingObservation pass the engine's own factual detail through untouched", () => {
    for (const assertion of OK_ROW.assertions ?? []) {
      assertNeutral(assertionObservation(assertion));
    }
    for (const finding of OK_ROW.findings ?? []) {
      assertNeutral(findingObservation(finding));
    }
  });

  it("the xhdr.unsafe_integer finding (legitimate 'unsafe' vocabulary) still renders as neutral", () => {
    assertNeutral(findingObservation(UNSAFE_INTEGER_FINDING));
    expect(findingObservation(UNSAFE_INTEGER_FINDING)).toContain("unsafe integer");
  });

  it("supportedVersionsLabel renders a plain list or an em dash, never a count-as-score", () => {
    expect(supportedVersionsLabel(OK_ROW)).toBe("2026-07-28");
    expect(supportedVersionsLabel(REDACTED_ROW)).toBe("—");
  });
});
