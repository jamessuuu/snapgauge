/**
 * The landing page's hero evidence (DESIGN-DIRECTION.md: "one piece of
 * evidence rendered at size... snapgauge's is a real diff"). Runs the SAME
 * engine + fixtures the offline demo runs (`runDemoPair`,
 * src/lib/demo-engine.ts) at build time, inside `/`'s server component — `/`
 * stays static (SPEC §4: must render with every Vercel function paused), so
 * this executes once during `next build`, not per request.
 *
 * clean@v1 -> drift-breaking@v2 is the same pair the demo recording and the
 * mechanism diagram both use (packages/fixtures/src/drift.ts), so the finding
 * shown here is not a different claim from the rest of the page — it is the
 * SAME diff, looked at from three angles.
 */
import { runDemoPair } from "./demo-engine.js";
import type { ExitCode, Finding, Tier } from "snapgauge";

export const HERO_PAIR_LABEL = "clean@v1 → drift-breaking@v2";
const HERO_PAIR_ID = "drift-breaking@v2";
/** tool.removed: the plainest breaking finding in the pair — a tool present
 * in the old contract is gone (packages/fixtures/src/drift.ts's `removeTool`
 * plant), no schema literacy required to understand it at a glance. */
const HEADLINE_RULE_ID = "tool.removed";

export interface HeroDiff {
  pairLabel: string;
  headline: Finding;
  otherFindings: readonly Finding[];
  totalFindings: number;
  summary: Record<Tier, number>;
  gateFailOn: Tier;
  gateFailed: boolean;
  exitCode: ExitCode;
}

export async function computeHeroDiff(): Promise<HeroDiff> {
  const result = await runDemoPair(HERO_PAIR_ID);
  if (!result.ok || result.findings === undefined || result.summary === undefined || result.gate === undefined) {
    throw new Error(
      `hero-diff: runDemoPair("${HERO_PAIR_ID}") did not produce findings — ${
        result.error !== undefined ? `${result.error.code}: ${result.error.message}` : "unknown failure"
      }`,
    );
  }
  const headline = result.findings.find((finding) => finding.ruleId === HEADLINE_RULE_ID);
  if (headline === undefined) {
    // Fails the build rather than rendering an invented example — the hero
    // may only ever show a finding the real engine actually produced.
    throw new Error(`hero-diff: expected a "${HEADLINE_RULE_ID}" finding in ${HERO_PAIR_ID}; none was produced`);
  }
  return {
    pairLabel: HERO_PAIR_LABEL,
    headline,
    otherFindings: result.findings.filter((finding) => finding !== headline),
    totalFindings: result.findings.length,
    summary: result.summary,
    gateFailOn: result.gate.failOn,
    gateFailed: result.gate.failed,
    exitCode: result.exitCode,
  };
}
