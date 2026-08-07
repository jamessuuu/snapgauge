/**
 * The diff engine (SPEC §5): runs the full rule catalog (rules.ts),
 * direction-aware (old → new), and gates on tier.
 *
 * recordedAt, target metadata and snapgaugeVersion are excluded from every
 * diff by construction — no rule reads them (SPEC §2 Decision 2; proven by
 * unit test, not just asserted here).
 */
import { z } from "zod";
import { SnapgaugeError } from "../errors.js";
import { JsonValueSchema } from "../json.js";
import type { SnapshotV1 } from "../snapshot/schema.js";
import { RULES } from "./rules.js";

/** Ascending severity; index = rank. */
export const TIERS = ["cosmetic", "compatible", "risky", "breaking"] as const;
export type Tier = (typeof TIERS)[number];

export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}

export function parseTier(value: string): Tier {
  const match = TIERS.find((t) => t === value);
  if (match === undefined) {
    throw new SnapgaugeError("USAGE", `unknown tier "${value}" (expected ${TIERS.join("|")})`);
  }
  return match;
}

export const FindingSchema = z.strictObject({
  ruleId: z.string(),
  tier: z.enum(TIERS),
  /** Stable dot-path into the snapshot — (ruleId, subject) identifies a finding for set-equality scoring (SPEC §7). */
  subject: z.string(),
  message: z.string(),
  before: JsonValueSchema.optional(),
  after: JsonValueSchema.optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export interface DiffResult {
  findings: Finding[];
  summary: Record<Tier, number>;
}

/** The shape `snapgauge diff --json` prints; evals Zod-parse stdout with it. */
export const DiffOutputSchema = z.strictObject({
  findings: z.array(FindingSchema),
  summary: z.strictObject({
    breaking: z.number().int().nonnegative(),
    risky: z.number().int().nonnegative(),
    compatible: z.number().int().nonnegative(),
    cosmetic: z.number().int().nonnegative(),
  }),
  gate: z.strictObject({ failOn: z.enum(TIERS), failed: z.boolean() }),
});
export type DiffOutput = z.infer<typeof DiffOutputSchema>;

export function diffSnapshots(a: SnapshotV1, b: SnapshotV1): DiffResult {
  if (a.probeSpecHash !== b.probeSpecHash) {
    throw new SnapgaugeError(
      "SPEC_MISMATCH",
      "probeSpecHash differs between snapshots — the probe spec changed; re-record (SPEC §2 Decision 3: a snapshot is only comparable to itself)",
    );
  }
  const findings: Finding[] = [];
  for (const rule of RULES) {
    for (const partial of rule.run(a, b)) {
      findings.push({ ruleId: rule.id, tier: rule.tier, ...partial });
    }
  }
  findings.sort(
    (x, y) =>
      tierRank(y.tier) - tierRank(x.tier) ||
      compareStrings(x.ruleId, y.ruleId) ||
      compareStrings(x.subject, y.subject),
  );
  const summary: Record<Tier, number> = { breaking: 0, risky: 0, compatible: 0, cosmetic: 0 };
  for (const finding of findings) summary[finding.tier] += 1;
  return { findings, summary };
}

/** True when any finding sits at or above the gate tier (default gate: risky, SPEC §5). */
export function gateFailed(result: DiffResult, failOn: Tier): boolean {
  const minimum = tierRank(failOn);
  return result.findings.some((finding) => tierRank(finding.tier) >= minimum);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
