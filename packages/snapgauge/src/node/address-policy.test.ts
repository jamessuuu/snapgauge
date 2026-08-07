import { describe, expect, it } from "vitest";
import { SnapgaugeError } from "../core/errors.js";
import {
  authorizeTarget,
  classifyAddress,
  type LookupFn,
} from "./address-policy.js";

describe("classifyAddress (SPEC §3 Decision 4 / §4 block list)", () => {
  const blocked: [string, string][] = [
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["172.16.0.1", "private"],
    ["172.31.9.9", "private"],
    ["192.168.1.1", "private"],
    ["127.0.0.1", "loopback"],
    ["127.9.8.7", "loopback"],
    ["169.254.1.1", "link-local"],
    ["169.254.169.254", "metadata"],
    ["100.64.0.1", "cgnat"],
    ["100.127.255.254", "cgnat"],
    ["0.0.0.0", "unspecified"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "broadcast"],
    ["198.18.0.1", "reserved"],
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fc00::1", "ula"],
    ["fd12:3456::1", "ula"],
    ["fe80::1", "link-local"],
    ["ff02::1", "multicast"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:10.0.0.1", "private"],
    ["::ffff:8.8.8.8", "reserved"], // mapped literals are refused outright
    ["64:ff9b::a00:1", "private"], // NAT64 embedding 10.0.0.1
  ];
  for (const [address, reason] of blocked) {
    it(`${address} -> ${reason}`, () => {
      expect(classifyAddress(address)).toBe(reason);
    });
  }

  const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.128.0.1", "2606:4700::6810:84e5"];
  for (const address of allowed) {
    it(`${address} is publicly routable`, () => {
      expect(classifyAddress(address)).toBeUndefined();
    });
  }
});

describe("authorizeTarget", () => {
  const publicLookup: LookupFn = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]);

  it("allow-private: no DNS, no pin — localhost is a developer's right (SPEC §3 D4)", async () => {
    const result = await authorizeTarget("http://127.0.0.1:3000/mcp", "allow-private");
    expect(result.pinnedAddress).toBeUndefined();
  });

  it("public-only: pins the first resolved address", async () => {
    const result = await authorizeTarget("https://mcp.example.com/mcp", "public-only", publicLookup);
    expect(result.pinnedAddress).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("public-only: refuses when ANY answer is blocked (rebinding split-horizon)", async () => {
    const split: LookupFn = () =>
      Promise.resolve([
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ]);
    await expect(authorizeTarget("https://mcp.example.com/mcp", "public-only", split)).rejects.toMatchObject({
      code: "TARGET_NOT_ALLOWED",
    });
  });

  it("public-only: refusal names the reason CLASS, never the resolved IP (SPEC §6)", async () => {
    const internal: LookupFn = () => Promise.resolve([{ address: "192.168.7.42", family: 4 }]);
    try {
      await authorizeTarget("https://intranet.example.com/mcp", "public-only", internal);
      expect.unreachable("expected refusal");
    } catch (error) {
      if (!(error instanceof SnapgaugeError)) throw error;
      expect(error.code).toBe("TARGET_NOT_ALLOWED");
      expect(error.message).toContain("private");
      expect(error.message).not.toContain("192.168.7.42");
    }
  });

  it("public-only: classifies IP-literal hosts without DNS", async () => {
    await expect(authorizeTarget("http://169.254.169.254/latest", "public-only")).rejects.toMatchObject({
      code: "TARGET_NOT_ALLOWED",
      message: expect.stringContaining("metadata") as string,
    });
    await expect(authorizeTarget("http://[::1]:8080/mcp", "public-only")).rejects.toMatchObject({
      code: "TARGET_NOT_ALLOWED",
    });
  });

  it("rejects userinfo and non-http(s) schemes", async () => {
    await expect(authorizeTarget("https://user:pw@example.com/mcp", "public-only", publicLookup)).rejects.toMatchObject({
      code: "TARGET_NOT_ALLOWED",
    });
    await expect(authorizeTarget("ftp://example.com/mcp", "allow-private")).rejects.toMatchObject({
      code: "USAGE",
    });
  });

  it("maps DNS failure to PROBE_FAILURE (exit-2 class)", async () => {
    const failing: LookupFn = () => Promise.reject(new Error("ENOTFOUND"));
    await expect(authorizeTarget("https://gone.example.com/mcp", "public-only", failing)).rejects.toMatchObject({
      code: "PROBE_FAILURE",
    });
  });
});
