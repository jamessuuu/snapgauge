// Generate docs/RULES.md from the diff-rule registry (SPEC §10 M3: a
// rule-catalog table generated from the registry — single source, no
// drift). Imports the BUILT registry, so run `pnpm build` first (the
// `docs:rules` script does). A unit test fails when docs/RULES.md drifts
// from the registry, so forgetting to regenerate cannot land.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderRulesDoc } from "../packages/snapgauge/dist/core/diff/rules.js";

const out = fileURLToPath(new URL("../docs/RULES.md", import.meta.url));
writeFileSync(out, renderRulesDoc(), "utf8");
console.log(`wrote ${out}`);
