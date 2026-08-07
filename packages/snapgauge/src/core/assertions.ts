/**
 * T-group transport assertions (SPEC §5): the 2026-07-28 Streamable HTTP
 * framing checks. Every assertion declares `appliesTo`; on a transport it
 * does not apply to it is reported `n/a` WITH the reason — never silently
 * passed (SPEC §4). Failing a MUST yields `fail`; failing a SHOULD yields
 * `warn`.
 *
 * M2 ships the framework plus the raw-framing basics; the full catalog
 * (header semantics, SSE, cache hints, reserved codes) lands at M4.
 */
import { z } from "zod";
import type { Json } from "./json.js";
import { JsonRpcResponseSchema } from "./jsonrpc.js";
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

export interface AssertionContext {
  kind: TransportKind;
  /** Raw HTTP access — absent on stdio and on raw-less fixtures. */
  raw?: ((request: RawHttpRequest) => Promise<RawHttpResponse>) | undefined;
  /** serverInfo.name from server/discover, when known (MCP-Name checks). */
  serverName?: string | undefined;
  /** The protocol version snapgauge normally sends. */
  protocolVersion: string;
}

type RunOutcome =
  | { ok: boolean; observed: string }
  | { skipped: string };

export interface TransportAssertion {
  id: string;
  level: "MUST" | "SHOULD";
  /** The spec citation the assertion enforces (SPEC §5 T-group). */
  cite: string;
  appliesTo: readonly TransportKind[];
  /** Printed when the assertion is n/a on the target's transport. */
  naReason: string;
  run(ctx: AssertionContext): Promise<RunOutcome>;
}

const HTTP_FRAMING = ["http", "fixture"] as const;
const NA_FRAMING =
  "requires the Streamable HTTP framing; this transport has no HTTP layer";

function rpcBody(method: string, id?: number): string {
  return JSON.stringify(
    id === undefined
      ? { jsonrpc: "2.0", method }
      : { jsonrpc: "2.0", id, method },
  );
}

function baseHeaders(ctx: AssertionContext): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    "mcp-protocol-version": ctx.protocolVersion,
  };
}

function errorCodeOf(bodyText: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  const envelope = JsonRpcResponseSchema.safeParse(parsed);
  if (!envelope.success || !("error" in envelope.data)) return undefined;
  return envelope.data.error.code;
}

function errorDataOf(bodyText: string): Json | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  const envelope = JsonRpcResponseSchema.safeParse(parsed);
  if (!envelope.success || !("error" in envelope.data)) return undefined;
  return envelope.data.error.data;
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

/**
 * The assertion registry. M2 subset — the ids and semantics come straight
 * from SPEC §5; M4 completes the catalog.
 */
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
      return {
        ok: response.status === 405,
        observed: `GET returned ${String(response.status)}`,
      };
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
      return {
        ok: response.status === 405,
        observed: `DELETE returned ${String(response.status)}`,
      };
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
      const code = errorCodeOf(response.bodyText);
      return {
        ok: response.status === 200 && code === -32601,
        observed: `unknown method returned HTTP ${String(response.status)}, code ${String(code ?? "none")}`,
      };
    },
  },
];

/** Look up a registered assertion's error data helper (used by M4 checks). */
export const assertionInternals = { errorCodeOf, errorDataOf, rpcBody, baseHeaders };

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
