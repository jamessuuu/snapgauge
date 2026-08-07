/**
 * M2 green gate, half two (SPEC §10): e2e record + check over stdio (a real
 * spawned node process running the fixtures stdio bin), the `n/a (stdio)`
 * reporting rule, and the SPEC §6 stdio contract — per-request timeout,
 * SIGKILL teardown, no orphan processes.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CheckOutputSchema } from "snapgauge";
import { runCli, type CliIo } from "snapgauge/bin";
import { afterAll, describe, expect, it } from "vitest";
import { ProbeSession } from "../src/core/session.js";
import { createStdioTransport } from "../src/node/stdio-transport.js";

const STDIO_BIN = fileURLToPath(new URL("../../fixtures/src/stdio-bin.ts", import.meta.url));

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t) => { out.push(t); }, stderr: (t) => { err.push(t); } },
    out,
    err,
  };
}

const cleanup: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "snapgauge-e2e-stdio-"));
  cleanup.push(() => { rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

function writeConfig(dir: string, fixture: string): void {
  const config = {
    targets: {
      local: {
        transport: "stdio",
        command: process.execPath,
        args: [STDIO_BIN, fixture],
        probes: [
          { id: "weather", tool: "get_weather", arguments: { location: "Seattle" }, capture: "shape" },
        ],
      },
    },
  };
  writeFileSync(join(dir, "snapgauge.config.json"), JSON.stringify(config, null, 2), "utf8");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitGone(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !isAlive(pid);
}

describe("e2e over stdio (SPEC §10 M2 gate, SPEC §6 stdio contract)", () => {
  it("records and checks clean@v1 over a spawned stdio server — exit 0", async () => {
    const dir = tempDir();
    writeConfig(dir, "clean@v1");
    const rec = capture();
    expect(await runCli(["record", "local"], rec.io, { cwd: dir, env: {} }), rec.err.join("\n")).toBe(0);
    expect(existsSync(join(dir, ".snapgauge", "local.snapshot.json"))).toBe(true);

    const chk = capture();
    const code = await runCli(["check", "local", "--json"], chk.io, { cwd: dir, env: {} });
    expect(code, chk.err.join("\n")).toBe(0);
    const output = CheckOutputSchema.parse(JSON.parse(chk.out.join("\n")));
    expect(output.findings).toEqual([]);
    expect(output.target?.transport).toBe("stdio");
  }, 30_000);

  it("HTTP-only assertions print `n/a (stdio)` WITH the reason (SPEC §4/§10 gate)", async () => {
    const dir = tempDir();
    writeConfig(dir, "clean@v1");
    expect(await runCli(["record", "local"], capture().io, { cwd: dir, env: {} })).toBe(0);
    const { io, out } = capture();
    expect(await runCli(["check", "local"], io, { cwd: dir, env: {} })).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("transport assertions:");
    const naLines = text.split("\n").filter((l) => l.includes("n/a (stdio)"));
    expect(naLines.length).toBeGreaterThanOrEqual(5);
    for (const line of naLines) {
      // The reason is PRINTED, not implied (never silently passed).
      expect(line).toContain("n/a (stdio) — ");
      expect(line).toMatch(/no HTTP layer/);
    }
  }, 30_000);

  it("kills the child on teardown — no orphan processes (SPEC §6)", async () => {
    const transport = createStdioTransport({
      command: process.execPath,
      args: [STDIO_BIN, "clean@v1"],
      timeoutMs: 10_000,
    });
    const session = new ProbeSession(transport);
    const exchange = await session.call("tools/list");
    expect(exchange.errorCode).toBeUndefined();
    const pid = transport.pid();
    if (pid === undefined) throw new Error("child pid missing");
    expect(isAlive(pid)).toBe(true);
    await transport.close();
    expect(await waitGone(pid, 5000)).toBe(true);
  }, 30_000);

  it("a hung server hits the per-request timeout, is SIGKILLed, and exits 2 through the probe path", async () => {
    const transport = createStdioTransport({
      command: process.execPath,
      args: [STDIO_BIN, "clean@v1", "--hang"],
      timeoutMs: 500,
    });
    const session = new ProbeSession(transport);
    await expect(session.call("tools/list")).rejects.toMatchObject({ code: "PROBE_TIMEOUT" });
    const pid = transport.pid();
    if (pid === undefined) throw new Error("child pid missing");
    expect(await waitGone(pid, 5000)).toBe(true);
    await transport.close();
  }, 30_000);

  it("a dead command is a probe failure (exit-2 class), not a hang", async () => {
    const transport = createStdioTransport({
      command: join(tmpdir(), "no-such-binary-snapgauge"),
      timeoutMs: 2000,
    });
    const session = new ProbeSession(transport);
    await expect(session.call("tools/list")).rejects.toMatchObject({
      code: expect.stringMatching(/PROBE_FAILURE|PROBE_TIMEOUT/) as string,
    });
    await transport.close();
  }, 30_000);
});
