import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBoardFile, readRosterFile, writeBoardFileAtomic } from "./board-io.js";
import { SnapgaugeError } from "../core/errors.js";
import type { BoardFile } from "../core/board/schema.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "snapgauge-board-io-"));
  dirs.push(dir);
  return dir;
}

describe("readRosterFile", () => {
  it("reads the shipped-shape empty roster", () => {
    const dir = tempDir();
    const path = join(dir, "roster.json");
    writeFileSync(path, JSON.stringify({ targets: {} }), "utf8");
    expect(readRosterFile(path)).toEqual({ targets: {} });
  });

  it("rejects a roster that fails Zod validation (e.g. a target with headers)", () => {
    const dir = tempDir();
    const path = join(dir, "roster.json");
    writeFileSync(
      path,
      JSON.stringify({ targets: { x: { url: "https://a.example/mcp", headers: {} } } }),
      "utf8",
    );
    expect(() => readRosterFile(path)).toThrow(SnapgaugeError);
  });

  it("rejects a missing file", () => {
    expect(() => readRosterFile(join(tempDir(), "nope.json"))).toThrow(SnapgaugeError);
  });
});

describe("writeBoardFileAtomic / readBoardFile", () => {
  const board: BoardFile = {
    date: "2026-08-09",
    generatedAt: "2026-08-09T06:17:00.000Z",
    snapgaugeVersion: "1.0.0-rc.1",
    rows: [
      {
        server: "acme",
        url: "https://mcp.acme.example/mcp",
        checkedAt: "2026-08-09T06:17:01.000Z",
        command: "snapgauge compat acme --config boards/roster.json",
        resultUrl: "https://github.com/jamessuuu/snapgauge/blob/main/boards/2026-08-09.json#acme",
        status: "ok",
        era: "modern-only",
        supportedVersions: ["2026-07-28"],
        mustViolationCount: 0,
        publishable: true,
        assertions: [],
        findings: [],
      },
    ],
  };

  it("round-trips a board file, byte-canonical on disk", () => {
    const dir = tempDir();
    const path = join(dir, "2026-08-09.json");
    writeBoardFileAtomic(path, board);
    expect(readBoardFile(path)).toEqual(board);
  });

  it("rejects a hand-corrupted board file on read", () => {
    const dir = tempDir();
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify({ date: "2026-08-09", rows: "not-an-array" }), "utf8");
    expect(() => readBoardFile(path)).toThrow(SnapgaugeError);
  });
});
