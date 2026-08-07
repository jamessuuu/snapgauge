/**
 * ProbeSession — one JSON-RPC conversation over an injected Transport.
 * Every response body is Zod-parsed as a JSON-RPC envelope BEFORE
 * interpretation (SPEC §9: Zod at every boundary). Shared by the probe
 * engine (`record`) and the compat engine (M4).
 */
import type { ZodType } from "zod";
import { SnapgaugeError } from "./errors.js";
import type { Json, JsonObject } from "./json.js";
import { JsonRpcResponseSchema } from "./jsonrpc.js";
import type { Transport } from "./transport.js";

/** A captured JSON-RPC exchange — errors are DATA here, not exceptions. */
export interface RpcExchange {
  status: number;
  contentType?: string;
  result?: Json;
  errorCode?: number;
  errorMessage?: string;
  errorData?: Json;
}

export class ProbeSession {
  private nextId = 1;

  constructor(private readonly transport: Transport) {}

  /**
   * Call and capture: JSON-RPC error responses are returned as data (they
   * are observable behavior — SPEC §2 `behavior`); only transport-level
   * failures (unreachable, non-200, malformed envelope) throw PROBE_FAILURE.
   */
  async call(
    method: string,
    params?: JsonObject,
    headers?: Record<string, string>,
  ): Promise<RpcExchange> {
    let response;
    try {
      response = await this.transport.send(
        {
          jsonrpc: "2.0",
          id: this.nextId++,
          method,
          ...(params !== undefined ? { params } : {}),
        },
        headers,
      );
    } catch (cause) {
      if (cause instanceof SnapgaugeError) throw cause;
      throw new SnapgaugeError("PROBE_FAILURE", `${method}: transport failure`, { cause });
    }
    const contentType = response.headers["content-type"];
    if (response.status !== 200) {
      if (response.status === 401 || response.status === 403) {
        // SPEC §6 auth classification. The token itself is never logged —
        // headers are redacted at capture, not at print.
        throw new SnapgaugeError(
          "AUTH",
          `${method}: HTTP ${String(response.status)} — authentication failed (token missing or expired?)`,
        );
      }
      if (response.status >= 300 && response.status < 400) {
        // SPEC §6: a redirect on the MCP endpoint is itself a finding
        // (transport.redirect) and is never followed.
        throw new SnapgaugeError(
          "PROBE_FAILURE",
          `${method}: HTTP ${String(response.status)} redirect on the MCP endpoint (transport.redirect) — not followed`,
        );
      }
      throw new SnapgaugeError("PROBE_FAILURE", `${method}: HTTP ${String(response.status)}`);
    }
    const envelope = JsonRpcResponseSchema.safeParse(response.body);
    if (!envelope.success) {
      throw new SnapgaugeError("PROBE_FAILURE", `${method}: malformed JSON-RPC envelope`);
    }
    if ("error" in envelope.data) {
      const { code, message, data } = envelope.data.error;
      return {
        status: response.status,
        ...(contentType !== undefined ? { contentType } : {}),
        errorCode: code,
        errorMessage: message,
        ...(data !== undefined ? { errorData: data } : {}),
      };
    }
    return {
      status: response.status,
      ...(contentType !== undefined ? { contentType } : {}),
      result: envelope.data.result,
    };
  }

  /** Call and REQUIRE success — probe-critical methods (server/discover, tools/list). */
  async rpc(method: string, params?: JsonObject): Promise<Json> {
    const exchange = await this.call(method, params);
    if (exchange.errorCode !== undefined) {
      throw new SnapgaugeError(
        "PROBE_FAILURE",
        `${method}: server error ${String(exchange.errorCode)}: ${exchange.errorMessage ?? ""}`,
      );
    }
    return exchange.result ?? null;
  }

  parseResult<T>(schema: ZodType<T>, result: Json, method: string): T {
    const parsed = schema.safeParse(result);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new SnapgaugeError("PROBE_FAILURE", `${method}: malformed result (${detail})`);
    }
    return parsed.data;
  }
}
