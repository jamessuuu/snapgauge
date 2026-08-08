"use client";

import type { Finding, Tier } from "snapgauge";

const TIER_LABEL: Record<Tier, string> = {
  breaking: "breaking",
  risky: "risky",
  compatible: "compatible",
  cosmetic: "cosmetic",
};

/** Tier -> a text treatment, not a traffic-light color system (BRAND-KIT:
 * one signal color total — amber marks the tier at/above the gate). */
function tierClass(tier: Tier, gateFailOn: Tier | undefined, tierRank: (t: Tier) => number): string {
  const emphasized = gateFailOn !== undefined && tierRank(tier) >= tierRank(gateFailOn);
  if (emphasized) return "text-amber font-semibold";
  return "text-ink/70";
}

const TIER_RANK: Record<Tier, number> = { cosmetic: 0, compatible: 1, risky: 2, breaking: 3 };
const rank = (t: Tier): number => TIER_RANK[t];

export function FindingsTable({
  findings,
  gateFailOn,
}: {
  findings: readonly Finding[];
  gateFailOn?: Tier | undefined;
}) {
  if (findings.length === 0) {
    return (
      <p className="border border-rule px-4 py-3 text-sm text-ink/70">
        No drift: the two snapshots are equivalent.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto border border-rule">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule bg-ink/[0.03] text-left">
            <th className="px-3 py-2 font-semibold">tier</th>
            <th className="px-3 py-2 font-semibold">rule</th>
            <th className="px-3 py-2 font-semibold">subject</th>
            <th className="px-3 py-2 font-semibold">message</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding, index) => (
            <tr
              key={`${finding.ruleId}-${finding.subject}-${String(index)}`}
              className="border-b border-rule last:border-b-0 align-top"
            >
              <td className={`px-3 py-2 whitespace-nowrap ${tierClass(finding.tier, gateFailOn, rank)}`}>
                {TIER_LABEL[finding.tier]}
              </td>
              <td className="px-3 py-2 font-mono whitespace-nowrap">{finding.ruleId}</td>
              <td className="px-3 py-2 font-mono whitespace-nowrap">{finding.subject}</td>
              <td className="px-3 py-2">{finding.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
