/**
 * The SSRF block matrix (M5 hard requirement): one test per blocked class
 * from SPEC §4's `/api/check` policy — "https only, port 443/80, no
 * userinfo, no IP-literal hosts ... reject RFC1918 / loopback / link-local /
 * CGNAT / IPv6 ULA & mapped / 169.254.169.254 ... maxRedirections: 0."
 *
 * DNS-dependent classes (RFC1918, loopback, link-local, CGNAT, ULA, mapped,
 * metadata) are proven end-to-end through `authorizeWebTarget` itself (the
 * function `/api/check` actually calls), via an injected `lookup` so the
 * test never touches the network — `classifyAddress`'s own exhaustive
 * matrix already lives in packages/snapgauge/src/node/address-policy.test.ts
 * and is not duplicated here. URL-shape classes (IP-literal host, userinfo,
 * http scheme, non-standard port) and the redirect behavior are specific to
 * this app's wrapper/transport and have no coverage elsewhere.
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ProbeSession, SnapgaugeError } from "snapgauge";
import { createHttpTransport, type LookupFn } from "snapgauge/node";
import { authorizeWebTarget } from "./ssrf-policy.js";

const HOSTNAME = "mcp.snapgauge-test.example";

function lookupFor(address: string, family: 4 | 6 = 4): LookupFn {
  return () => Promise.resolve([{ address, family }]);
}

async function expectBlocked(url: string, lookup?: LookupFn): Promise<void> {
  await expect(authorizeWebTarget(url, lookup)).rejects.toMatchObject({
    code: "TARGET_NOT_ALLOWED",
  });
}

describe("SSRF block matrix — /api/check URL policy (SPEC §4)", () => {
  it("RFC1918 (private) — resolved address blocked", async () => {
    await expectBlocked(`https://${HOSTNAME}/mcp`, lookupFor("10.1.2.3"));
  });

  it("loopback — resolved address blocked", async () => {
    await expectBlocked(`https://${HOSTNAME}/mcp`, lookupFor("127.0.0.1"));
  });

  it("link-local — resolved address blocked", async () => {
    await expectBlocked(`https://${HOSTNAME}/mcp`, lookupFor("169.254.1.1"));
  });

  it("CGNAT — resolved address blocked", async () => {
    await expectBlocked(`https://${HOSTNAME}/mcp`, lookupFor("100.64.0.1"));
  });

  it("IPv6 ULA — resolved address blocked", async () => {
    await expectBlocked(`https://${HOSTNAME}/mcp`, lookupFor("fd12:3456::1", 6));
  });

  it("IPv4-mapped IPv6 — resolved address blocked (mapped literals refused outright)", async () => {
    await expectBlocked(`https://${HOSTNAME}/mcp`, lookupFor("::ffff:8.8.8.8", 6));
  });

  it("cloud metadata address (169.254.169.254) — resolved address blocked", async () => {
    await expectBlocked(`https://${HOSTNAME}/mcp`, lookupFor("169.254.169.254"));
  });

  it("IP-literal host (IPv4) — blocked before any DNS lookup, even a PUBLIC literal", async () => {
    // No lookup is provided: if the code path reached DNS resolution this
    // would throw for the wrong reason (or hang) — proving rejection
    // happens at URL-shape validation, before authorizeTarget runs.
    await expectBlocked("https://93.184.216.34/mcp");
  });

  it("IP-literal host (private IPv4 literal) — blocked", async () => {
    await expectBlocked("https://10.0.0.1/mcp");
  });

  it("IP-literal host (bracketed IPv6) — blocked", async () => {
    await expectBlocked("https://[::1]/mcp");
  });

  it("userinfo in the URL — blocked", async () => {
    await expectBlocked(`https://user:pass@${HOSTNAME}/mcp`, lookupFor("93.184.216.34"));
  });

  it("http scheme (not https) — blocked", async () => {
    await expectBlocked(`http://${HOSTNAME}/mcp`, lookupFor("93.184.216.34"));
  });

  it("non-standard port — blocked", async () => {
    await expectBlocked(`https://${HOSTNAME}:8443/mcp`, lookupFor("93.184.216.34"));
  });

  it("port 443 (explicit) and default (implicit) are both allowed through to authorizeTarget", async () => {
    await expect(
      authorizeWebTarget(`https://${HOSTNAME}:443/mcp`, lookupFor("93.184.216.34")),
    ).resolves.toMatchObject({ pinnedAddress: { address: "93.184.216.34" } });
    await expect(
      authorizeWebTarget(`https://${HOSTNAME}/mcp`, lookupFor("93.184.216.34")),
    ).resolves.toMatchObject({ pinnedAddress: { address: "93.184.216.34" } });
  });

  it("a genuinely public address is authorized and pinned", async () => {
    const authorized = await authorizeWebTarget(`https://${HOSTNAME}/mcp`, lookupFor("93.184.216.34"));
    expect(authorized.pinnedAddress).toEqual({ address: "93.184.216.34", family: 4 });
  });
});

describe("SSRF block matrix — redirects are never followed (SPEC §6 transport.redirect)", () => {
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

  it("a 302 on the MCP endpoint is surfaced as a probe failure, never followed", async () => {
    server = createServer((_req, res) => {
      res.writeHead(302, { location: "https://attacker.example/steal" });
      res.end();
    });
    const port = await new Promise<number>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });

    const transport = createHttpTransport({ url: `http://127.0.0.1:${String(port)}/mcp` });
    const session = new ProbeSession(transport);
    let caught: unknown;
    try {
      await session.rpc("server/discover");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SnapgaugeError);
    expect((caught as SnapgaugeError).code).toBe("PROBE_FAILURE");
    expect((caught as SnapgaugeError).message).toMatch(/redirect/i);
    expect((caught as SnapgaugeError).message).toMatch(/not followed/i);
    await transport.close();
  });
});
