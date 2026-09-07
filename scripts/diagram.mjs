/**
 * Mechanism diagram — the four diff tiers, drawn as a ladder
 * (DESIGN-DIRECTION.md's table: "the four diff tiers as a ladder (breaking /
 * risky / compatible / cosmetic) with an example rule on each rung, amber on
 * `risky` since that tier is the contrarian call").
 *
 * Same house line language as scripts/brand.mjs: PAPER/INK/AMBER/RULE from
 * agentjames/docs/DESIGN.md (do not invent colours), ink strokes, 0-2px
 * radius, no gradients, no glow, exactly ONE amber element. Deterministic by
 * construction: no Math.random, no webfont, no network, no date stamping —
 * same input, same bytes, forever, so CI can diff the output and fail on
 * drift (`pnpm ci:diagram-check`, next to `ci:brand-check`).
 *
 * The example rule on each rung is not invented: it is looked up, by id, in
 * the BUILT diff-rule registry (`pnpm build` first, same convention as
 * `scripts/generate-rules.mjs`) — the single source docs/RULES.md is also
 * generated from. All four ids below are the exact findings the drift-breaking@v2
 * fixture pair produces against clean@v1 (packages/fixtures/src/drift.ts) —
 * the same pair the hero diff and the demo recording show, so the diagram's
 * examples are the same diff a visitor already saw, not a different one.
 *
 * Usage: node scripts/diagram.mjs
 * (the `diagram` npm script runs `pnpm --filter snapgauge build` first)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RULES } from "../packages/snapgauge/dist/core/diff/rules.js";

// 2026-09-07: same four ROLES, resolved against the substrate's dusk
// lighting instead of cream paper (apps/web/app/globals.css). PAPER is the
// diagram's own ground and must match the panel it is inlined into; INK is
// every rail and label; AMBER stays the one signal colour; RULE is the
// hairline. These are the sRGB resolutions of that file's --color-surface /
// --color-ink / --color-amber / --color-rule tokens.
const PAPER = "#0F1419";
const INK = "#F0F2F4";
const AMBER = "#F7A745";
const RULE = "#2C3035";

const SANS =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = new URL("../apps/web/public/diagram/", import.meta.url);
const OUT_PATH = new URL("tier-ladder.svg", OUT_DIR);

/**
 * The one example per rung — every id fires in the SAME clean@v1 ->
 * drift-breaking@v2 diff the hero and the demo recording show (verified
 * against packages/fixtures/src/drift.ts's plants).
 */
const RUNGS = [
  { tier: "breaking", id: "tool.removed" },
  { tier: "risky", id: "tool.description.changed" },
  { tier: "compatible", id: "tool.input.optional.added" },
  { tier: "cosmetic", id: "tool.icons.changed" },
];

function ruleById(id) {
  const rule = RULES.find((r) => r.id === id);
  if (rule === undefined) {
    throw new Error(`diagram.mjs: rule id "${id}" is not in the built registry — did the id change?`);
  }
  return rule;
}

