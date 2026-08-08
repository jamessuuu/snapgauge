/**
 * `boards/*.json` file I/O — node side of the SPEC §3 boundary, mirroring
 * `snapshot-io.ts`: reads are Zod-gated (SPEC §9), writes are atomic
 * (tmp + rename) and canonical (SPEC §2 Decision 2's format applies to any
 * committed snapgauge JSON, not only snapshots).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BoardFileSchema, RosterSchema, type BoardFile, type Roster } from "../core/board/schema.js";
import { canonicalStringify } from "../core/json.js";
import { SnapgaugeError } from "../core/errors.js";

export function readRosterFile(path: string): Roster {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new SnapgaugeError("USAGE", `cannot read roster file: ${path}`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new SnapgaugeError("USAGE", `${path} is not JSON`, { cause });
  }
  const result = RosterSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new SnapgaugeError("USAGE", `${path} is not a valid roster (${detail})`);
  }
  return result.data;
}

export function readBoardFile(path: string): BoardFile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new SnapgaugeError("USAGE", `cannot read board file: ${path}`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new SnapgaugeError("USAGE", `${path} is not JSON`, { cause });
  }
  const result = BoardFileSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new SnapgaugeError("USAGE", `${path} is not a valid board file (${detail})`);
  }
  return result.data;
}

export function writeBoardFileAtomic(path: string, board: BoardFile): void {
  const parsed = BoardFileSchema.parse(board); // never write a file we could not read back
  const text = canonicalStringify(parsed);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path); // replaces atomically; MoveFileEx semantics on Windows
}
