/**
 * Turns a committed board row into neutral, displayable text (SPEC §8:
 * "Findings are stated as neutral observations... never as scores, grades,
 * or security claims"). `parseBoardRow` upgrades a loosely-typed row (the
 * shape `board-loader.ts` reads off disk without rejecting a malformed file
 * outright, SPEC §6) to the real `BoardRowSchema` when it validates;
 * `/board` renders the rich columns below only for rows that do, and falls
 * back to a plain, generic render for anything else — never a crash.
 */
import { BoardRowSchema, type BoardRow } from "snapgauge";

export function parseBoardRow(row: unknown): BoardRow | undefined {
  const parsed = BoardRowSchema.safeParse(row);
  return parsed.success ? parsed.data : undefined;
}

/** What happened when the row's target was checked — a fact, not a verdict. */
export function statusLabel(row: BoardRow): string {
  switch (row.status) {
    case "ok":
      return row.era !== undefined ? `checked — era: ${row.era}` : "checked";
    case "unreachable":
      return "not tested (unreachable)";
    case "auth_required":
      return "not tested (auth required)";
  }
}

/** The disclosure-policy state of a row (SPEC §8), stated plainly: how many
 * MUST-level findings exist and whether they have cleared the embargo —
 * never framed as a score or a pass/fail grade on the server. */
export function disclosureLabel(row: BoardRow): string {
  if (row.mustViolationCount === 0) return "no MUST-level findings";
  if (row.publishable) {
    return `${String(row.mustViolationCount)} MUST-level finding(s) — reported ${row.reportedAt ?? "?"}, published ${row.publishedAt ?? "?"}`;
  }
  return `${String(row.mustViolationCount)} MUST-level finding(s) pending disclosure (SPEC §8: ≥7 days after the upstream report)`;
}

/** One T-group assertion, rendered as the observation it is — the engine's
 * own `detail` string is already a factual statement ("GET returned 405"),
 * never a grade; this just prefixes it with the assertion id for context. */
export function assertionObservation(assertion: { id: string; verdict: string; detail: string }): string {
  return `${assertion.id} [${assertion.verdict}]: ${assertion.detail}`;
}

/** One X/D-group finding, rendered the same way. */
export function findingObservation(finding: { ruleId: string; subject: string; message: string }): string {
  return `${finding.ruleId} (${finding.subject}): ${finding.message}`;
}

export function supportedVersionsLabel(row: BoardRow): string {
  if (row.supportedVersions === undefined || row.supportedVersions.length === 0) return "—";
  return row.supportedVersions.join(", ");
}
