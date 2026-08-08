import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter, DAILY_LIMIT_PER_IP } from "./rate-limit.js";

describe("createMemoryRateLimiter (SPEC §6 cost safety — degrade, never fail, with no DATABASE_URL)", () => {
  it("allows up to the daily per-IP cap, then denies", async () => {
    const limiter = createMemoryRateLimiter();
    const ip = "test-ip-a";
    for (let i = 0; i < DAILY_LIMIT_PER_IP; i++) {
      const result = await limiter.consume(ip);
      expect(result.allowed).toBe(true);
    }
    const denied = await limiter.consume(ip);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it("tracks separate IPs independently", async () => {
    const limiter = createMemoryRateLimiter();
    const a = await limiter.consume("ip-a");
    const b = await limiter.consume("ip-b");
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(a.remaining).toBe(DAILY_LIMIT_PER_IP - 1);
    expect(b.remaining).toBe(DAILY_LIMIT_PER_IP - 1);
  });

  it("remaining counts down monotonically for one IP", async () => {
    const limiter = createMemoryRateLimiter();
    const ip = "test-ip-c";
    const first = await limiter.consume(ip);
    const second = await limiter.consume(ip);
    expect(second.remaining).toBe(first.remaining - 1);
  });
});
