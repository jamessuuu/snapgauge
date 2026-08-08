/**
 * T-group transport assertions (SPEC §5): the 2026-07-28 Streamable HTTP
 * framing checks, complete catalog. Every assertion declares `appliesTo`;
 * on a transport it does not apply to it is reported `n/a` WITH the reason
 * — never silently passed (SPEC §4). Failing a MUST yields `fail`; failing
 * a SHOULD yields `warn`.
 *
 * Two run modes:
 * - raw-probing assertions issue their own HTTP exchanges through
 *   `ctx.raw` (absent raw access -> `skipped`, with the reason);
 * - observation assertions read what the compat engine already observed
 *   during probing (`ctx.observations`) — absent observation -> `skipped`.
 */
import { z } from "zod";
import { JsonRpcResponseSchema } from "./jsonrpc.js";
import type { Json } from "./json.js";
import type { RawHttpRequest, RawHttpResponse, TransportKind } from "./transport.js";

export const ASSERTION_VERDICTS = ["pass", "fail", "warn", "n/a", "skipped"] as const;
export type AssertionVerdict = (typeof ASSERTION_VERDICTS)[number];

export const AssertionReportSchema = z.strictObject({
  id: z.string(),
  level: z.enum(["MUST", "SHOULD"]),
  verdict: z.enum(ASSERTION_VERDICTS),
  /** What was observed (pass/fail/warn) or why the assertion did not run (n/a, skipped). */
  detail: z.string(),
  cite: z.string(),
});
export type AssertionReport = z.infer<typeof AssertionReportSchema>;

/** What the compat engine observed while probing (SPEC §5 T-group). */
export interface AssertionObservations {
  /** server/discover outcome. */
  discover?: "ok" | { errorCode?: number | undefined };
  /** Probe ids whose SUCCESSFUL tools/call result carried no resultType. */
  resultTypeAbsent?: readonly string[];
  /** Cacheable surfaces missing ttlMs/cacheScope (e.g. "server/discover"). */
  cacheHintsMissing?: readonly string[];
  /** Observed cacheScope per tools/list page (null = absent on that page). */
  cacheScopeByPage?: readonly (string | null)[];
  /** Every JSON-RPC error code observed during the run. */
  observedErrorCodes?: readonly number[];
}

export interface AssertionContext {
  kind: TransportKind;
  /** Raw HTTP access — absent on stdio and on raw-less fixtures. */
  raw?: ((request: RawHttpRequest) => Promise<RawHttpResponse>) | undefined;
  /** serverInfo.name, when known (MCP-Name checks need it). */
  serverName?: string | undefined;
  /** The protocol version snapgauge normally sends. */
  protocolVersion: string;
  /** A real tool name from tools/list (meta_missing check targets it). */
  sampleTool?: string | undefined;
  observations?: AssertionObservations | undefined;
}

type RunOutcome = { ok: boolean; observed: string } | { skipped: string };

export interface TransportAssertion {
  id: string;
  level: "MUST" | "SHOULD";
  /** The spec citation the assertion enforces (SPEC §5 T-group). */
  cite: string;
  appliesTo: readonly TransportKind[];
  /** Printed when the assertion is n/a on the target's transport. */
  naReason: string;
  run(ctx: AssertionContext): Promise<RunOutcome> | RunOutcome;
}

const HTTP_FRAMING = ["http", "fixture"] as const;
const NA_FRAMING = "requires the Streamable HTTP framing; this transport has no HTTP layer";

/** Reserved error band (SPEC §5): -32020..-32099 with three assigned codes. */
const RESERVED_ALLOWED = new Set([-32020, -32021, -32022]);
export function isReservedCodeMisuse(code: number): boolean {
  if (code === -32002 || code === -32042) return true; // MUST NOT be emitted
  return code <= -32020 && code >= -32099 && !RESERVED_ALLOWED.has(code);
}

function rpcBody(method: string, id?: number, params?: Json): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    ...(id !== undefined ? { id } : {}),
    method,
    ...(params !== undefined ? { params } : {}),
  });
}

function baseHeaders(ctx: AssertionContext): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    "mcp-protocol-version": ctx.protocolVersion,
  };
}

