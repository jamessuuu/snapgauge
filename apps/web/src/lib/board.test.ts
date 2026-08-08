import { describe, expect, it } from "vitest";
import { boardStatus, type BoardFile } from "./board.js";

const board = (date: string): BoardFile => ({ date, rows: [{ server: "example" }] });

describe("boardStatus (SPEC §6/§10 M6 — dead-man banner)", () => {
  it("empty: no boards at all", () => {
    expect(boardStatus([], new Date("2026-08-09T00:00:00.000Z"))).toEqual({ kind: "empty" });
  });

  it("fresh: newest board is today", () => {
    const status = boardStatus([board("2026-08-09")], new Date("2026-08-09T00:00:00.000Z"));
    expect(status.kind).toBe("fresh");
  });

  it("boundary: exactly 10 days old is still fresh (not >10)", () => {
    const status = boardStatus([board("2026-07-30")], new Date("2026-08-09T00:00:00.000Z"));
    expect(status.kind).toBe("fresh");
  });

  it("boundary: 10 days + 1ms old trips the banner (>10 days)", () => {
    const status = boardStatus([board("2026-07-30")], new Date("2026-08-09T00:00:00.001Z"));
    expect(status.kind).toBe("stale");
  });

  it("boundary: 11 days old is stale, with daysSince reported", () => {
    const status = boardStatus([board("2026-07-29")], new Date("2026-08-09T00:00:00.000Z"));
    expect(status).toMatchObject({ kind: "stale", daysSince: 11 });
  });

  it("picks the newest of several boards", () => {
    const status = boardStatus(
      [board("2026-08-01"), board("2026-08-09"), board("2026-08-05")],
      new Date("2026-08-09T00:00:00.000Z"),
    );
    expect(status.kind).toBe("fresh");
    expect(status.kind === "fresh" && status.newest.date).toBe("2026-08-09");
  });
});
