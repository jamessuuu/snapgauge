import { describe, expect, it } from "vitest";
import {
  runTransportAssertions,
  TRANSPORT_ASSERTIONS,
  type AssertionContext,
} from "./assertions.js";
import type { RawHttpRequest, RawHttpResponse } from "./transport.js";

function ctx(overrides?: Partial<AssertionContext>): AssertionContext {
  return { kind: "http", protocolVersion: "2026-07-28", ...overrides };
}

/** A conformant raw endpoint for the M2 assertion subset. */
function conformantRaw(request: RawHttpRequest): Promise<RawHttpResponse> {
  if (request.method !== "POST") {
    return Promise.resolve({ status: 405, headers: { allow: "POST" }, bodyText: "" });
  }
  const body = JSON.parse(request.bodyText ?? "{}") as Record<string, unknown>;
  if (!("id" in body)) return Promise.resolve({ status: 202, headers: {}, bodyText: "" });
  if (body.method === "tools/list") {
    return Promise.resolve({
      status: 200,
      headers: { "content-type": "application/json" },
      bodyText: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }),
    });
  }
  return Promise.resolve({
    status: 200,
    headers: { "content-type": "application/json" },
    bodyText: JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: "method not found" },
    }),
  });
}

describe("transport assertions (SPEC §5 T-group, §4 n/a rule)", () => {
  it("every assertion declares appliesTo and a cite", () => {
    for (const assertion of TRANSPORT_ASSERTIONS) {
      expect(assertion.appliesTo.length).toBeGreaterThan(0);
      expect(assertion.cite.length).toBeGreaterThan(0);
      expect(assertion.naReason.length).toBeGreaterThan(0);
    }
  });

  it("passes a conformant endpoint", async () => {
    const reports = await runTransportAssertions(ctx({ raw: conformantRaw }));
    for (const report of reports) {
      expect(report.verdict, report.id).toBe("pass");
    }
  });

  it("stdio: every HTTP-only assertion is n/a WITH the reason — never silently passed", async () => {
    const reports = await runTransportAssertions(ctx({ kind: "stdio" }));
    expect(reports.length).toBe(TRANSPORT_ASSERTIONS.length);
    for (const report of reports) {
      expect(report.verdict).toBe("n/a");
      expect(report.detail).toContain("n/a (stdio)");
      expect(report.detail.length).toBeGreaterThan("n/a (stdio) — ".length);
    }
  });

  it("raw-less transport: applicable assertions are skipped with a reason, not passed", async () => {
    const reports = await runTransportAssertions(ctx({ raw: undefined }));
    for (const report of reports) {
      expect(report.verdict).toBe("skipped");
      expect(report.detail).toContain("raw HTTP access");
    }
  });

  it("a misbehaving endpoint fails MUSTs and warns SHOULDs", async () => {
    const misbehaving = (request: RawHttpRequest): Promise<RawHttpResponse> => {
      if (request.method !== "POST") {
        // 200 on GET/DELETE — SHOULD violation.
        return Promise.resolve({ status: 200, headers: {}, bodyText: "hello" });
      }
      const body = JSON.parse(request.bodyText ?? "{}") as Record<string, unknown>;
      if (!("id" in body)) return Promise.resolve({ status: 200, headers: {}, bodyText: "" }); // MUST 202
      // Mints a session id — MUST violation.
      return Promise.resolve({
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "sess-1" },
        bodyText: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }),
      });
    };
    const byId = new Map(
      (await runTransportAssertions(ctx({ raw: misbehaving }))).map((r) => [r.id, r]),
    );
    expect(byId.get("transport.get_not_405")?.verdict).toBe("warn");
    expect(byId.get("transport.delete_not_405")?.verdict).toBe("warn");
    expect(byId.get("transport.session_id_echoed")?.verdict).toBe("fail");
    expect(byId.get("transport.notification_not_202")?.verdict).toBe("fail");
    expect(byId.get("transport.unknown_method_not_404_32601")?.verdict).toBe("fail");
  });
});
