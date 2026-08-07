/**
 * Reporters (SPEC §4/§5): pure renderers from a Result object to lines of
 * text. The same Result the CLI prints is what `snapgauge report` reformats
 * and what `/api/check` returns at M5 — one shape, many renderings.
 *
 * Formats: `text` (humans), `json` (machines; Zod-parseable), `github`
 * (workflow annotations + summary), `md` (markdown table).
 */
import { z } from "zod";
import { AssertionReportSchema, type AssertionReport } from "../assertions.js";
import { FindingSchema, TIERS, type Finding, type Tier } from "../diff/diff.js";
import { SnapgaugeError } from "../errors.js";

export const REPORT_FORMATS = ["text", "json", "github", "md"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export function parseReportFormat(value: string): ReportFormat {
  const match = REPORT_FORMATS.find((f) => f === value);
  if (match === undefined) {
    throw new SnapgaugeError(
      "USAGE",
      `unknown report format "${value}" (expected ${REPORT_FORMATS.join("|")})`,
    );
  }
  return match;
}

const SummarySchema = z.strictObject({
  breaking: z.number().int().nonnegative(),
  risky: z.number().int().nonnegative(),
  compatible: z.number().int().nonnegative(),
  cosmetic: z.number().int().nonnegative(),
});

/**
 * The Result shape `check` emits (and `report` re-parses). `diff`'s leaner
 * DiffOutput is upgraded into this shape by `fromDiffOutput`.
 */
export const CheckOutputSchema = z.strictObject({
  command: z.enum(["check", "diff", "compat"]),
  target: z
    .strictObject({
      name: z.string(),
      transport: z.enum(["http", "stdio", "fixture"]),
    })
    .optional(),
  findings: z.array(FindingSchema),
  summary: SummarySchema,
  gate: z.strictObject({ failOn: z.enum(TIERS), failed: z.boolean() }),
  assertions: z.array(AssertionReportSchema).optional(),
  /** SPEC §6: missing evidence — the gate treats this as not passing (exit 2). */
  incomplete: z.boolean().optional(),
  updated: z.boolean().optional(),
  exitCode: z.number().int().nonnegative(),
});
export type CheckOutput = z.infer<typeof CheckOutputSchema>;

export function summarize(findings: readonly Finding[]): Record<Tier, number> {
  const summary: Record<Tier, number> = { breaking: 0, risky: 0, compatible: 0, cosmetic: 0 };
  for (const finding of findings) summary[finding.tier] += 1;
  return summary;
}

export function render(output: CheckOutput, format: ReportFormat): string[] {
  switch (format) {
    case "json":
      return [JSON.stringify(output, null, 2)];
    case "text":
      return renderText(output);
    case "github":
      return renderGithub(output);
    case "md":
      return renderMarkdown(output);
  }
}

function findingLine(finding: Finding): string {
  return `${finding.tier.padEnd(10)} ${finding.ruleId.padEnd(34)} ${finding.subject} — ${finding.message}`;
}

function renderText(output: CheckOutput): string[] {
  const lines: string[] = [];
  if (output.target !== undefined) {
    lines.push(`target ${output.target.name} (${output.target.transport})`);
  }
  if (output.findings.length === 0) {
    lines.push("no drift: snapshots are equivalent (recordedAt is metadata and excluded — SPEC §2)");
  } else {
    for (const finding of output.findings) lines.push(findingLine(finding));
  }
  if (output.assertions !== undefined && output.assertions.length > 0) {
    lines.push("transport assertions:");
    for (const assertion of output.assertions) {
      lines.push(
        `  ${assertion.verdict.padEnd(8)} ${assertion.id.padEnd(42)} ${assertion.detail}`,
      );
    }
  }
  const { summary } = output;
  const counts = `${String(summary.breaking)} breaking, ${String(summary.risky)} risky, ${String(summary.compatible)} compatible, ${String(summary.cosmetic)} cosmetic`;
  const verdict = describeExit(output);
  lines.push(
    `${String(output.findings.length)} findings (${counts}); gate fail-on=${output.gate.failOn} -> ${verdict}`,
  );
  if (output.incomplete === true) {
    lines.push(
      "INCOMPLETE: at least one probe produced no evidence — treated as not passing, never as \"no change\" (SPEC §6)",
    );
  }
  if (output.updated === true) {
    lines.push("snapshot updated (--update)");
  }
  return lines;
}

function describeExit(output: CheckOutput): string {
  if (output.incomplete === true) return "incomplete evidence (exit 2)";
  if (output.exitCode === 3) return "COMPAT VIOLATION (exit 3)";
  if (output.gate.failed) return "DRIFT (exit 1)";
  return "below the gate (exit 0)";
}

/** GitHub Actions annotation escaping (property/message rules differ). */
function ghMessage(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function ghProperty(text: string): string {
  return ghMessage(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function renderGithub(output: CheckOutput): string[] {
  const lines: string[] = [];
  for (const finding of output.findings) {
    const kind = finding.tier === "breaking" ? "error" : finding.tier === "risky" ? "warning" : "notice";
    lines.push(
      `::${kind} title=${ghProperty(`${finding.tier}: ${finding.ruleId}`)}::${ghMessage(`${finding.subject} — ${finding.message}`)}`,
    );
  }
  for (const assertion of output.assertions ?? []) {
    if (assertion.verdict === "fail") {
      lines.push(
        `::error title=${ghProperty(assertion.id)}::${ghMessage(`${assertion.detail} (${assertion.cite})`)}`,
      );
    } else if (assertion.verdict === "warn") {
      lines.push(
        `::warning title=${ghProperty(assertion.id)}::${ghMessage(`${assertion.detail} (${assertion.cite})`)}`,
      );
    }
  }
  // Human-readable tail — visible in the raw log under the annotations.
  lines.push(...renderText(output));
  return lines;
}

function renderMarkdown(output: CheckOutput): string[] {
  const lines: string[] = [];
  const title = output.target !== undefined ? ` — ${output.target.name}` : "";
  lines.push(`## snapgauge ${output.command}${title}`);
  lines.push("");
  if (output.findings.length === 0) {
    lines.push("No drift: snapshots are equivalent.");
  } else {
    lines.push("| tier | rule | subject | message |");
    lines.push("|---|---|---|---|");
    for (const finding of output.findings) {
      lines.push(
        `| ${finding.tier} | \`${finding.ruleId}\` | \`${finding.subject}\` | ${mdEscape(finding.message)} |`,
      );
    }
  }
  if (output.assertions !== undefined && output.assertions.length > 0) {
    lines.push("");
    lines.push("| assertion | level | verdict | detail |");
    lines.push("|---|---|---|---|");
    for (const assertion of output.assertions) {
      lines.push(
        `| \`${assertion.id}\` | ${assertion.level} | ${assertion.verdict} | ${mdEscape(assertion.detail)} |`,
      );
    }
  }
  lines.push("");
  lines.push(
    `Gate \`fail-on=${output.gate.failOn}\` -> **${describeExit(output)}**${output.incomplete === true ? " (incomplete evidence)" : ""}`,
  );
  return lines;
}

function mdEscape(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export type { AssertionReport };