function esc(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Split a one-sentence summary on its first em dash, for a clean two-line
 * wrap inside the fixed-width label column — no runtime text measurement,
 * so the split point has to be a real character already in the string. */
function twoLines(summary) {
  const dashIndex = summary.indexOf("—");
  if (dashIndex === -1) return [summary];
  return [summary.slice(0, dashIndex).trimEnd(), summary.slice(dashIndex).trimStart()];
}

const WIDTH = 720;
const RAIL_X0 = 56;
const RAIL_X1 = 92;
const RUNG_Y = [76, 172, 268, 364];
const TOP = 40;
const BOTTOM = 400;
const LABEL_X = 124;
const HEIGHT = 440;

function rung({ tier, id }, y, isAmber) {
  const rule = ruleById(id);
  const color = isAmber ? AMBER : INK;
  const lines = twoLines(rule.summary);
  const parts = [
    // the rung itself: a solid bar between the two rails
    `<rect x="${RAIL_X0}" y="${(y - 4).toFixed(1)}" width="${RAIL_X1 - RAIL_X0}" height="8" fill="${color}"/>`,
    // tick where the rung meets each rail
    `<rect x="${RAIL_X0 - 3}" y="${(y - 6).toFixed(1)}" width="6" height="12" fill="${color}"/>`,
    `<rect x="${RAIL_X1 - 3}" y="${(y - 6).toFixed(1)}" width="6" height="12" fill="${color}"/>`,
    // label block, flowing downward from just below the rung: tier name,
    // then the rule id, then its one-line meaning (wrapped at most once)
    `<text x="${LABEL_X}" y="${(y + 6).toFixed(1)}" font-family="${SANS}" font-size="20" font-weight="600" fill="${color}">${esc(tier)}</text>`,
    `<text x="${LABEL_X}" y="${(y + 28).toFixed(1)}" font-family="${MONO}" font-size="14" fill="${INK}">${esc(rule.id)}</text>`,
  ];
  lines.forEach((line, i) => {
    parts.push(
      `<text x="${LABEL_X}" y="${(y + 46 + i * 17).toFixed(1)}" font-family="${SANS}" font-size="13" fill="${INK}CC">${esc(line)}</text>`,
    );
  });
  return parts.join("");
}

function build() {
  const inner = [];

  // two rails, full height
  inner.push(`<path d="M${RAIL_X0} ${TOP} V${BOTTOM}" fill="none" stroke="${INK}" stroke-width="4"/>`);
  inner.push(`<path d="M${RAIL_X1} ${TOP} V${BOTTOM}" fill="none" stroke="${INK}" stroke-width="4"/>`);

  // the default gate: a hairline across the ladder between risky and
  // compatible — real information (SPEC §5 default failOn: "risky"), not
  // decoration; drawn BEFORE the rungs so it sits behind them.
  const gateY = (RUNG_Y[1] + RUNG_Y[2]) / 2;
  inner.push(
    `<path d="M${RAIL_X0 - 20} ${gateY} H${WIDTH - 40}" stroke="${RULE}" stroke-width="2" stroke-dasharray="4 4"/>`,
    `<text x="${WIDTH - 40}" y="${(gateY - 8).toFixed(1)}" font-family="${SANS}" font-size="12" fill="${INK}99" text-anchor="end">default gate — fail-on: risky</text>`,
    `<text x="${WIDTH - 40}" y="${(gateY + 18).toFixed(1)}" font-family="${SANS}" font-size="12" fill="${INK}99" text-anchor="end">above: fails CI · below: passes</text>`,
  );

  RUNGS.forEach((r, i) => {
    inner.push(rung(r, RUNG_Y[i], r.tier === "risky"));
  });

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="dgTitle dgDesc">`,
    `<title id="dgTitle">The four diff tiers, as a ladder</title>`,
    `<desc id="dgDesc">A ladder with four rungs, breaking at top through cosmetic at bottom. ` +
      `Each rung names one real rule id from the registry: breaking carries tool.removed, ` +
      `risky carries tool.description.changed, compatible carries tool.input.optional.added, ` +
      `cosmetic carries tool.icons.changed. All four are findings from the same clean@v1 versus ` +
      `drift-breaking@v2 fixture diff shown elsewhere on this page. The risky rung is the only ` +
      `amber rung: description and title text is the surface a model routes on, so a description ` +
      `change is classified risky, not cosmetic. A dashed line between the risky and compatible ` +
      `rungs marks the default CI gate — breaking and risky fail the build, compatible and cosmetic ` +
      `pass it.</desc>`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>`,
    inner.join(""),
    `</svg>`,
  ].join("\n");
  return `${svg}\n`;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const svg = build();
  const outFile = fileURLToPath(OUT_PATH);
  writeFileSync(outFile, svg);
  console.log(`diagram: wrote ${outFile.slice(REPO_ROOT.length)}`);
}

main();
