/**
 * Node HTTP adapter (SPEC §3: fixtures are "also exposed as a stdio bin and
 * a Next route"): serve a fixture over REAL HTTP on localhost — the M2 e2e
 * gate. The adapter is a thin shell: all framing behavior lives in the
 * fixture's raw handler, so what e2e observes over the wire is exactly what
 * the in-process fixture transport observes.
 */
import { createServer, type Server } from "node:http";
import type { JsonObject, Profile, RawHttpRequest } from "snapgauge";
import type { FixtureEntry } from "./server.ts";

export interface RunningFixtureServer {
  url: string;
  close(): Promise<void>;
}

/** Reconstruct the client profile from the wire (SPEC §5: a profile is
 * protocolVersion + clientCapabilities + extensions + header behavior). */
function profileFromWire(headers: Record<string, string>, bodyText: string): Profile {
  let clientCapabilities: JsonObject = {};
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed === "object" && parsed !== null) {
      const params = (parsed as Record<string, unknown>).params;
      if (typeof params === "object" && params !== null) {
        const meta = (params as Record<string, unknown>)._meta;
        if (typeof meta === "object" && meta !== null) {
          const caps = (meta as Record<string, unknown>).clientCapabilities;
          if (typeof caps === "object" && caps !== null && !Array.isArray(caps)) {
            clientCapabilities = caps as JsonObject;
          }
        }
      }
    }
  } catch {
    // Not JSON — the raw handler reports it; profile stays minimal.
  }
  return {
    name: "wire",
    protocolVersion: headers["mcp-protocol-version"] ?? "2026-07-28",
    clientCapabilities,
  };
}

export function startFixtureHttpServer(entry: FixtureEntry): Promise<RunningFixtureServer> {
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
      }
      const rawRequest: RawHttpRequest = {
        method: request.method ?? "GET",
        headers,
        ...(bodyText !== "" ? { bodyText } : {}),
      };
      const raw = entry.raw(rawRequest, profileFromWire(headers, bodyText));
      response.writeHead(raw.status, raw.headers);
      response.end(raw.bodyText);
    });
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.on("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectPromise(new Error("fixture http server: no address"));
        return;
      }
      resolvePromise({
        url: `http://127.0.0.1:${String(address.port)}/mcp`,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.closeAllConnections();
            server.close(() => {
              resolveClose();
            });
          }),
      });
    });
  });
}
