/**
 * The board's data model (SPEC §8/§10 M6): `boards/roster.json` (the target
 * list — James's go/no-go, SPEC §11 Q1) and `boards/<YYYY-MM-DD>.json` (a
 * committed, dated run). Both are Zod-parsed at every boundary — the roster
 * before a target is ever probed, a board file before `/board` renders it
 * (SPEC §9 feasibility item 1).
 *
 * The roster schema is deliberately NARROWER than a full `TargetConfig`
 * (config.ts): no `headers` (the board is unauthenticated-only, SPEC §8 —
 * there is structurally nowhere to put a credential) and no `probes` (the
 * board never calls `tools/call` on a third-party server, SPEC §1/§8 — there
 * is structurally nothing to declare). Both constraints are enforced by the
 * TYPE, not merely by runner discipline.
 */
import { z } from "zod";
import { AssertionReportSchema } from "../assertions.js";
import { CompatFindingSchema, ERAS } from "../compat/engine.js";
import { Iso8601Schema } from "../snapshot/schema.js";

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** One roster entry. `reportedAt`/`publishedAt` are hand-maintained by the
 * disclosure workflow (SPEC §8 binding policy) — set by whoever files the
 * upstream issue, never inferred or guessed by the runner. */
export const RosterTargetSchema = z.strictObject({
  url: z.string().min(1).refine(isHttpsUrl, "must be an https:// URL (SPEC §8: unauthenticated read-only surface only)"),
  protocolVersion: z.string().min(1).optional(),
  notes: z.string().optional(),
  reportedAt: Iso8601Schema.optional(),
  publishedAt: Iso8601Schema.optional(),
});
export type RosterTarget = z.infer<typeof RosterTargetSchema>;

/** `targets` keyed by name — the same name becomes `boards/*.json`'s
 * `row.server` and the CLI target name in the reproduce command. Shipped as
 * `{ "targets": {} }` (SPEC §10 M6 green gate / this build's hard rule: the
 * roster stays empty, no third-party target is probed). */
export const RosterSchema = z.strictObject({
  targets: z.record(z.string().min(1), RosterTargetSchema),
});
export type Roster = z.infer<typeof RosterSchema>;

export const BOARD_ROW_STATUSES = ["ok", "unreachable", "auth_required"] as const;
export type BoardRowStatus = (typeof BOARD_ROW_STATUSES)[number];

/**
 * One row. `assertions`/`findings`/`era`/`supportedVersions` are OPTIONAL —
 * not merely "possibly empty" — because the disclosure-policy validator
 * (core/board/disclosure.ts) omits them entirely on a row that carries an
 * undisclosed MUST-level violation (SPEC §8: "enforced in code, not just
 * prose"). `mustViolationCount` and `publishable` are always present: the
 * git history shows a check happened and how many MUST-level items are
 * pending disclosure, never the specifics, before the embargo clears.
 */
export const BoardRowSchema = z.strictObject({
  server: z.string().min(1),
  url: z.string().min(1),
  checkedAt: Iso8601Schema,
  /** The exact CLI command a third party can run to reproduce this row. */
  command: z.string().min(1),
  /** Link to the raw result — a `boards/<date>.json` blob URL + row anchor. */
  resultUrl: z.string().min(1),
  status: z.enum(BOARD_ROW_STATUSES),
  /** Present for unreachable/auth_required — the OBSERVED reason, never a guess (SPEC §8). */
  statusDetail: z.string().optional(),
  era: z.enum(ERAS).optional(),
  supportedVersions: z.array(z.string()).optional(),
  mustViolationCount: z.number().int().nonnegative(),
  reportedAt: Iso8601Schema.optional(),
  publishedAt: Iso8601Schema.optional(),
  publishable: z.boolean(),
  /** T-group assertion reports (board-safe subset — SPEC §8). Redacted until `publishable`. */
  assertions: z.array(AssertionReportSchema).optional(),
  /** X-group + D-group findings reachable without `tools/call` (SPEC §8). Redacted until `publishable`. */
  findings: z.array(CompatFindingSchema).optional(),
});
export type BoardRow = z.infer<typeof BoardRowSchema>;

export const BoardFileSchema = z.strictObject({
  /** YYYY-MM-DD — also the filename stem `boards/<date>.json`. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  generatedAt: Iso8601Schema,
  snapgaugeVersion: z.string(),
  rows: z.array(BoardRowSchema),
});
export type BoardFile = z.infer<typeof BoardFileSchema>;
