/**
 * The board's dead-man banner logic (SPEC §6/§8/§10 M6): "newest board >10
 * days old ⇒ banner." Pure — no filesystem, no clock — so the 10-day
 * boundary is unit-testable with an injected `now` (SPEC's M5 hard
 * requirement: "unit-tested at the boundary"). Loading `boards/*.json` off
 * disk is a separate, node-only concern (src/lib/board-loader.ts).
 */
export interface BoardRow {
  server: string;
  [key: string]: unknown;
}

export interface BoardFile {
  /** YYYY-MM-DD, from the filename `boards/<date>.json` (SPEC §3/§8). */
  date: string;
  rows: BoardRow[];
}

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type BoardStatus =
  | { kind: "empty" }
  | { kind: "fresh"; newest: BoardFile }
  | { kind: "stale"; newest: BoardFile; daysSince: number };

function newestOf(boards: readonly BoardFile[]): BoardFile | undefined {
  return [...boards].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
}

/**
 * `now` is a parameter, never `new Date()` read internally — the boundary
 * test needs a value it controls, not the wall clock. Boundary is STRICT:
 * exactly 10 days old is still fresh; the 11th day (>10 days) trips the
 * banner (SPEC §6: "newest board >10 days old").
 */
export function boardStatus(boards: readonly BoardFile[], now: Date): BoardStatus {
  const newest = newestOf(boards);
  if (newest === undefined) return { kind: "empty" };
  const newestMidnightUtc = new Date(`${newest.date}T00:00:00.000Z`).getTime();
  const ageMs = now.getTime() - newestMidnightUtc;
  if (ageMs > TEN_DAYS_MS) {
    return { kind: "stale", newest, daysSince: Math.floor(ageMs / ONE_DAY_MS) };
  }
  return { kind: "fresh", newest };
}
