/**
 * Static X-group analysis (SPEC §5): one focused unit test per constraint,
 * plus the statically-reachable-chain and case-insensitive-uniqueness rules.
 * The compat eval set (evals/cases/compat/bad-x-mcp-header.json) proves the
 * same constraints end-to-end through the engine; this file pins the pure
 * function in isolation.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "../json.js";
import { analyzeXmcpHeaders, topLevelPropertyOf } from "./xhdr.js";

function schemaWith(binding: JsonObject): JsonObject {
  return { type: "object", properties: { h: binding }, additionalProperties: false };
}

describe("analyzeXmcpHeaders (SPEC §5 X-group, static)", () => {
  it("a valid binding has no violations", () => {
    const [report] = analyzeXmcpHeaders(schemaWith({ type: "string", "x-mcp-header": "X-Workspace" }));
    expect(report).toBeDefined();
    expect(report?.valid).toBe(true);
    expect(report?.violations).toEqual([]);
    expect(report?.path).toBe("properties.h");
    expect(topLevelPropertyOf(report ?? { path: "", header: "", valid: true, violations: [] })).toBe(
      "h",
    );
  });

  it("schemas with no x-mcp-header produce no reports", () => {
    expect(analyzeXmcpHeaders({ type: "object", properties: { h: { type: "string" } } })).toEqual([]);
  });

  it("flags an empty header", () => {
    const [report] = analyzeXmcpHeaders(schemaWith({ type: "string", "x-mcp-header": "" }));
    expect(report?.violations).toEqual(["empty"]);
  });

  it("flags a control character", () => {
    const [report] = analyzeXmcpHeaders(
      schemaWith({ type: "string", "x-mcp-header": "X-Bad" }),
    );
    expect(report?.violations).toEqual(["control_char"]);
  });

  it("flags a non-token (space in the header name)", () => {
    const [report] = analyzeXmcpHeaders(
      schemaWith({ type: "string", "x-mcp-header": "X Bad Header" }),
    );
    expect(report?.violations).toEqual(["not_token"]);
  });

  it("flags a duplicate binding case-insensitively, on BOTH declarations", () => {
    const reports = analyzeXmcpHeaders({
      type: "object",
      properties: {
        a: { type: "string", "x-mcp-header": "X-Api-Key" },
        b: { type: "string", "x-mcp-header": "x-api-key" },
      },
    });
    expect(reports).toHaveLength(2);
    for (const report of reports) {
      expect(report.violations).toEqual(["not_unique"]);
    }
  });

  it("flags number as non-primitive (only string/boolean/integer are permitted)", () => {
    const [report] = analyzeXmcpHeaders(schemaWith({ type: "number", "x-mcp-header": "X-Num" }));
    expect(report?.violations).toEqual(["non_primitive"]);
  });

  it("boolean and integer are valid primitive types", () => {
    const boolReport = analyzeXmcpHeaders(schemaWith({ type: "boolean", "x-mcp-header": "X-Flag" }));
    expect(boolReport[0]?.valid).toBe(true);
    const intReport = analyzeXmcpHeaders(schemaWith({ type: "integer", "x-mcp-header": "X-Count" }));
    expect(intReport[0]?.valid).toBe(true);
  });

  it("flags an unsafe integer bound via maximum", () => {
    const [report] = analyzeXmcpHeaders(
      schemaWith({ type: "integer", "x-mcp-header": "X-Big", maximum: 1e16 }),
    );
    expect(report?.violations).toEqual(["unsafe_integer"]);
  });

  it("an integer with a safe maximum is valid", () => {
    const [report] = analyzeXmcpHeaders(
      schemaWith({ type: "integer", "x-mcp-header": "X-Ok", maximum: 100 }),
    );
    expect(report?.valid).toBe(true);
  });

  it("flags a binding hidden behind oneOf as not statically reachable", () => {
    const [report] = analyzeXmcpHeaders({
      type: "object",
      properties: {
        opts: {
          type: "object",
          oneOf: [{ properties: { key: { type: "string", "x-mcp-header": "X-Key" } } }],
        },
      },
    });
    expect(report?.violations).toEqual(["not_statically_reachable"]);
    expect(topLevelPropertyOf(report ?? { path: "", header: "", valid: true, violations: [] })).toBe(
      undefined,
    );
  });

  it("a binding nested under a plain properties chain stays reachable", () => {
    const [report] = analyzeXmcpHeaders({
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: { inner: { type: "string", "x-mcp-header": "X-Inner" } },
        },
      },
    });
    expect(report?.violations).toEqual([]);
    expect(report?.path).toBe("properties.outer.properties.inner");
  });

  it("multiple independent violations on one declaration all get reported", () => {
    const [report] = analyzeXmcpHeaders(schemaWith({ type: "number", "x-mcp-header": "" }));
    expect(report?.violations).toEqual(expect.arrayContaining(["empty", "non_primitive"]));
    expect(report?.valid).toBe(false);
  });
});
