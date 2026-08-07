/**
 * The diff engine + the M1 rule catalog (SPEC §5, §10): six rules spanning
 * all four tiers, direction-aware (old → new). The full taxonomy lands at
 * M3 and bumps RULESET_VERSION.
 *
 * recordedAt, target metadata and snapgaugeVersion are excluded from every
 * diff by construction — no rule reads them (SPEC §2 Decision 2; proven by
 * unit test, not just asserted here).
 */
import { z } from "zod";
import { SnapgaugeError } from "../errors.js";
import { jcsCanonical, JsonValueSchema, type Json } from "../json.js";
import type { SnapshotTool, SnapshotV1 } from "../snapshot/schema.js";

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

type PartialFinding = Omit<Finding, "ruleId" | "tier">;

interface Rule {
  id: string;
  tier: Tier;
  run(a: SnapshotV1, b: SnapshotV1): PartialFinding[];
}

/**
 * M1 rule catalog (SPEC §10: "6 rules"). Tier rationale is SPEC §5's —
 * notably descriptions are risky, NOT cosmetic: description text is the
 * trigger surface a model routes on.
 */
const RULES: readonly Rule[] = [
  {
    id: "tool.removed",
    tier: "breaking",
    run: (a, b) => {
      const after = toolMap(b);
      return a.tools
        .filter((tool) => !after.has(tool.name))
        .map((tool) => ({
          subject: `tools.${tool.name}`,
          message: `tool "${tool.name}" was removed — a client holding the old contract will fail`,
        }));
    },
  },
  {
    id: "tool.input.required.added",
    tier: "breaking",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const oldRequired = requiredNames(oldTool);
        return [...requiredNames(newTool)]
          .filter((name) => !oldRequired.has(name))
          .map((name) => ({
            subject: `tools.${newTool.name}.inputSchema.required.${name}`,
            message: `input "${name}" is now required — a client recorded against the old contract does not send it`,
          }));
      }),
  },
  {
    id: "tool.description.changed",
    tier: "risky",
    run: (a, b) =>
      commonTools(a, b)
        .filter(([oldTool, newTool]) => oldTool.description !== newTool.description)
        .map(([oldTool, newTool]) => ({
          subject: `tools.${newTool.name}.description`,
          message: `description changed — the trigger surface a model routes on (SPEC §5: risky, not cosmetic)`,
          ...(oldTool.description !== undefined ? { before: oldTool.description } : {}),
          ...(newTool.description !== undefined ? { after: newTool.description } : {}),
        })),
  },
  {
    id: "tool.input.optional.added",
    tier: "compatible",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const oldProps = propertyNames(oldTool);
        const newRequired = requiredNames(newTool);
        return [...propertyNames(newTool)]
          .filter((name) => !oldProps.has(name) && !newRequired.has(name))
          .map((name) => ({
            subject: `tools.${newTool.name}.inputSchema.properties.${name}`,
            message: `optional input "${name}" was added`,
          }));
      }),
  },
  {
    id: "tool.icons.changed",
    tier: "cosmetic",
    run: (a, b) =>
      commonTools(a, b)
        .filter(([oldTool, newTool]) => !jsonEqual(oldTool.icons, newTool.icons))
        .map(([, newTool]) => ({
          subject: `tools.${newTool.name}.icons`,
          message: "icons changed",
        })),
  },
  {
    id: "serverInfo.version.changed",
    tier: "cosmetic",
    run: (a, b) => {
      const before = a.discover.serverInfo.version;
      const after = b.discover.serverInfo.version;
      if (before === after) return [];
      return [
        {
          subject: "discover.serverInfo.version",
          message: "serverInfo.version changed",
          before,
          after,
        },
      ];
    },
  },
];

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

function toolMap(snapshot: SnapshotV1): Map<string, SnapshotTool> {
  return new Map(snapshot.tools.map((tool) => [tool.name, tool]));
}

function commonTools(a: SnapshotV1, b: SnapshotV1): [SnapshotTool, SnapshotTool][] {
  const after = toolMap(b);
  const pairs: [SnapshotTool, SnapshotTool][] = [];
  for (const tool of a.tools) {
    const counterpart = after.get(tool.name);
    if (counterpart !== undefined) pairs.push([tool, counterpart]);
  }
  return pairs;
}

function requiredNames(tool: SnapshotTool): ReadonlySet<string> {
  const required = tool.inputSchema.required;
  if (!Array.isArray(required)) return new Set();
  return new Set(required.filter((entry): entry is string => typeof entry === "string"));
}

function propertyNames(tool: SnapshotTool): ReadonlySet<string> {
  const properties = tool.inputSchema.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) {
    return new Set();
  }
  return new Set(Object.keys(properties));
}

function jsonEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return jcsCanonical(a) === jcsCanonical(b);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
