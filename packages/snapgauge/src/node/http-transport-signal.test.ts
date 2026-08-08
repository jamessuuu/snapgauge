/**
 * `signal` (defect fix): an external AbortSignal composed with the
 * per-request timeout via `AbortSignal.any`, so a caller enforcing a
 * check-wide wall-clock budget (`apps/web/src/lib/live-check.ts`) can
 * actually cancel an in-flight request instead of merely racing its return
 * value and leaving it running. Regression coverage for the defect: before
 * this option existed, losing a `Promise.race` against the transport never
 * touched the socket — the request kept running server-side after the
 * caller had already moved on (reproduced and fixed alongside this test).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpTransport } from "./http-transport.js";

describe("createHttpTransport signal", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => {
        resolve();
      });
    });
    server = undefined;
  });

  /** A server that accepts the connection and the request but NEVER responds. */
  async function listenAndHang(): Promise<{ port: number; closed: Promise<void> }> {
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.on("close", () => {
        // Fires when the underlying socket is torn down — including a
        // client-initiated abort — REGARDLESS of whether `res.end()` was
        // ever called. This is the proof the cancellation actually reached
        // the server, not just that the client-side promise settled.
        resolveClosed();
      });
      // Never call res.end() — simulates a hung/slow upstream MCP server.
    });
    const port = await new Promise<number>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
    return { port, closed };
  }

  it("aborting the external signal cancels the in-flight request server-side, not just the client promise", async () => {
    const { port, closed } = await listenAndHang();
    const controller = new AbortController();
    // Per-request timeout is deliberately long — if it fired first this
    // test would prove nothing about the EXTERNAL signal.
    const transport = createHttpTransport({
      url: `http://127.0.0.1:${String(port)}/mcp`,
      timeoutMs: 30_000,
      signal: controller.signal,
    });

    const sendPromise = transport.send({ jsonrpc: "2.0", id: 1, method: "server/discover" });
    // Give the request a moment to actually reach the server before aborting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();

    await expect(sendPromise).rejects.toMatchObject({ name: "SnapgaugeError" });
    // The load-bearing assertion: the SERVER observed the connection close.
    // Bounded wait, not a timing assertion on the abort itself — this fails
    // by TIMEOUT (not a race) if the request was never actually cancelled.
    await Promise.race([
      closed,
      new Promise((_resolve, reject) => {
        setTimeout(() => { reject(new Error("server never observed the connection close — request was not cancelled")); }, 5000);
      }),
    ]);

    await transport.close();
  });

  it("with no signal supplied, behavior is unchanged: only the per-request timeout can cancel", async () => {
    const { port } = await listenAndHang();
    const transport = createHttpTransport({
      url: `http://127.0.0.1:${String(port)}/mcp`,
      timeoutMs: 100,
    });
    const start = Date.now();
    await expect(
      transport.send({ jsonrpc: "2.0", id: 1, method: "server/discover" }),
    ).rejects.toMatchObject({ code: "PROBE_TIMEOUT" });
    expect(Date.now() - start).toBeLessThan(5000);
    await transport.close();
  });
});
