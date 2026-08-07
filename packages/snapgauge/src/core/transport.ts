/**
 * The Transport boundary (SPEC §3): core never opens a socket — it consumes
 * an injected `Transport`. That single boundary is what lets the same engine
 * run in a Vercel function, a browser Web Worker, and the CLI.
 *
 * Transports: `fixture` (in-process, SPEC §4 — evals and the offline demo),
 * `http` (undici + address policy, src/node/http-transport.ts) and `stdio`
 * (src/node/stdio-transport.ts). The optional raw-HTTP capability is what
 * the T-group framing assertions (SPEC §5) run through: a transport that
 * cannot speak raw HTTP simply reports those assertions `n/a` — never
 * silently passed.
 */
import type { Json } from "./json.js";
import { JsonValueSchema } from "./json.js";
import type { JsonRpcRequest } from "./jsonrpc.js";
import type { Profile } from "./profile.js";

export type TransportKind = "http" | "stdio" | "fixture";

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Json;
}

/**
 * A raw HTTP exchange beneath the JSON-RPC layer — the surface the T-group
 * framing assertions probe (GET/DELETE handling, header behavior,
 * notifications, SSE headers). `bodyText` is the buffered response body,
 * capped by the transport for streams.
 */
export interface RawHttpRequest {
  method: string;
  headers: Record<string, string>;
  bodyText?: string;
}

export interface RawHttpResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
}

export interface Transport {
  send(request: JsonRpcRequest, headers?: Record<string, string>): Promise<TransportResponse>;
  /** Raw HTTP access for framing assertions — absent on stdio (SPEC §4: `n/a (stdio)`). */
  raw?(request: RawHttpRequest): Promise<RawHttpResponse>;
  /** Release sockets / child processes. Idempotent. */
  close?(): Promise<void>;
}

/**
 * SPEC §7: a fixture server is a pure `(request, profile) => response`
 * function. The optional third parameter carries transport headers so the
 * X-group live checks (x-mcp-header, SPEC §5) can run in-process; fixtures
 * that ignore it remain valid.
 */
export type FixtureResponse = TransportResponse;
export type FixtureServer = (
  request: JsonRpcRequest,
  profile: Profile,
  headers?: Record<string, string>,
) => FixtureResponse;

/** Raw-framing half of a fixture (SPEC §7 nonconformant fixtures override it). */
export type FixtureRawHandler = (request: RawHttpRequest, profile: Profile) => RawHttpResponse;

export function createFixtureTransport(
  server: FixtureServer,
  profile: Profile,
  raw?: FixtureRawHandler,
): Transport {
  const transport: Transport = {
    send: (request, headers) =>
      Promise.resolve(validateResponse(server(request, profile, headers))),
  };
  if (raw !== undefined) {
    transport.raw = (request) => Promise.resolve(raw(request, profile));
  }
  return transport;
}

/** Zod at the boundary (SPEC §9): even in-process fixture bodies are validated. */
function validateResponse(response: FixtureResponse): TransportResponse {
  return { ...response, body: JsonValueSchema.parse(response.body) };
}
