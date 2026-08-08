/**
 * `xhdrStaticFindings` was extracted verbatim out of `runCompat`'s X-group
 * loop at M5 so apps/web's read-only live check (SPEC §4 — never calls
 * `tools/call`) can run the identical static analysis on a third-party
 * server's `tools/list` output. The M4 eval suite (evals/cases/compat/*)
 * already proves the finding set through `runCompat`; this is the direct
 * unit test for the now-public function itself.
 */
import { describe, expect, it } from "vitest";
import { xhdrStaticFindings } from "./engine.js";

describe("xhdrStaticFindings", () => {
  it("a clean tool with no x-mcp-header bindings produces no findings", () => {
    const findings = xhdrStaticFindings([
      { name: "get_weather", inputSchema: { type: "object", properties: {} } },
    ]);
    expect(findings).toEqual([]);
  });

  it("a valid binding produces no findings", () => {
    const findings = xhdrStaticFindings([
      {
        name: "archive_note",
        inputSchema: {
          type: "object",
          properties: { workspace: { type: "string", "x-mcp-header": "X-Workspace" } },
        },
      },
    ]);
    expect(findings).toEqual([]);
  });

  it("an empty header name is a violation naming the tool + path", () => {
    const findings = xhdrStaticFindings([
      {
        name: "t_empty",
        inputSchema: { type: "object", properties: { h: { type: "string", "x-mcp-header": "" } } },
      },
    ]);
    expect(findings).toEqual([
      {
        ruleId: "xhdr.empty",
        class: "violation",
        subject: "tools.t_empty.inputSchema.properties.h",
        message: 'x-mcp-header "" is empty — this tool is invisible to conforming clients',
      },
    ]);
  });

  it("a duplicate header (case-insensitive) across two properties dedupes to one finding", () => {
    const findings = xhdrStaticFindings([
      {
        name: "t_dup",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "string", "x-mcp-header": "X-Api-Key" },
            b: { type: "string", "x-mcp-header": "x-api-key" },
          },
        },
      },
    ]);
    expect(findings).toEqual([
      {
        ruleId: "xhdr.not_unique",
        class: "violation",
        subject: "tools.t_dup.inputSchema.x-mcp-header.x-api-key",
        message: 'header "X-Api-Key" is bound more than once (case-insensitive) — this tool is invisible to conforming clients',
      },
    ]);
  });

  it("findings across multiple tools are concatenated in tool order", () => {
    const findings = xhdrStaticFindings([
      { name: "clean_tool", inputSchema: { type: "object", properties: {} } },
      {
        name: "bad_tool",
        inputSchema: { type: "object", properties: { h: { type: "number", "x-mcp-header": "X-Num" } } },
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.subject).toBe("tools.bad_tool.inputSchema.properties.h");
  });
});