/** Empty string = SUPPRESS the header (transports drop empty values). */
function headersWithoutVersion(ctx: AssertionContext): Record<string, string> {
  return { ...baseHeaders(ctx), "mcp-protocol-version": "" };
}

function parseEnvelope(bodyText: string): { errorCode?: number; errorData?: Json; ok?: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return {};
  }
  const envelope = JsonRpcResponseSchema.safeParse(parsed);
  if (!envelope.success) return {};
  if ("error" in envelope.data) {
    const { code, data } = envelope.data.error;
    return { errorCode: code, ...(data !== undefined ? { errorData: data } : {}) };
  }
  return { ok: true };
}

async function raw(
  ctx: AssertionContext,
  request: RawHttpRequest,
): Promise<RawHttpResponse | { skipped: string }> {
  if (ctx.raw === undefined) {
    return { skipped: "transport does not expose raw HTTP access" };
  }
  try {
    return await ctx.raw(request);
  } catch (error) {
    return {
      skipped: `raw request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function isSkip(value: RawHttpResponse | { skipped: string }): value is { skipped: string } {
  return "skipped" in value;
}

function isSse(response: RawHttpResponse): boolean {
  return (response.headers["content-type"] ?? "").startsWith("text/event-stream");
}

async function openListenStream(
  ctx: AssertionContext,
): Promise<RawHttpResponse | { skipped: string }> {
  const response = await raw(ctx, {
    method: "POST",
    headers: { ...baseHeaders(ctx), accept: "text/event-stream" },
    bodyText: rpcBody("subscriptions/listen", 9010, {}),
  });
  if (isSkip(response)) return response;
  if (response.status !== 200 || !isSse(response)) {
    return { skipped: "server does not expose a subscriptions/listen stream" };
  }
  return response;
}

/** The complete T-group registry (SPEC §5). */
export const TRANSPORT_ASSERTIONS: readonly TransportAssertion[] = [
  {
    id: "transport.get_not_405",
    level: "SHOULD",
    cite: "streamable-http: a server SHOULD respond 405 to GET on the MCP endpoint",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, { method: "GET", headers: baseHeaders(ctx) });
      if (isSkip(response)) return response;
      return { ok: response.status === 405, observed: `GET returned ${String(response.status)}` };
    },
  },
  {
    id: "transport.delete_not_405",
    level: "SHOULD",
    cite: "streamable-http: a server SHOULD respond 405 to DELETE on the MCP endpoint",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, { method: "DELETE", headers: baseHeaders(ctx) });
      if (isSkip(response)) return response;
      return { ok: response.status === 405, observed: `DELETE returned ${String(response.status)}` };
    },
  },
  {
    id: "transport.session_id_echoed",
    level: "MUST",
    cite: "streamable-http 2026-07-28: servers MUST ignore Mcp-Session-Id — never mint or echo one",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, {
        method: "POST",
        headers: { ...baseHeaders(ctx), "mcp-session-id": "snapgauge-canary" },
        bodyText: rpcBody("tools/list", 9001),
      });
      if (isSkip(response)) return response;
      const echoed = Object.keys(response.headers).some(
        (name) => name.toLowerCase() === "mcp-session-id",
      );
      return {
        ok: !echoed,
        observed: echoed
          ? "response carried an Mcp-Session-Id header"
          : "Mcp-Session-Id ignored (not echoed, none minted)",
      };
    },
  },
  {
    id: "transport.last_event_id_honored",
    level: "MUST",
    cite: "streamable-http 2026-07-28: streams are not resumable — Last-Event-ID MUST NOT resume a stream",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, {
        method: "GET",
        headers: { ...baseHeaders(ctx), accept: "text/event-stream", "last-event-id": "42" },
      });
      if (isSkip(response)) return response;
      const resumed = response.status === 200 && isSse(response);
      return {
        ok: !resumed,
        observed: resumed
          ? "GET with Last-Event-ID was answered with an SSE stream (resumption behavior)"
          : `GET with Last-Event-ID returned ${String(response.status)} (no resumption)`,
      };
    },
  },
  {
    id: "transport.missing_protocol_version_accepted",
    level: "MUST",
    cite: "versioning 2026-07-28: a request without MCP-Protocol-Version MUST be accepted",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, {
        method: "POST",
        headers: headersWithoutVersion(ctx),
        bodyText: rpcBody("tools/list", 9003),
      });
      if (isSkip(response)) return response;
      const envelope = parseEnvelope(response.bodyText);
      return {
        ok: response.status === 200 && envelope.ok === true,
        observed: `request without the version header returned HTTP ${String(response.status)}${envelope.errorCode !== undefined ? `, code ${String(envelope.errorCode)}` : ""}`,
      };
    },
  },
  {
    id: "transport.header_body_mismatch_accepted",
    level: "MUST",
    cite: "versioning 2026-07-28: header/body protocol-version disagreement MUST be 400 + -32020 HeaderMismatch",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, {
        method: "POST",
        headers: baseHeaders(ctx),
        bodyText: rpcBody("server/discover", 9004, { protocolVersion: "2025-11-25" }),
      });
      if (isSkip(response)) return response;
      const envelope = parseEnvelope(response.bodyText);
      return {
        ok: envelope.errorCode === -32020,
        observed: `mismatched header/body version returned HTTP ${String(response.status)}, code ${String(envelope.errorCode ?? "none")}`,
      };
    },
  },
  {
    id: "transport.mcp_name_missing_accepted",
    level: "MUST",
    cite: "streamable-http 2026-07-28: a request without MCP-Name MUST be accepted",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, {
        method: "POST",
        headers: baseHeaders(ctx),
        bodyText: rpcBody("tools/list", 9005),
      });
      if (isSkip(response)) return response;
      const envelope = parseEnvelope(response.bodyText);
      return {
        ok: response.status === 200 && envelope.ok === true,
        observed: `request without MCP-Name returned HTTP ${String(response.status)}`,
      };
    },
  },
  {
    id: "transport.mcp_name_mismatch_accepted",
    level: "MUST",
    cite: "streamable-http 2026-07-28: a mismatched MCP-Name MUST be rejected (-32020)",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, {
        method: "POST",
        headers: { ...baseHeaders(ctx), "mcp-name": "snapgauge-not-this-server" },
        bodyText: rpcBody("tools/list", 9006),
      });
      if (isSkip(response)) return response;
      const envelope = parseEnvelope(response.bodyText);
      return {
        ok: envelope.errorCode === -32020,
        observed:
          envelope.ok === true
            ? "a request naming a DIFFERENT server was accepted"
            : `mismatched MCP-Name returned code ${String(envelope.errorCode ?? "none")}`,
      };
    },
  },
  {
    id: "transport.mcp_name_base64_not_decoded",
    level: "MUST",
    cite: "streamable-http 2026-07-28: the =?base64?…?= MCP-Name sentinel MUST be decoded before comparing",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      if (ctx.serverName === undefined) {
        return { skipped: "server name unknown (server/discover unavailable)" };
      }
      const sentinel = `=?base64?${btoa(ctx.serverName)}?=`;
      const response = await raw(ctx, {
        method: "POST",
        headers: { ...baseHeaders(ctx), "mcp-name": sentinel },
        bodyText: rpcBody("tools/list", 9007),
      });
      if (isSkip(response)) return response;
      const envelope = parseEnvelope(response.bodyText);
      return {
        ok: response.status === 200 && envelope.ok === true,
        observed:
          envelope.ok === true
            ? "base64 MCP-Name sentinel decoded and accepted"
            : `base64 MCP-Name sentinel rejected with code ${String(envelope.errorCode ?? "none")} (not decoded before comparing)`,
      };
    },
  },
  {
    id: "transport.unknown_method_not_404_32601",
    level: "MUST",
    cite: "basic: an unknown method MUST yield JSON-RPC -32601, not HTTP 404",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, {
        method: "POST",
        headers: baseHeaders(ctx),
        bodyText: rpcBody("snapgauge/no_such_method", 9002),
      });
      if (isSkip(response)) return response;
      const envelope = parseEnvelope(response.bodyText);
      return {
        ok: response.status === 200 && envelope.errorCode === -32601,
        observed: `unknown method returned HTTP ${String(response.status)}, code ${String(envelope.errorCode ?? "none")}`,
      };
    },
  },
  {
    id: "transport.unsupported_version_not_32022",
    level: "MUST",
    cite: "versioning 2026-07-28: an unsupported version MUST be -32022 with non-empty data.supported[]",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, {
        method: "POST",
        headers: { ...baseHeaders(ctx), "mcp-protocol-version": "1999-01-01" },
        bodyText: rpcBody("tools/list", 9008),
      });
      if (isSkip(response)) return response;
      const envelope = parseEnvelope(response.bodyText);
      const supported =
        typeof envelope.errorData === "object" &&
        envelope.errorData !== null &&
        !Array.isArray(envelope.errorData)
          ? envelope.errorData.supported
          : undefined;
      const ok =
        envelope.errorCode === -32022 && Array.isArray(supported) && supported.length > 0;
      return {
        ok,
        observed: `unsupported version returned code ${String(envelope.errorCode ?? "none")}${Array.isArray(supported) ? ` with ${String(supported.length)} supported version(s)` : " without data.supported[]"}`,
      };
    },
  },
  {
    id: "transport.origin_invalid_not_403",
    level: "MUST",
    cite: "streamable-http: an invalid Origin MUST be rejected 403 (DNS-rebinding defense)",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, {
        method: "POST",
        headers: { ...baseHeaders(ctx), origin: "http://snapgauge-evil.example" },
        bodyText: rpcBody("tools/list", 9009),
      });
      if (isSkip(response)) return response;
      return {
        ok: response.status === 403,
        observed: `invalid Origin returned ${String(response.status)}`,
      };
    },
  },
  {
    id: "transport.meta_missing_not_32602",
    level: "MUST",
    cite: "server/tools 2026-07-28: tools/call without required _meta MUST be -32602 (or HTTP 400)",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      if (ctx.sampleTool === undefined) {
        return { skipped: "no tool available to call (tools/list unavailable)" };
      }
      const response = await raw(ctx, {
        method: "POST",
        headers: baseHeaders(ctx),
        bodyText: rpcBody("tools/call", 9011, { name: ctx.sampleTool, arguments: {} }),
      });
      if (isSkip(response)) return response;
      const envelope = parseEnvelope(response.bodyText);
      return {
        ok: envelope.errorCode === -32602 || response.status === 400,
        observed: `tools/call without _meta returned HTTP ${String(response.status)}, code ${String(envelope.errorCode ?? "none")}`,
      };
    },
  },
  {
    id: "transport.notification_not_202",
    level: "MUST",
    cite: "streamable-http: a lone notification MUST be answered 202 Accepted",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await raw(ctx, {
        method: "POST",
        headers: baseHeaders(ctx),
        bodyText: rpcBody("notifications/initialized"),
      });
      if (isSkip(response)) return response;
      return {
        ok: response.status === 202,
        observed: `notification returned ${String(response.status)}`,
      };
    },
  },
  {
    id: "transport.sse_no_accel_buffering",
    level: "SHOULD",
    cite: "streamable-http: SSE responses SHOULD carry X-Accel-Buffering: no",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await openListenStream(ctx);
      if (isSkip(response)) return response;
      const value = response.headers["x-accel-buffering"];
      return {
        ok: value?.toLowerCase() === "no",
        observed:
          value === undefined
            ? "SSE stream has no X-Accel-Buffering header"
            : `X-Accel-Buffering: ${value}`,
      };
    },
  },
  {
    id: "transport.sse_no_keepalive",
    level: "SHOULD",
    cite: "streamable-http: long-lived SSE streams SHOULD send keepalive comments",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: async (ctx) => {
      const response = await openListenStream(ctx);
      if (isSkip(response)) return response;
      const keepalive = response.bodyText.split("\n").some((line) => line.startsWith(":"));
      return {
        ok: keepalive,
        observed: keepalive
          ? "keepalive comment observed in the buffered stream window"
          : "no keepalive comment in the buffered stream window",
      };
    },
  },
  {
    id: "transport.discover_not_implemented",
    level: "MUST",
    cite: "server/discover 2026-07-28: servers MUST implement server/discover",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: (ctx) => {
      const discover = ctx.observations?.discover;
      if (discover === undefined) return { skipped: "server/discover was not probed in this run" };
      if (discover === "ok") return { ok: true, observed: "server/discover answered" };
      return {
        ok: false,
        observed: `server/discover failed with code ${String(discover.errorCode ?? "none")}`,
      };
    },
  },
  {
    id: "transport.result_type_absent",
    level: "MUST",
    cite: "server/tools 2026-07-28: tool results MUST carry resultType",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: (ctx) => {
      const absent = ctx.observations?.resultTypeAbsent;
      if (absent === undefined) return { skipped: "no tools/call results observed in this run" };
      return {
        ok: absent.length === 0,
        observed:
          absent.length === 0
            ? "every observed tool result carried resultType"
            : `resultType missing on probe(s): ${absent.join(", ")}`,
      };
    },
  },
  {
    id: "transport.cache_hints_missing",
    level: "MUST",
    cite: "utilities/caching 2026-07-28: cacheable surfaces MUST carry ttlMs>=0 + cacheScope",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: (ctx) => {
      const missing = ctx.observations?.cacheHintsMissing;
      if (missing === undefined) return { skipped: "cacheable surfaces were not probed in this run" };
      return {
        ok: missing.length === 0,
        observed:
          missing.length === 0
            ? "ttlMs + cacheScope present on every probed surface"
            : `cache hints missing on: ${missing.join(", ")}`,
      };
    },
  },
  {
    id: "transport.cachescope_inconsistent_across_pages",
    level: "MUST",
    cite: "utilities/caching 2026-07-28: cacheScope MUST be identical on every page of a paginated list",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: (ctx) => {
      const pages = ctx.observations?.cacheScopeByPage;
      if (pages === undefined) return { skipped: "tools/list pagination was not observed in this run" };
      if (pages.length < 2) return { ok: true, observed: "single page" };
      const distinct = new Set(pages.map((scope) => scope ?? "(absent)"));
      return {
        ok: distinct.size === 1,
        observed:
          distinct.size === 1
            ? `cacheScope identical across ${String(pages.length)} pages`
            : `cacheScope varies across pages: ${[...distinct].sort().join(" vs ")}`,
      };
    },
  },
  {
    id: "transport.reserved_error_code_misuse",
    level: "MUST",
    cite: "basic 2026-07-28: -32020..-32099 is spec-reserved; -32002/-32042 MUST NOT be emitted",
    appliesTo: HTTP_FRAMING,
    naReason: NA_FRAMING,
    run: (ctx) => {
      const codes = ctx.observations?.observedErrorCodes;
      if (codes === undefined) return { skipped: "no error codes observed in this run" };
      const misused = [...new Set(codes.filter(isReservedCodeMisuse))].sort((a, b) => a - b);
      return {
        ok: misused.length === 0,
        observed:
          misused.length === 0
            ? "no reserved-band misuse among observed error codes"
            : `reserved code(s) misused: ${misused.map(String).join(", ")}`,
      };
    },
  },
];

export async function runTransportAssertions(
  ctx: AssertionContext,
  assertions: readonly TransportAssertion[] = TRANSPORT_ASSERTIONS,
): Promise<AssertionReport[]> {
  const reports: AssertionReport[] = [];
  for (const assertion of assertions) {
    if (!assertion.appliesTo.includes(ctx.kind)) {
      reports.push({
        id: assertion.id,
        level: assertion.level,
        verdict: "n/a",
        detail: `n/a (${ctx.kind}) — ${assertion.naReason}`,
        cite: assertion.cite,
      });
      continue;
    }
    const outcome = await assertion.run(ctx);
    if ("skipped" in outcome) {
      reports.push({
        id: assertion.id,
        level: assertion.level,
        verdict: "skipped",
        detail: outcome.skipped,
        cite: assertion.cite,
      });
      continue;
    }
    reports.push({
      id: assertion.id,
      level: assertion.level,
      verdict: outcome.ok ? "pass" : assertion.level === "MUST" ? "fail" : "warn",
      detail: outcome.observed,
      cite: assertion.cite,
    });
  }
  return reports;
}
