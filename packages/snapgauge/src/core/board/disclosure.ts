/**
 * The binding disclosure policy (SPEC §8), enforced in code: "For any
 * MUST-level violation, an upstream issue is filed first and the row
 * records `reportedAt`; publication follows ≥7 days later (`publishedAt`)."
 *
 * `isPublishable` is the pure predicate; `buildBoardRow` is the one place
 * that is allowed to attach a run's `assertions`/`findings` to a `BoardRow`
 * — it calls the predicate itself and REDACTS those fields (plus `era` /
 * `supportedVersions`, kept alongside them rather than partially disclosed)
 * whenever it says no, so a row that fails the policy structurally cannot
 * carry the violation detail it has not cleared disclosure for yet. Nothing
 * downstream (the board runner, the weekly job, `/board`) has another path
 * to attach findings to a row.
 */
import type { AssertionReport } from "../assertions.js";
import type { CompatFinding, Era } from "../compat/engine.js";
import { type BoardRow, type BoardRowStatus } from "./schema.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface DisclosureInput {
  mustViolationCount: number;
  reportedAt?: string | undefined;
  publishedAt?: string | undefined;
}

/**
 * A row with zero MUST-level violations has nothing to disclose and is
 * always publishable. Otherwise BOTH dates must be set and the gap between
 * them must be at least 7 days — boundary is INCLUSIVE ("≥7 days later"):
 * exactly 7 days after `reportedAt` is already publishable.
 */
export function isPublishable(input: DisclosureInput): boolean {
  if (input.mustViolationCount <= 0) return true;
  if (input.reportedAt === undefined || input.publishedAt === undefined) return false;
  const reported = Date.parse(input.reportedAt);
  const published = Date.parse(input.publishedAt);
  if (Number.isNaN(reported) || Number.isNaN(published)) return false;
  return published - reported >= SEVEN_DAYS_MS;
}

/** A MUST-level violation is either a failed MUST-level T-group assertion
 * or a `violation`-class D/X-group finding — the two shapes the board's
 * read-only surface can produce (SPEC §5/§8). SHOULD-level warnings and
 * `risky`/`info`-class findings never gate disclosure. */
export function mustViolationCountOf(input: {
  assertions?: readonly AssertionReport[] | undefined;
  findings?: readonly CompatFinding[] | undefined;
}): number {
  const assertionFails = (input.assertions ?? []).filter(
    (a) => a.level === "MUST" && a.verdict === "fail",
  ).length;
  const findingViolations = (input.findings ?? []).filter((f) => f.class === "violation").length;
  return assertionFails + findingViolations;
}

export interface BuildBoardRowInput {
  server: string;
  url: string;
  checkedAt: string;
  command: string;
  resultUrl: string;
  status: BoardRowStatus;
  statusDetail?: string | undefined;
  era?: Era | undefined;
  supportedVersions?: readonly string[] | undefined;
  assertions?: readonly AssertionReport[] | undefined;
  findings?: readonly CompatFinding[] | undefined;
  reportedAt?: string | undefined;
  publishedAt?: string | undefined;
}

/**
 * Assemble a `BoardRow` from a run's raw ingredients, applying the
 * disclosure policy. `mustViolationCount` and `publishable` are ALWAYS
 * present (the git history records that a check happened and how many
 * MUST-level items are outstanding); `era`/`supportedVersions`/
 * `assertions`/`findings` are omitted entirely — not merely emptied — when
 * `publishable` is false, so a row never carries a MUST-level violation's
 * specifics before its embargo clears.
 */
export function buildBoardRow(input: BuildBoardRowInput): BoardRow {
  const mustViolationCount = mustViolationCountOf(input);
  const publishable = isPublishable({
    mustViolationCount,
    reportedAt: input.reportedAt,
    publishedAt: input.publishedAt,
  });

  const row: BoardRow = {
    server: input.server,
    url: input.url,
    checkedAt: input.checkedAt,
    command: input.command,
    resultUrl: input.resultUrl,
    status: input.status,
    mustViolationCount,
    publishable,
    ...(input.statusDetail !== undefined ? { statusDetail: input.statusDetail } : {}),
    ...(input.reportedAt !== undefined ? { reportedAt: input.reportedAt } : {}),
    ...(input.publishedAt !== undefined ? { publishedAt: input.publishedAt } : {}),
  };
  if (!publishable) return row;
  return {
    ...row,
    ...(input.era !== undefined ? { era: input.era } : {}),
    ...(input.supportedVersions !== undefined ? { supportedVersions: [...input.supportedVersions] } : {}),
    ...(input.assertions !== undefined ? { assertions: [...input.assertions] } : {}),
    ...(input.findings !== undefined ? { findings: [...input.findings] } : {}),
  };
}
