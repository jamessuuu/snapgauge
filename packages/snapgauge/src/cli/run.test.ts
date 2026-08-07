import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiffOutputSchema } from "../core/diff/diff.js";
import { EXIT } from "../core/errors.js";
import { readSnapshotFile } from "../node/snapshot-io.js";
import { runCli, type CliIo } from "./run.js";

interface CapturedIo {
  io: CliIo;
  out: string[];
  err: string[];
}

function capture(): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text) => {
        out.push(text);
      },
      stderr: (text) => {
        err.push(text);
      },
    },
    out,
    err,
  };
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "snapgauge-cli-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function recordFixture(dir: string, target: string, fixture: string): Promise<void> {
  const { io, err } = capture();
  const code = await runCli(["record", target, "--fixture", fixture, "--dir", dir], io);
  expect(code, err.join("\n")).toBe(EXIT.CLEAN);
}

describe("snapgauge CLI — usage errors (exit 4, SPEC §5)", () => {
  it("no arguments", async () => {
    const { io, err } = capture();
    expect(await runCli([], io)).toBe(EXIT.USAGE);
    expect(err.join("\n")).toContain("usage");
  });

  it("unknown command", async () => {
    const { io } = capture();
    expect(await runCli(["frobnicate"], io)).toBe(EXIT.USAGE);
  });

  it("record without --fixture", async () => {
    const { io } = capture();
    expect(await runCli(["record", "a"], io)).toBe(EXIT.USAGE);
  });

  it("record with an unknown fixture name", async () => {
    const { io, err } = capture();
    expect(await runCli(["record", "a", "--fixture", "nope@v9", "--dir", tempDir()], io)).toBe(
      EXIT.USAGE,
    );
    expect(err.join("\n")).toContain('unknown fixture "nope@v9"');
  });

  it("record with an unknown profile", async () => {
    const { io } = capture();
    expect(
      await runCli(
        ["record", "a", "--fixture", "clean@v1", "--profile", "modern-minimal", "--dir", tempDir()],
        io,
      ),
    ).toBe(EXIT.USAGE);
  });

  it("record with an unresolvable fixtures module", async () => {
    const { io } = capture();
    expect(
      await runCli(
        ["record", "a", "--fixture", "x", "--fixtures-module", "./no-such-module-xyz.js", "--dir", tempDir()],
        io,
      ),
    ).toBe(EXIT.USAGE);
  });

  it("record with a path-unsafe target name", async () => {
    const { io } = capture();
    expect(await runCli(["record", "../evil", "--fixture", "clean@v1", "--dir", tempDir()], io)).toBe(
      EXIT.USAGE,
    );
  });

  it("diff with a missing file", async () => {
    const { io } = capture();
    expect(await runCli(["diff", "no-such-a.json", "no-such-b.json"], io)).toBe(EXIT.USAGE);
  });

  it("diff with a non-JSON file", async () => {
    const dir = tempDir();
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{nope", "utf8");
    const { io } = capture();
    expect(await runCli(["diff", bad, bad], io)).toBe(EXIT.USAGE);
  });

  it("diff with an unknown --fail-on tier", async () => {
    const dir = tempDir();
    await recordFixture(dir, "a", "clean@v1");
    const file = join(dir, "a.snapshot.json");
    const { io } = capture();
    expect(await runCli(["diff", file, file, "--fail-on", "catastrophic"], io)).toBe(EXIT.USAGE);
  });

  it("--help and --version exit 0", async () => {
    const help = capture();
    expect(await runCli(["--help"], help.io)).toBe(EXIT.CLEAN);
    const version = capture();
    expect(await runCli(["--version"], version.io)).toBe(EXIT.CLEAN);
    expect(version.out.join("\n")).toContain("0.1.0-alpha.0");
  });
});

describe("snapgauge record (fixture transport, SPEC §4)", () => {
  it("writes a canonical snapshot file: LF only, trailing newline, valid v1", async () => {
    const dir = tempDir();
    await recordFixture(dir, "clean", "clean@v1");
    const file = join(dir, "clean.snapshot.json");
    const text = readFileSync(file, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.includes("\r")).toBe(false);
    const snapshot = readSnapshotFile(file);
    expect(snapshot.target).toEqual({
      transport: "fixture",
      host: "clean@v1",
      path: "",
      protocolVersion: "2026-07-28",
      auth: "none",
    });
    expect(snapshot.tools.map((t) => t.name)).toEqual(["archive_note", "get_weather", "list_notes"]);
    expect(snapshot.toolsList.order).toEqual(["get_weather", "archive_note", "list_notes"]);
  });
});

describe("snapgauge diff (offline, SPEC §4)", () => {
  it("reports no drift for the identical pair (recordedAt differs, excluded per SPEC §2)", async () => {
    const dir = tempDir();
    await recordFixture(dir, "a", "clean@v1");
    await recordFixture(dir, "b", "clean@v2-identical");
    const { io, out } = capture();
    const code = await runCli(
      ["diff", join(dir, "a.snapshot.json"), join(dir, "b.snapshot.json")],
      io,
    );
    expect(code).toBe(EXIT.CLEAN);
    expect(out.join("\n")).toContain("no drift");
  });

  it("classifies the planted breaking drift and exits 1; --json parses against DiffOutputSchema", async () => {
    const dir = tempDir();
    await recordFixture(dir, "a", "clean@v1");
    await recordFixture(dir, "b", "drift-breaking@v2");
    const { io, out } = capture();
    const code = await runCli(
      ["diff", join(dir, "a.snapshot.json"), join(dir, "b.snapshot.json"), "--json"],
      io,
    );
    expect(code).toBe(EXIT.DRIFT);
    const output = DiffOutputSchema.parse(JSON.parse(out.join("\n")));
    expect(output.summary).toEqual({ breaking: 2, risky: 1, compatible: 1, cosmetic: 2 });
    expect(output.gate).toEqual({ failOn: "risky", failed: true });
  });

  it("cosmetic-only drift passes the default gate but fails --fail-on cosmetic", async () => {
    const dir = tempDir();
    await recordFixture(dir, "a", "clean@v1");
    await recordFixture(dir, "b", "drift-cosmetic@v2");
    const a = join(dir, "a.snapshot.json");
    const b = join(dir, "b.snapshot.json");
    const relaxed = capture();
    expect(await runCli(["diff", a, b], relaxed.io)).toBe(EXIT.CLEAN);
    const strict = capture();
    expect(await runCli(["diff", a, b, "--fail-on", "cosmetic"], strict.io)).toBe(EXIT.DRIFT);
  });

  it("exits 4 with 're-record' guidance when probeSpecHash differs (SPEC §2 Decision 3)", async () => {
    const dir = tempDir();
    await recordFixture(dir, "a", "clean@v1");
    const a = join(dir, "a.snapshot.json");
    const b = join(dir, "b.snapshot.json");
    const edited = JSON.parse(readFileSync(a, "utf8")) as { probeSpecHash: string };
    edited.probeSpecHash = "b".repeat(64);
    writeFileSync(b, JSON.stringify(edited), "utf8");
    const { io, err } = capture();
    expect(await runCli(["diff", a, b], io)).toBe(EXIT.USAGE);
    expect(err.join("\n")).toContain("re-record");
  });

  it("exits 4 naming the required upgrade for a newer formatVersion (SPEC §6)", async () => {
    const dir = tempDir();
    await recordFixture(dir, "a", "clean@v1");
    const a = join(dir, "a.snapshot.json");
    const b = join(dir, "b.snapshot.json");
    const edited = JSON.parse(readFileSync(a, "utf8")) as { formatVersion: number };
    edited.formatVersion = 99;
    writeFileSync(b, JSON.stringify(edited), "utf8");
    const { io, err } = capture();
    expect(await runCli(["diff", a, b], io)).toBe(EXIT.USAGE);
    expect(err.join("\n")).toContain("formatVersion 99");
    expect(err.join("\n")).toContain("upgrade snapgauge");
  });
});

describe("snapgauge check / ci over config fixture targets (SPEC §4)", () => {
  function writeFixtureConfig(dir: string, fixture: string): void {
    const config = { targets: { fix: { transport: "fixture", fixture } } };
    writeFileSync(join(dir, "snapgauge.config.json"), JSON.stringify(config), "utf8");
  }

  it("check without a config is a usage error with init guidance", async () => {
    const dir = tempDir();
    const { io, err } = capture();
    expect(await runCli(["check"], io, { cwd: dir, env: {} })).toBe(EXIT.USAGE);
    expect(err.join("\n")).toContain("snapgauge init");
  });

  it("check before record names the record command (never writes one itself)", async () => {
    const dir = tempDir();
    writeFixtureConfig(dir, "clean@v1");
    const { io, err } = capture();
    expect(await runCli(["check", "fix"], io, { cwd: dir, env: {} })).toBe(EXIT.USAGE);
    expect(err.join("\n")).toContain("snapgauge record fix");
  });

  it("record + check round-trips a fixture config target (exit 0)", async () => {
    const dir = tempDir();
    writeFixtureConfig(dir, "clean@v1");
    const rec = capture();
    expect(await runCli(["record", "fix"], rec.io, { cwd: dir, env: {} }), rec.err.join("\n")).toBe(
      EXIT.CLEAN,
    );
    const chk = capture();
    expect(await runCli(["check"], chk.io, { cwd: dir, env: {} })).toBe(EXIT.CLEAN);
    expect(chk.out.join("\n")).toContain("below the gate");
  });

  it("ci alias renders github annotations and fails on the risky gate (SPEC §4)", async () => {
    const dir = tempDir();
    writeFixtureConfig(dir, "clean@v1");
    expect(await runCli(["record", "fix"], capture().io, { cwd: dir, env: {} })).toBe(EXIT.CLEAN);
    // Point the same target at the drifted fixture — the stored snapshot stays.
    writeFixtureConfig(dir, "drift-breaking@v2");
    const { io, out } = capture();
    const code = await runCli(["ci"], io, { cwd: dir, env: {} });
    expect(code).toBe(EXIT.DRIFT);
    const text = out.join("\n");
    expect(text).toContain("::error title=");
    expect(text).toContain("tool.removed");
  });

  it("--ignore drops a rule before gating; --only filters tiers", async () => {
    const dir = tempDir();
    writeFixtureConfig(dir, "clean@v1");
    expect(await runCli(["record", "fix"], capture().io, { cwd: dir, env: {} })).toBe(EXIT.CLEAN);
    writeFixtureConfig(dir, "drift-cosmetic@v2");
    const strict = capture();
    expect(
      await runCli(["check", "--fail-on", "cosmetic"], strict.io, { cwd: dir, env: {} }),
    ).toBe(EXIT.DRIFT);
    const ignored = capture();
    expect(
      await runCli(
        ["check", "--fail-on", "cosmetic", "--ignore", "tool.icons.changed,serverInfo.version.changed"],
        ignored.io,
        { cwd: dir, env: {} },
      ),
    ).toBe(EXIT.CLEAN);
    const only = capture();
    expect(
      await runCli(
        ["check", "--fail-on", "cosmetic", "--only", "breaking,risky"],
        only.io,
        { cwd: dir, env: {} },
      ),
    ).toBe(EXIT.CLEAN);
  });
});

describe("snapgauge report (SPEC §4: pure reformat)", () => {
  it("reformats a saved check result to markdown and exits 0", async () => {
    const dir = tempDir();
    const config = { targets: { fix: { transport: "fixture", fixture: "clean@v1" } } };
    writeFileSync(join(dir, "snapgauge.config.json"), JSON.stringify(config), "utf8");
    expect(await runCli(["record", "fix"], capture().io, { cwd: dir, env: {} })).toBe(EXIT.CLEAN);
    const chk = capture();
    expect(await runCli(["check", "--json"], chk.io, { cwd: dir, env: {} })).toBe(EXIT.CLEAN);
    const resultFile = join(dir, "result.json");
    writeFileSync(resultFile, chk.out.join("\n"), "utf8");
    const rep = capture();
    expect(await runCli(["report", resultFile, "--format", "md"], rep.io, { cwd: dir, env: {} })).toBe(
      EXIT.CLEAN,
    );
    expect(rep.out.join("\n")).toContain("## snapgauge check — fix");
  });

  it("rejects a non-result file with a usage error", async () => {
    const dir = tempDir();
    const file = join(dir, "not-a-result.json");
    writeFileSync(file, JSON.stringify({ hello: 1 }), "utf8");
    const { io } = capture();
    expect(await runCli(["report", file], io, { cwd: dir, env: {} })).toBe(EXIT.USAGE);
  });
});
