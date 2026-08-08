/**
 * `maxBodyBytes` (SPEC §4/§6): the hosted live check's per-response cap,
 * added at M5. Opt-in and additive — every existing CLI/eval caller leaves
 * it unset and is unaffected (proven by the whole rest of the suite staying
 * green); this file is the new option's own coverage.
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpTransport } from "./http-transport.js";

describe("createHttpTransport maxBodyBytes", () => {
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

  async function listen(bodyText: string): Promise<number> {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(bodyText);
    });
    return new Promise<number>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
  }

  it("a response under the cap parses normally", async () => {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    const port = await listen(payload);
    const transport = createHttpTransport({
      url: `http://127.0.0.1:${String(port)}/mcp`,
      maxBodyBytes: 1024,
    });
    const response = await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.body).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    await transport.close();
  });

  it("a response over the cap is truncated (never buffered past the cap)", async () => {
    // Large enough (5 MB) to arrive across many TCP chunks over loopback —
    // a single-chunk body (small payloads often land in one `data` event)
    // would already exceed a tiny cap before the loop gets a chance to stop
    // mid-stream, which is not what this test is trying to prove.
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { padding: "x".repeat(5 * 1024 * 1024) },
    });
    const port = await listen(payload);
    const transport = createHttpTransport({
      url: `http://127.0.0.1:${String(port)}/mcp`,
      maxBodyBytes: 1024,
    });
    const response = await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    // Truncated mid-JSON is not parseable — parseBody degrades to null
    // rather than throwing, exactly like any other malformed body. The real
    // assertion is memory safety: the loop stopped near the cap rather than
    // buffering the full 5 MB (proven indirectly — a bug that kept reading
    // would still parse successfully here, which is exactly what this test
    // catches).
    expect(response.body).toBeNull();
    await transport.close();
  });

  it("unset (the CLI default): unbounded, unaffected by the cap logic at all", async () => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { padding: "x".repeat(200_000) },
    });
    const port = await listen(payload);
    const transport = createHttpTransport({ url: `http://127.0.0.1:${String(port)}/mcp` });
    const response = await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.body).toMatchObject({ jsonrpc: "2.0", id: 1 });
    await transport.close();
  });
});
