/**
 * `checkBoardTarget` (SPEC §8/§10 M6), exercised over REAL HTTP — same
 * pattern as e2e-http.test.ts. The single most safety-critical property is
 * proven directly here, not just asserted in a comment: across every run,
 * the target NEVER receives a `tools/call` request (SPEC §1/§8 — the board
 * never calls `tools/call` on a third-party server).
 */
import { getFixtureEntry } from "@snapgauge/fixtures";
import { startFixtureHttpServer, type RunningFixtureServer } from "@snapgauge/fixtures/http-server";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Profile, RawHttpRequest } from "snapgauge";
import { mustViolationCountOf } from "../src/core/board/disclosure.js";
import { afterAll, describe, expect, it } from "vitest";
import { checkBoardTarget } from "../src/node/board-runner.js";

function entryOf(name: string) {
  const entry = getFixtureEntry(name);
  if (entry === undefined) throw new Error(`fixture missing: ${name}`);
  return entry;
}

const cleanup: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

/** Wraps a fixture's raw handler to record every JSON-RPC method observed —
 * the direct proof that `tools/call` is never issued (SPEC §1/§8). */
async function serveObserved(name: string): Promise<{ server: RunningFixtureServer; methods: string[] }> {
  const entry = entryOf(name);
  const methods: string[] = [];
  const observedEntry = {
    ...entry,
    raw: (request: RawHttpRequest, profile: Profile) => {
      if (request.bodyText !== undefined && request.bodyText !== "") {
        try {
          const parsed: unknown = JSON.parse(request.bodyText);
          if (typeof parsed === "object" && parsed !== null && "method" in parsed) {
            const method = parsed.method;
            if (typeof method === "string") methods.push(method);
          }
        } catch {
          // Not JSON (e.g. a raw framing probe) — nothing to record.
        }
      }
      return entry.raw(request, profile);
    },
  };
  const server = await startFixtureHttpServer(observedEntry);
  cleanup.push(() => server.close());
  return { server, methods };
}

function serveHandler(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server: Server = createServer(handler);
    server.on("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectPromise(new Error("no address"));
        return;
      }
      cleanup.push(
        () =>
          new Promise<void>((resolveClose) => {
            server.closeAllConnections();
            server.close(() => {
              resolveClose();
            });
          }),
      );
      resolvePromise(`http://127.0.0.1:${String(address.port)}/mcp`);
    });
  });
}

describe("checkBoardTarget (SPEC §8/§10 M6)", () => {
  it("a clean, conformant server: status ok, era + supportedVersions present, zero MUST violations, no tools/call issued", async () => {
    const { server, methods } = await serveObserved("clean@v1");
    const outcome = await checkBoardTarget({ url: server.url, addressPolicy: "allow-private" });

    expect(outcome.status).toBe("ok");
    expect(outcome.era).toBe("modern-only");
    expect(outcome.supportedVersions).toEqual(["2026-07-28"]);
    expect(outcome.assertions).toBeDefined();
    expect(outcome.assertions?.some((a) => a.id === "transport.meta_missing_not_32602")).toBe(false);
    expect(mustViolationCountOf(outcome)).toBe(0);
    expect(methods).not.toContain("tools/call");
  });

  it("a nonconformant-legacy server: status ok but with MUST-level violations, no tools/call issued", async () => {
    const { server, methods } = await serveObserved("nonconformant-legacy");
    const outcome = await checkBoardTarget({ url: server.url, addressPolicy: "allow-private" });

    expect(outcome.status).toBe("ok");
    expect(mustViolationCountOf(outcome)).toBeGreaterThan(0);
    expect(methods).not.toContain("tools/call");
  });

  it("an unreachable target (connection refused) classifies as unreachable, never crashes", async () => {
    // Port 1 on loopback is refused virtually everywhere without a listener.
    const outcome = await checkBoardTarget({
      url: "http://127.0.0.1:1/mcp",
      addressPolicy: "allow-private",
      timeoutMs: 2000,
    });
    expect(outcome.status).toBe("unreachable");
    expect(outcome.statusDetail).toBeDefined();
    expect(outcome.assertions).toBeUndefined();
  });

  it("a server that answers 401 to everything classifies as auth_required, never guessed as unreachable", async () => {
    const url = await serveHandler((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "unauthorized" } }));
    });
    const outcome = await checkBoardTarget({ url, addressPolicy: "allow-private", timeoutMs: 2000 });
    expect(outcome.status).toBe("auth_required");
    expect(outcome.statusDetail).toBeDefined();
  });

  it("a bad-x-mcp-header server surfaces X-group violation findings with no tools/call issued", async () => {
    const { server, methods } = await serveObserved("bad-x-mcp-header");
    const outcome = await checkBoardTarget({ url: server.url, addressPolicy: "allow-private" });

    expect(outcome.status).toBe("ok");
    expect(outcome.findings?.some((f) => f.ruleId.startsWith("xhdr."))).toBe(true);
    expect(mustViolationCountOf(outcome)).toBeGreaterThan(0);
    expect(methods).not.toContain("tools/call");
  });
});
