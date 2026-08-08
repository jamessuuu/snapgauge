import { describe, expect, it } from "vitest";
import {
  isReservedCodeMisuse,
  runTransportAssertions,
  TRANSPORT_ASSERTIONS,
  type AssertionContext,
} from "./assertions.js";
import type { RawHttpRequest, RawHttpResponse } from "./transport.js";

function ctx(overrides?: Partial<AssertionContext>): AssertionContext {
  return { kind: "http", protocolVersion: "2026-07-28", ...overrides };
}

describe("transport assertion registry (SPEC §5 T-group)", () => {
  it("carries the full SPEC §5 catalog", () => {
    const ids = TRANSPORT_ASSERTIONS.map((a) => a.id).sort();
    expect(ids).toEqual(
      [
        "transport.get_not_405",
        "transport.delete_not_405",
        "transport.session_id_echoed",
        "transport.last_event_id_honored",
        "transport.missing_protocol_version_accepted",
        "transport.header_body_mismatch_accepted",
        "transport.mcp_name_missing_accepted",
        "transport.mcp_name_mismatch_accepted",
        "transport.mcp_name_base64_not_decoded",
        "transport.unknown_method_not_404_32601",
        "transport.unsupported_version_not_32022",
        "transport.origin_invalid_not_403",
        "transport.meta_missing_not_32602",
        "transport.notification_not_202",
        "transport.sse_no_accel_buffering",
        "transport.sse_no_keepalive",
        "transport.discover_not_implemented",
        "transport.result_type_absent",
        "transport.cache_hints_missing",
        "transport.cachescope_inconsistent_across_pages",
        "transport.reserved_error_code_misuse",
      ].sort(),
    );
  });

  it("every assertion declares appliesTo, a cite and an n/a reason", () => {
    for (const assertion of TRANSPORT_ASSERTIONS) {
      expect(assertion.appliesTo.length, assertion.id).toBeGreaterThan(0);
      expect(assertion.cite.length, assertion.id).toBeGreaterThan(0);
      expect(assertion.naReason.length, assertion.id).toBeGreaterThan(0);
    }
  });

  it("stdio: EVERY assertion is n/a WITH the reason — never silently passed (SPEC §4)", async () => {
    const reports = await runTransportAssertions(ctx({ kind: "stdio" }));
    expect(reports.length).toBe(TRANSPORT_ASSERTIONS.length);
    for (const report of reports) {
      expect(report.verdict).toBe("n/a");
      expect(report.detail).toContain("n/a (stdio)");
      expect(report.detail.length).toBeGreaterThan("n/a (stdio) — ".length);
    }
  });

  it("raw-less transport without observations: applicable assertions are skipped, not passed", async () => {
    const reports = await runTransportAssertions(ctx({ raw: undefined }));
    for (const report of reports) {
      expect(report.verdict, report.id).toBe("skipped");
    }
  });

  it("a misbehaving endpoint fails MUSTs and warns SHOULDs", async () => {
    const misbehaving = (request: RawHttpRequest): Promise<RawHttpResponse> => {
      if (request.method !== "POST") {
        // 200 + SSE on GET/DELETE — SHOULD violation + resumption behavior.
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          bodyText: "data: {}\n\n",
        });
      }
      const body = JSON.parse(request.bodyText ?? "{}") as Record<string, unknown>;
      if (!("id" in body)) return Promise.resolve({ status: 200, headers: {}, bodyText: "" }); // MUST 202
      // Accepts everything, mints a session id.
      return Promise.resolve({
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "sess-1" },
        bodyText: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }),
      });
    };
    const byId = new Map(
      (await runTransportAssertions(ctx({ raw: misbehaving, serverName: "srv" }))).map((r) => [
        r.id,
        r,
      ]),
    );
    expect(byId.get("transport.get_not_405")?.verdict).toBe("warn");
    expect(byId.get("transport.last_event_id_honored")?.verdict).toBe("fail");
    expect(byId.get("transport.session_id_echoed")?.verdict).toBe("fail");
    expect(byId.get("transport.notification_not_202")?.verdict).toBe("fail");
    expect(byId.get("transport.unknown_method_not_404_32601")?.verdict).toBe("fail");
    expect(byId.get("transport.header_body_mismatch_accepted")?.verdict).toBe("fail");
    expect(byId.get("transport.mcp_name_mismatch_accepted")?.verdict).toBe("fail");
    expect(byId.get("transport.unsupported_version_not_32022")?.verdict).toBe("fail");
    expect(byId.get("transport.origin_invalid_not_403")?.verdict).toBe("fail");
    // Accepting-everything passes the acceptance-side MUSTs:
    expect(byId.get("transport.missing_protocol_version_accepted")?.verdict).toBe("pass");
    expect(byId.get("transport.mcp_name_missing_accepted")?.verdict).toBe("pass");
    expect(byId.get("transport.mcp_name_base64_not_decoded")?.verdict).toBe("pass");
  });

  it("observation assertions read the engine's observations", async () => {
    const reports = await runTransportAssertions(
      ctx({
        observations: {
          discover: { errorCode: -32601 },
          resultTypeAbsent: ["echo"],
          cacheHintsMissing: ["tools/list"],
          cacheScopeByPage: ["public", "private"],
          observedErrorCodes: [-32601, -32050],
        },
      }),
    );
    const byId = new Map(reports.map((r) => [r.id, r]));
    expect(byId.get("transport.discover_not_implemented")?.verdict).toBe("fail");
    expect(byId.get("transport.result_type_absent")?.verdict).toBe("fail");
    expect(byId.get("transport.cache_hints_missing")?.verdict).toBe("fail");
    expect(byId.get("transport.cachescope_inconsistent_across_pages")?.verdict).toBe("fail");
    expect(byId.get("transport.reserved_error_code_misuse")?.verdict).toBe("fail");
  });

  it("clean observations pass; a single page is never an inconsistency", async () => {
    const reports = await runTransportAssertions(
      ctx({
        observations: {
          discover: "ok",
          resultTypeAbsent: [],
          cacheHintsMissing: [],
          cacheScopeByPage: ["public"],
          observedErrorCodes: [-32601, -32602, -32021],
        },
      }),
    );
    const byId = new Map(reports.map((r) => [r.id, r]));
    for (const id of [
      "transport.discover_not_implemented",
      "transport.result_type_absent",
      "transport.cache_hints_missing",
      "transport.cachescope_inconsistent_across_pages",
      "transport.reserved_error_code_misuse",
    ]) {
      expect(byId.get(id)?.verdict, id).toBe("pass");
    }
  });
});

describe("reserved error band (SPEC §5)", () => {
  it("allows the three assigned codes, rejects squatters and the two banned codes", () => {
    expect(isReservedCodeMisuse(-32020)).toBe(false);
    expect(isReservedCodeMisuse(-32021)).toBe(false);
    expect(isReservedCodeMisuse(-32022)).toBe(false);
    expect(isReservedCodeMisuse(-32050)).toBe(true);
    expect(isReservedCodeMisuse(-32099)).toBe(true);
    expect(isReservedCodeMisuse(-32002)).toBe(true);
    expect(isReservedCodeMisuse(-32042)).toBe(true);
    expect(isReservedCodeMisuse(-32000)).toBe(false);
    expect(isReservedCodeMisuse(-32601)).toBe(false);
  });
});
