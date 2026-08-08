/**
 * Reads committed `boards/*.json` (SPEC §3/§8) off disk — node-only, used
 * only from `app/board/page.tsx` at build time (static generation). No board
 * runs exist yet (M6 is not built), so an absent/empty directory is not an
 * error: `/board` renders the honest "no board published yet" state.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BoardFile, BoardRow } from "./board.js";

const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function isBoardRowArray(value: unknown): value is BoardRow[] {
  return Array.isArray(value) && value.every((row) => typeof row === "object" && row !== null);
}

function rowsFrom(parsed: unknown): BoardRow[] {
  if (isBoardRowArray(parsed)) return parsed;
  if (typeof parsed === "object" && parsed !== null && "rows" in parsed) {
    if (isBoardRowArray(parsed.rows)) return parsed.rows;
  }
  return [];
}

/** Defaults to `<repo root>/boards` — apps/web is two levels under the repo root. */
export function loadBoards(boardsDir: string = resolve(process.cwd(), "../../boards")): BoardFile[] {
  let entries: string[];
  try {
    entries = readdirSync(boardsDir);
  } catch {
    return [];
  }
  const boards: BoardFile[] = [];
  for (const entry of entries) {
    const match = DATE_RE.exec(entry);
    const date = match?.[1];
    if (date === undefined) continue;
    try {
      const raw = readFileSync(join(boardsDir, entry), "utf8");
      const parsed: unknown = JSON.parse(raw);
      boards.push({ date, rows: rowsFrom(parsed) });
    } catch {
      // A malformed board file must never crash the page (SPEC §6: never
      // present stale/broken data as current — skip it, don't 500).
      continue;
    }
  }
  return boards;
}
