// Generate docs/RULES.md from the diff-rule registry (SPEC §10 M3: a
// rule-catalog table generated from the registry — single source, no
// drift). Imports the BUILT registry, so run `pnpm build` first (the
// `docs:rules` script does). A unit test fails when docs/RULES.md drifts
// from the registry, so forgetting to regenerate cannot land.
//
// Also emits apps/web/src/generated/rules-catalog.ts: the same tier tables
// as plain data, for the /docs page to render without the Next app ever
// deep-importing the package's internal (non-exported) RULES array itself —
// apps/web only ever imports "snapgauge"'s public surface. CI drift-checks
// this file the same way (`pnpm ci:docs-check`), so the rendered docs page
// can never quietly drift from the registry either.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RULES, renderRulesDoc } from "../packages/snapgauge/dist/core/diff/rules.js";

const TIER_ORDER = ["breaking", "risky", "compatible", "cosmetic"];

const docPath = fileURLToPath(new URL("../docs/RULES.md", import.meta.url));
writeFileSync(docPath, renderRulesDoc(), "utf8");
console.log(`wrote ${docPath}`);

const catalogPath = fileURLToPath(
  new URL("../apps/web/src/generated/rules-catalog.ts", import.meta.url),
);
const byTier = Object.fromEntries(
  TIER_ORDER.map((tier) => [
    tier,
    RULES.filter((rule) => rule.tier === tier)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((rule) => ({ id: rule.id, summary: rule.summary })),
  ]),
);
const catalogSource = `/**
 * GENERATED — do not edit by hand. Source: packages/snapgauge/src/core/diff/rules.ts.
 * Regenerate: \`pnpm docs:rules\` (also rewrites docs/RULES.md from the same
 * registry). CI fails on drift: \`pnpm ci:docs-check\`.
 *
 * The full four-tier diff-rule catalog as plain data, so the /docs page can
 * render it without importing anything from "snapgauge" beyond its public
 * "." export — this file, not a deep import of package internals, is the
 * boundary apps/web crosses to show the real registry.
 */
export interface CatalogRule {
  readonly id: string;
  readonly summary: string;
}

export const RULE_CATALOG: Readonly<Record<"breaking" | "risky" | "compatible" | "cosmetic", readonly CatalogRule[]>> = ${JSON.stringify(byTier, null, 2)} as const;
`;
mkdirSync(fileURLToPath(new URL("../apps/web/src/generated/", import.meta.url)), { recursive: true });
writeFileSync(catalogPath, catalogSource, "utf8");
console.log(`wrote ${catalogPath}`);
