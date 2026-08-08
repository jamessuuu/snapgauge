/**
 * Web-boundary error redaction (defect fix, SECURITY.md:33-34,126-127 "never
 * the resolved IP, never the upstream error text"). Reproduced before the
 * fix: an authorized public host that refuses the TCP/TLS handshake made
 * `runLiveCheck` throw `PROBE_FAILURE` with message
 * `HTTP request failed: connect ECONNREFUSED 127.0.0.1:<port>` —
 * packages/snapgauge/src/node/http-transport.ts:93 interpolates the raw
 * Node/undici error via `describe(cause)`, and that error reached
 * `apps/web/app/api/check/route.ts:69-70` verbatim (`errorResponse(error.code,
 * error.message)`). Every case below proves the redaction now in
 * `runLiveCheck` (this module) holds: the CODE survives, the MESSAGE never
 * does.
 *
 * `authorizedTarget` sidesteps `authorizeWebTarget`'s SSRF gate on purpose —
 * a real `public-only` authorization can never resolve to loopback, so
 * there is no other way to point this function at a local test server.
 * `ssrf-block-matrix.test.ts` already owns proving the gate itself blocks
 * loopback; this file owns what happens to an ALREADY-authorized target
 * that then fails, exactly the reviewer's reproduction shape.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { SnapgaugeError } from "snapgauge";
import { runLiveCheck } from "./live-check.js";

/** No IPv4/IPv6 literal may appear anywhere in a client-facing message —
 * asserted by shape (a regex over address-like patterns), not by checking
 * for one specific fixture string, so the test still catches a leak even if
 * the exact wording of a message changes later. */
const IPV4_LITERAL = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6_LITERAL = /(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}/;

function assertNoAddressOrUpstreamText(message: string, forbiddenSubstrings: readonly string[]): void {
  expect(message).not.toMatch(IPV4_LITERAL);
  expect(message).not.toMatch(IPV6_LITERAL);
  for (const forbidden of forbiddenSubstrings) {
    expect(message.toLowerCase()).not.toContain(forbidden.toLowerCase());
  }
}

