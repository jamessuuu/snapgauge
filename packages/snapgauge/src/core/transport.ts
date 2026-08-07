/**
 * The Transport boundary (SPEC §3): core never opens a socket — it consumes
 * an injected `Transport`. That single boundary is what lets the same engine
 * run in a Vercel function, a browser Web Worker, and the CLI.
 *
 * M1 ships the `fixture` transport (in-process, SPEC §4) — used by the eval
 * set and, at M5, the offline demo. `http` (undici + address policy) and
 * `stdio` land at M2 in src/node/**.
 */
import type { Json } from "./json.js";
import type { JsonRpcRequest } from "./jsonrpc.js";
import type { Profile } from "./profile.js";

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Json;
}

export interface Transport {
  send(request: JsonRpcRequest, headers?: Record<string, string>): Promise<TransportResponse>;
}

/** SPEC §7: a fixture server is a pure `(request, profile) => response` function. */
export type FixtureResponse = TransportResponse;
export type FixtureServer = (request: JsonRpcRequest, profile: Profile) => FixtureResponse;

export function createFixtureTransport(server: FixtureServer, profile: Profile): Transport {
  return {
    send: (request) => Promise.resolve(server(request, profile)),
  };
}
