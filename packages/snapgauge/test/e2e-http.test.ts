/**
 * M2 green gate, half one (SPEC §10): e2e record + check of a fixture served
 * over REAL HTTP — a node:http server on localhost wrapping the fixture's
 * raw framing, probed by the actual CLI through the undici transport.
 */
import { getFixtureEntry } from "@snapgauge/fixtures";
import { startFixtureHttpServer, type RunningFixtureServer } from "@snapgauge/fixtures/http-server";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckOutputSchema } from "snapgauge";
import { runCli, type CliIo } from "snapgauge/bin";
import { afterAll, describe, expect, it } from "vitest";
import { createHttpTransport } from "../src/node/http-transport.js";
import { ProbeSession } from "../src/core/session.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t) => { out.push(t); }, stderr: (t) => { err.push(t); } },
    out,
    err,
  };
}

function entryOf(name: string) {
  const entry = getFixtureEntry(name);
  if (entry === undefined) throw new Error(`fixture missing: ${name}`);
  return entry;
}

const PROBES = [
  { id: "weather", tool: "get_weather", arguments: { location: "Seattle" }, capture: "shape" },
];

function writeConfig(dir: string, url: string): void {
  const config = {
    snapshotDir: ".snapgauge",
    targets: {
      live: {
        transport: "http",
        url,
        protocolVersion: "2026-07-28",
        probes: PROBES,
      },
    },
  };
  writeFileSync(join(dir, "snapgauge.config.json"), JSON.stringify(config, null, 2), "utf8");
}

const cleanup: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "snapgauge-e2e-http-"));
  cleanup.push(() => { rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

async function serve(name: string): Promise<RunningFixtureServer> {
  const server = await startFixtureHttpServer(entryOf(name));
  cleanup.push(() => server.close());
  return server;
}

describe("e2e over real HTTP (SPEC §10 M2 gate)", () => {
  it("records and checks clean@v1 over localhost http — exit 0, framing assertions pass", async () => {
    const dir = tempDir();
    const server = await serve("clean@v1");
    writeConfig(dir, server.url);

    const rec = capture();
    expect(await runCli(["record", "live"], rec.io, { cwd: dir, env: {} }), rec.err.join("\n")).toBe(0);
    expect(existsSync(join(dir, ".snapgauge", "live.snapshot.json"))).toBe(true);

    const chk = capture();
    const code = await runCli(["check", "live", "--json"], chk.io, { cwd: dir, env: {} });
    expect(code, chk.err.join("\n")).toBe(0);
    const output = CheckOutputSchema.parse(JSON.parse(chk.out.join("\n")));
    expect(output.findings).toEqual([]);
    expect(output.target).toEqual({ name: "live", transport: "http" });
    for (const assertion of output.assertions ?? []) {
      expect(assertion.verdict, assertion.id).toBe("pass");
    }
  });

  it("check against a drifted server over http fails the gate with the planted findings (exit 1)", async () => {
    const dir = tempDir();
    const cleanServer = await serve("clean@v1");
    writeConfig(dir, cleanServer.url);
    const rec = capture();
    expect(await runCli(["record", "live"], rec.io, { cwd: dir, env: {} })).toBe(0);

    // The "new release": same target name, drifted surface.
    const driftServer = await serve("drift-breaking@v2");
    writeConfig(dir, driftServer.url);
    const chk = capture();
    const code = await runCli(["check", "live", "--json"], chk.io, { cwd: dir, env: {} });
    expect(code).toBe(1);
    const output = CheckOutputSchema.parse(JSON.parse(chk.out.join("\n")));
    expect(output.gate.failed).toBe(true);
    expect(output.findings.map((f) => f.ruleId)).toContain("tool.removed");
    // check never writes: a re-check against the clean server still passes
    writeConfig(dir, cleanServer.url);
    const again = capture();
    expect(await runCli(["check", "live"], again.io, { cwd: dir, env: {} })).toBe(0);
  });

  it("--update rewrites the snapshot and the next check is clean", async () => {
    const dir = tempDir();
    const cleanServer = await serve("clean@v1");
    writeConfig(dir, cleanServer.url);
    expect(await runCli(["record", "live"], capture().io, { cwd: dir, env: {} })).toBe(0);
    const driftServer = await serve("drift-cosmetic@v2");
    writeConfig(dir, driftServer.url);
    const updating = capture();
    // cosmetic drift passes the default gate; --update rewrites regardless
    expect(await runCli(["check", "live", "--update"], updating.io, { cwd: dir, env: {} })).toBe(0);
    expect(updating.out.join("\n")).toContain("snapshot updated");
    const fresh = capture();
    const code = await runCli(["check", "live", "--json"], fresh.io, { cwd: dir, env: {} });
    expect(code).toBe(0);
    const output = CheckOutputSchema.parse(JSON.parse(fresh.out.join("\n")));
    expect(output.findings).toEqual([]);
  });

  it("--strict-net refuses a loopback target with the reason class (exit 2)", async () => {
    const dir = tempDir();
    const server = await serve("clean@v1");
    writeConfig(dir, server.url);
    expect(await runCli(["record", "live"], capture().io, { cwd: dir, env: {} })).toBe(0);
    const { io, err } = capture();
    const code = await runCli(["check", "live", "--strict-net"], io, { cwd: dir, env: {} });
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("TARGET_NOT_ALLOWED");
    expect(err.join("\n")).toContain("loopback");
  });

  it("pins the resolved address: a never-resolving hostname connects via the pinned IP", async () => {
    const server = await serve("clean@v1");
    const port = new URL(server.url).port;
    const transport = createHttpTransport({
      url: `http://pinned-host.invalid:${port}/mcp`,
      protocolVersion: "2026-07-28",
      pinnedAddress: { address: "127.0.0.1", family: 4 },
      timeoutMs: 3000,
    });
    cleanup.push(() => transport.close());
    const session = new ProbeSession(transport);
    const exchange = await session.call("tools/list");
    expect(exchange.errorCode).toBeUndefined();
    expect(JSON.stringify(exchange.result)).toContain("get_weather");
  });

  it("init --url probes the live server and seeds probes from tools/list", async () => {
    const dir = tempDir();
    const server = await serve("clean@v1");
    const { io, out, err } = capture();
    const code = await runCli(
      ["init", "--url", server.url, "--target", "acme"],
      io,
      { cwd: dir, env: {} },
    );
    expect(code, err.join("\n")).toBe(0);
    expect(out.join("\n")).toContain("3 probes seeded");
    const configPath = join(dir, "snapgauge.config.json");
    expect(existsSync(configPath)).toBe(true);
    // The seeded config is immediately recordable.
    const rec = capture();
    expect(await runCli(["record", "acme"], rec.io, { cwd: dir, env: {} }), rec.err.join("\n")).toBe(0);
  });
});