describe("runLiveCheck — web-boundary redaction", () => {
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

  async function listenClosedPort(): Promise<number> {
    // Bind then immediately close: guarantees a port with nothing listening,
    // producing a deterministic, local-only ECONNREFUSED.
    const probe = createServer();
    const port = await new Promise<number>((resolve) => {
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
    await new Promise<void>((resolve) => {
      probe.close(() => { resolve(); });
    });
    return port;
  }

  async function listenPlainHttp(): Promise<number> {
    server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    return new Promise<number>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
  }

  async function listenAndHang(): Promise<number> {
    server = createServer(() => {
      // Never respond — simulates a hung/slow upstream MCP server.
    });
    return new Promise<number>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
  }

  it("connection refused — the raw error carries the pinned IP and port; the redacted one carries neither", async () => {
    const port = await listenClosedPort();
    let caught: unknown;
    try {
      await runLiveCheck("https://mcp.snapgauge-test.example/mcp", {
        authorizedTarget: {
          url: new URL(`https://mcp.snapgauge-test.example:${String(port)}/mcp`),
          pinnedAddress: { address: "127.0.0.1", family: 4 },
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SnapgaugeError);
    const err = caught as SnapgaugeError;
    expect(err.code).toBe("PROBE_FAILURE");
    assertNoAddressOrUpstreamText(err.message, ["ECONNREFUSED", String(port), "127.0.0.1"]);
    // Prove the leak was real and is now merely SUPPRESSED, not that the
    // underlying failure mode stopped happening: the raw detail is
    // preserved on `.cause` for server-side diagnostics and DOES contain
    // exactly what the reviewer reproduced.
    expect(err.cause).toBeInstanceOf(SnapgaugeError);
    expect((err.cause as SnapgaugeError).message).toMatch(/ECONNREFUSED/);
    expect((err.cause as SnapgaugeError).message).toContain("127.0.0.1");
  });

  it("TLS failure — a handshake failure against a plaintext server is redacted", async () => {
    const port = await listenPlainHttp();
    let caught: unknown;
    try {
      await runLiveCheck("https://mcp.snapgauge-test.example/mcp", {
        authorizedTarget: {
          url: new URL(`https://mcp.snapgauge-test.example:${String(port)}/mcp`),
          pinnedAddress: { address: "127.0.0.1", family: 4 },
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SnapgaugeError);
    const err = caught as SnapgaugeError;
    expect(err.code).toBe("PROBE_FAILURE");
    assertNoAddressOrUpstreamText(err.message, [String(port), "127.0.0.1", "ssl", "tls"]);
  });

  it("DNS-level failure post-authorization — a lookup failure for an otherwise-valid hostname is redacted", async () => {
    let caught: unknown;
    try {
      await runLiveCheck("https://mcp.snapgauge-test.example/mcp", {
        lookup: () =>
          Promise.reject(
            new Error("getaddrinfo ENOTFOUND mcp.snapgauge-test.example (resolver: 10.55.2.9)"),
          ),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SnapgaugeError);
    const err = caught as SnapgaugeError;
    expect(err.code).toBe("PROBE_FAILURE");
    assertNoAddressOrUpstreamText(err.message, ["ENOTFOUND", "10.55.2.9", "resolver"]);
  });

  it("timeout — the wall-clock deadline message carries no target detail", async () => {
    const port = await listenAndHang();
    let caught: unknown;
    try {
      await runLiveCheck("https://mcp.snapgauge-test.example/mcp", {
        wallClockMs: 50,
        authorizedTarget: {
          // Plain http: a real (non-TLS) hang, decoupled from the TLS-failure
          // scenario above — this must time out via the wall clock, not fail
          // fast from a handshake mismatch.
          url: new URL(`http://mcp.snapgauge-test.example:${String(port)}/mcp`),
          pinnedAddress: { address: "127.0.0.1", family: 4 },
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SnapgaugeError);
    const err = caught as SnapgaugeError;
    expect(err.code).toBe("PROBE_TIMEOUT");
    assertNoAddressOrUpstreamText(err.message, [String(port), "127.0.0.1"]);
  });

  it("timeout — the underlying request is actually aborted, not merely raced (defect 2)", async () => {
    let observedClose = false;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.on("close", () => {
        observedClose = true;
        resolveClosed();
      });
      // Never respond.
    });
    const port = await new Promise<number>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });

    await expect(
      runLiveCheck("https://mcp.snapgauge-test.example/mcp", {
        wallClockMs: 50,
        authorizedTarget: {
          url: new URL(`http://mcp.snapgauge-test.example:${String(port)}/mcp`),
          pinnedAddress: { address: "127.0.0.1", family: 4 },
        },
      }),
    ).rejects.toMatchObject({ code: "PROBE_TIMEOUT" });

    // The load-bearing proof for defect 2: the server actually observed the
    // connection close (a real cancellation), not just that the client
    // promise settled on schedule. Bounded wait, not a timing assertion.
    await Promise.race([
      closed,
      new Promise((_resolve, reject) => {
        setTimeout(() => { reject(new Error("server never observed the connection close — request was not cancelled")); }, 5000);
      }),
    ]);
    expect(observedClose).toBe(true);
  });

  it("every redacted case, serialized exactly as route.ts returns it, is free of address literals", async () => {
    const port = await listenClosedPort();
    let caught: unknown;
    try {
      await runLiveCheck("https://mcp.snapgauge-test.example/mcp", {
        authorizedTarget: {
          url: new URL(`https://mcp.snapgauge-test.example:${String(port)}/mcp`),
          pinnedAddress: { address: "127.0.0.1", family: 4 },
        },
      });
    } catch (error) {
      caught = error;
    }
    const err = caught as SnapgaugeError;
    // The exact shape apps/web/app/api/check/route.ts's errorResponse() emits.
    const responseBody = JSON.stringify({ ok: false, error: { code: err.code, message: err.message } });
    expect(responseBody).not.toMatch(IPV4_LITERAL);
    expect(responseBody).not.toMatch(IPV6_LITERAL);
  });
});
