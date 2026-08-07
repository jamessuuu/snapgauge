import { describe, expect, it } from "vitest";
import { CheckOutputSchema, render, summarize, type CheckOutput } from "./report.js";

const BASE: CheckOutput = {
  command: "check",
  target: { name: "acme", transport: "stdio" },
  findings: [
    {
      ruleId: "tool.removed",
      tier: "breaking",
      subject: "tools.archive_note",
      message: "tool removed",
    },
    {
      ruleId: "tool.description.changed",
      tier: "risky",
      subject: "tools.get_weather.description",
      message: "description changed | with pipe",
    },
  ],
  summary: { breaking: 1, risky: 1, compatible: 0, cosmetic: 0 },
  gate: { failOn: "risky", failed: true },
  assertions: [
    {
      id: "transport.get_not_405",
      level: "SHOULD",
      verdict: "n/a",
      detail: "n/a (stdio) — requires the Streamable HTTP framing; this transport has no HTTP layer",
      cite: "streamable-http: a server SHOULD respond 405 to GET on the MCP endpoint",
    },
    {
      id: "transport.session_id_echoed",
      level: "MUST",
      verdict: "fail",
      detail: "response carried an Mcp-Session-Id header",
      cite: "servers MUST ignore Mcp-Session-Id",
    },
  ],
  exitCode: 1,
};

describe("reporters (SPEC §4/§5)", () => {
  it("json output round-trips through CheckOutputSchema", () => {
    const [line] = render(BASE, "json");
    expect(CheckOutputSchema.parse(JSON.parse(line ?? ""))).toEqual(BASE);
  });

  it("text prints findings, the n/a (stdio) assertion WITH its reason, and the gate", () => {
    const text = render(BASE, "text").join("\n");
    expect(text).toContain("tool.removed");
    expect(text).toContain("n/a (stdio) — requires the Streamable HTTP framing");
    expect(text).toContain("gate fail-on=risky -> DRIFT (exit 1)");
  });

  it("github emits error/warning annotations with escaped messages", () => {
    const lines = render(BASE, "github");
    expect(lines.some((l) => l.startsWith("::error title=breaking%3A tool.removed::"))).toBe(true);
    expect(lines.some((l) => l.startsWith("::warning title=risky%3A tool.description.changed::"))).toBe(
      true,
    );
    // A failed MUST assertion is an error annotation too.
    expect(lines.some((l) => l.includes("::error title=transport.session_id_echoed::"))).toBe(true);
  });

  it("md renders tables and escapes pipes", () => {
    const md = render(BASE, "md").join("\n");
    expect(md).toContain("| tier | rule | subject | message |");
    expect(md).toContain("description changed \\| with pipe");
    expect(md).toContain("**DRIFT (exit 1)**");
  });

  it("incomplete evidence is loud in every format (SPEC §6)", () => {
    const incomplete: CheckOutput = { ...BASE, incomplete: true, exitCode: 2 };
    expect(render(incomplete, "text").join("\n")).toContain("INCOMPLETE");
    expect(render(incomplete, "md").join("\n")).toContain("incomplete evidence");
  });

  it("summarize counts by tier", () => {
    expect(summarize(BASE.findings)).toEqual({ breaking: 1, risky: 1, compatible: 0, cosmetic: 0 });
  });
});
