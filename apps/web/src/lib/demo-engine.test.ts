import { describe, expect, it } from "vitest";
import { runDemoPair } from "./demo-engine.js";

describe("runDemoPair (SPEC §4/§10 M5 — offline demo engine)", () => {
  it("clean@v2-identical: zero findings, exit 0 (the negative case)", async () => {
    const result = await runDemoPair("clean@v2-identical");
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it("drift-breaking@v2: breaking-tier findings present, gate fails, exit 1", async () => {
    const result = await runDemoPair("drift-breaking@v2");
    expect(result.ok).toBe(true);
    expect(result.summary?.breaking).toBeGreaterThan(0);
    expect(result.gate?.failed).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it("drift-cosmetic@v2: only cosmetic findings, passes the default gate, exit 0", async () => {
    const result = await runDemoPair("drift-cosmetic@v2");
    expect(result.ok).toBe(true);
    expect(result.summary?.breaking).toBe(0);
    expect(result.summary?.risky).toBe(0);
    expect(result.gate?.failed).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it("degrader-liar: an unrelated tool surface reads as heavy drift, gate fails", async () => {
    const result = await runDemoPair("degrader-liar");
    expect(result.ok).toBe(true);
    expect(result.findings?.length).toBeGreaterThan(0);
    expect(result.gate?.failed).toBe(true);
  });

  it("nonconformant-legacy: no server/discover — the probe fails cleanly, exit 2", async () => {
    const result = await runDemoPair("nonconformant-legacy");
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.error?.code).toBe("PROBE_FAILURE");
  });

  it("unknown pair id: usage error, exit 4", async () => {
    const result = await runDemoPair("not-a-real-fixture");
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(4);
  });
});
