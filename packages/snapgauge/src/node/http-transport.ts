/**
 * The `http` transport (SPEC §4): Streamable HTTP over undici. Redirects are
 * NEVER followed (a redirect on an MCP endpoint is itself a finding, SPEC
 * §6); under `public-only` the connection dials the PINNED resolved address
 * (rebinding defense, SPEC §3 Decision 4). Auth headers pass through and are
 * never captured into snapshots or logs.
 */
import type { LookupFunction } from "node:net";
import { Agent, request, type Dispatcher } from "undici";
import { SnapgaugeError } from "../core/errors.js";
import { JsonValueSchema, type Json } from "../core/json.js";
import type {
  RawHttpRequest,
  RawHttpResponse,
  Transport,
  TransportResponse,
} from "../core/transport.js";
import type { ResolvedAddress } from "./address-policy.js";

export interface HttpTransportOptions {
  url: string | URL;
  /** Extra request headers (e.g. Authorization) — redacted at capture. */
  headers?: Record<string, string>;
  /** Sent as MCP-Protocol-Version unless `sendProtocolVersionHeader` is false. */
  protocolVersion?: string;
  /** `legacy-headers-absent` profile: suppress the version header (SPEC §5). */
  sendProtocolVersionHeader?: boolean;
  /** Set under public-only: every connect dials this address (SPEC §3 D4). */
  pinnedAddress?: ResolvedAddress;
  /** Per-request wall clock; default 10s (SPEC §6). */
  timeoutMs?: number;
}

/** Cap on buffered stream reads for raw checks (SSE inspection, SPEC §5). */
const RAW_STREAM_BYTE_CAP = 8192;
const RAW_STREAM_TIME_CAP_MS = 1500;

export interface HttpTransport extends Transport {
  raw(rawRequest: RawHttpRequest): Promise<RawHttpResponse>;
  close(): Promise<void>;
}

export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  const url = new URL(options.url);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const agent = buildAgent(options.pinnedAddress, timeoutMs);

  const baseHeaders = (): Record<string, string> => ({
    ...(options.sendProtocolVersionHeader === false || options.protocolVersion === undefined
      ? {}
      : { "mcp-protocol-version": options.protocolVersion }),
    ...(options.headers ?? {}),
  });

  async function dispatch(
    method: string,
    headers: Record<string, string>,
    bodyText: string | undefined,
    bufferStreams: boolean,
  ): Promise<RawHttpResponse> {
    // Empty string = SUPPRESS the header (the assertion runner's convention
    // for probing header-absence, SPEC §5 missing_protocol_version_accepted).
    const effectiveHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (value !== "") effectiveHeaders[name] = value;
    }
    let response: Dispatcher.ResponseData;
    try {
      response = await request(url, {
        method,
        headers: effectiveHeaders,
        ...(bodyText !== undefined ? { body: bodyText } : {}),
        dispatcher: agent,
        signal: AbortSignal.timeout(timeoutMs),
        // Redirects are not followed: undici's plain `request` never follows
        // them (maxRedirections 0 semantics) — SPEC §6 transport.redirect.
      });
    } catch (cause) {
      if (isTimeout(cause)) {
        throw new SnapgaugeError(
          "PROBE_TIMEOUT",
          `request exceeded ${String(timeoutMs)}ms (per-request timeout, SPEC §6)`,
          { cause },
        );
      }
      throw new SnapgaugeError("PROBE_FAILURE", `HTTP request failed: ${describe(cause)}`, {
        cause,
      });
    }
    const responseHeaders = normalizeHeaders(response.headers);
    const contentType = responseHeaders["content-type"] ?? "";
    let text: string;
    if (bufferStreams && contentType.startsWith("text/event-stream")) {
      text = await readCapped(response.body);
    } else {
      try {
        text = await response.body.text();
      } catch (cause) {
        throw new SnapgaugeError("PROBE_FAILURE", `response body read failed: ${describe(cause)}`, {
          cause,
        });
      }
    }
    return { status: response.statusCode, headers: responseHeaders, bodyText: text };
  }

  return {
    async send(rpcRequest, extraHeaders): Promise<TransportResponse> {
      const response = await dispatch(
        "POST",
        {
          "content-type": "application/json",
          accept: "application/json",
          ...baseHeaders(),
          ...(extraHeaders ?? {}),
        },
        JSON.stringify(rpcRequest),
        false,
      );
      return {
        status: response.status,
        headers: response.headers,
        body: parseBody(response.bodyText),
      };
    },

    async raw(rawRequest): Promise<RawHttpResponse> {
      return dispatch(
        rawRequest.method,
        { ...baseHeaders(), ...rawRequest.headers },
        rawRequest.bodyText,
        true,
      );
    },

    async close(): Promise<void> {
      await agent.close();
    },
  };
}

function buildAgent(pinned: ResolvedAddress | undefined, timeoutMs: number): Agent {
  const connect: { lookup?: LookupFunction } = {};
  if (pinned !== undefined) {
    // The pin: every connect resolves to the address the policy authorized,
    // regardless of what DNS says now (rebinding defense, SPEC §3 D4). TLS
    // servername + Host header still come from the original URL.
    const lookup: LookupFunction = (_hostname, _lookupOptions, callback) => {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
    };
    connect.lookup = lookup;
  }
  return new Agent({
    connect,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
}

function normalizeHeaders(headers: Dispatcher.ResponseData["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function parseBody(text: string): Json {
  if (text === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON bodies surface downstream as "malformed JSON-RPC envelope".
    return null;
  }
  const validated = JsonValueSchema.safeParse(parsed);
  return validated.success ? validated.data : null;
}

/** Buffer a stream up to the byte/time caps, then stop reading (SSE checks). */
async function readCapped(body: Dispatcher.ResponseData["body"]): Promise<string> {
  let buffered = "";
  const decoder = new TextDecoder();
  const deadline = setTimeout(() => {
    body.destroy();
  }, RAW_STREAM_TIME_CAP_MS);
  try {
    for await (const chunk of body) {
      buffered += decoder.decode(chunk as Uint8Array, { stream: true });
      if (buffered.length >= RAW_STREAM_BYTE_CAP) {
        body.destroy();
        break;
      }
    }
  } catch {
    // A destroyed stream throws — the buffered window is the observation.
  } finally {
    clearTimeout(deadline);
  }
  return buffered;
}

function isTimeout(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  return (
    cause.name === "TimeoutError" ||
    cause.name === "AbortError" ||
    cause.name === "HeadersTimeoutError" ||
    cause.name === "BodyTimeoutError"
  );
}

function describe(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.cause instanceof Error ? `${cause.message} (${cause.cause.message})` : cause.message;
  }
  return String(cause);
}
