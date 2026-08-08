import { MODERN_FULL, type JsonRpcRequest } from "snapgauge";
import { describe, expect, it } from "vitest";
import { fixtureNames, getFixture } from "./index.ts";

function request(method: string, id = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method };
}

function mustGet(name: string) {
  const fixture = getFixture(name);
  if (fixture === undefined) throw new Error(`fixture missing: ${name}`);
  return fixture;
}

describe("fixture registry (SPEC §7)", () => {
  it("resolves the M3 + M4 roster and nothing else", () => {
    expect(fixtureNames()).toEqual([
      "bad-x-mcp-header",
      "clean@v1",
      "clean@v1-shuffled",
      "clean@v2-identical",
      "degrader-honest",
      "degrader-liar",
      "degrader-silent",
      "drift-annotations-breaking@v2",
      "drift-annotations-relaxed@v2",
      "drift-breaking@v2",
      "drift-cache@v2",
      "drift-caps@v2",
      "drift-cosmetic@v2",
      "drift-error-code@v2",
      "drift-instructions@v2",
      "drift-meta@v2",
      "drift-order@v2",
      "drift-schema@v2",
      "drift-steering@v2",
      "drift-xhdr@v2",
      "flaky-order",
      "nonconformant-legacy",
      "paginated",
      "xhdr-live-bad",
    ]);
    expect(getFixture("nope@v1")).toBeUndefined();
    // Prototype keys must not resolve to Object.prototype members.
    expect(getFixture("constructor")).toBeUndefined();
    expect(getFixture("toString")).toBeUndefined();
  });
});

describe("fixture servers", () => {
  it("are pure: the same request always yields a deep-equal response", () => {
    for (const name of fixtureNames()) {
      const fixture = mustGet(name);
      for (const method of ["server/discover", "tools/list", "unknown/method"]) {
        const one = fixture(request(method), MODERN_FULL);
        const two = fixture(request(method), MODERN_FULL);
        expect(two, `${name} ${method}`).toEqual(one);
      }
    }
  });

  it("clean@v1 and clean@v2-identical expose a byte-identical surface (the negative pair)", () => {
    const v1 = mustGet("clean@v1");
    const v2 = mustGet("clean@v2-identical");
    for (const method of ["server/discover", "tools/list"]) {
      expect(JSON.stringify(v2(request(method), MODERN_FULL))).toBe(
        JSON.stringify(v1(request(method), MODERN_FULL)),
      );
    }
  });

  it("drift-breaking@v2 carries the planted drift (deep assertions live in the golden evals)", () => {
    const body = JSON.stringify(mustGet("drift-breaking@v2")(request("tools/list"), MODERN_FULL));
    expect(body).not.toContain('"archive_note"');
    expect(body).toContain('"date"');
    expect(body).toContain('"cursor"');
  });

  it("unknown methods return JSON-RPC -32601, not a crash", () => {
    const response = mustGet("clean@v1")(request("snapgauge/no_such"), MODERN_FULL);
    expect(JSON.stringify(response.body)).toContain("-32601");
  });

  it("tools/call without _meta is -32602 (2026-07-28: _meta is required)", () => {
    const server = mustGet("clean@v1");
    const missing = server(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_weather", arguments: { location: "X" } } },
      MODERN_FULL,
    );
    expect(JSON.stringify(missing.body)).toContain("-32602");
    const present = server(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_weather", arguments: { location: "X" }, _meta: { clientCapabilities: {} } },
      },
      MODERN_FULL,
    );
    expect(JSON.stringify(present.body)).toContain('"resultType":"complete"');
  });
});
