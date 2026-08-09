import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The mechanism diagram (DESIGN-DIRECTION.md), inlined rather than loaded via
 * `<img>`: an inlined `<svg>` exposes its own `<title>`/`<desc>` to assistive
 * tech as the element's accessible name/description directly — an `<img
 * alt="...">` would only carry a flat string, losing the structured
 * title/desc the generator writes (scripts/diagram.mjs). The file itself
 * stays the committed, CI-drift-checked artifact (`pnpm ci:diagram-check`);
 * this component only reads and inlines those exact bytes at build time — it
 * does not regenerate or alter them, so a rendered page can never show a
 * diagram that disagrees with the file a visitor can also open directly at
 * /diagram/tier-ladder.svg.
 */
export function TierLadderDiagram() {
  // Our own build-time, CI-drift-checked file — not user input.
  const svg = readFileSync(join(process.cwd(), "public/diagram/tier-ladder.svg"), "utf8");
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}
