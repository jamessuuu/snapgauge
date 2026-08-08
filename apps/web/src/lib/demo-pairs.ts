/**
 * The offline demo's fixture pairs (SPEC §4/§10 M5): every pair compares the
 * `clean@v1` baseline against one "next release." Plain data only — no
 * runtime dependency on "snapgauge" or "@snapgauge/fixtures" — so the demo
 * page can render the picker without pulling the engine into the main
 * bundle; the engine only loads inside the Web Worker once a visitor runs a
 * pair.
 */
export const DEMO_BASE_FIXTURE = "clean@v1";

export const DEMO_PAIRS = [
  {
    id: "clean@v2-identical",
    label: "clean@v2-identical",
    blurb: "Same schema, same behavior — the negative case: zero findings, exit 0.",
  },
  {
    id: "drift-breaking@v2",
    label: "drift-breaking@v2",
    blurb: "A tool removed and a required argument added — breaking-tier findings, exit 1.",
  },
  {
    id: "drift-cosmetic@v2",
    label: "drift-cosmetic@v2",
    blurb: "Only a version bump and an icon change — cosmetic tier, still passes the default gate.",
  },
  {
    id: "degrader-liar",
    label: "degrader-liar",
    blurb: "A completely different tool surface — see how an unrelated redeploy reads on this baseline.",
  },
  {
    id: "nonconformant-legacy",
    label: "nonconformant-legacy",
    blurb: "Doesn't implement server/discover at all — watch the probe fail cleanly (exit 2), not silently.",
  },
] as const;

export type DemoPairId = (typeof DEMO_PAIRS)[number]["id"];

export function isDemoPairId(value: string): value is DemoPairId {
  return DEMO_PAIRS.some((pair) => pair.id === value);
}
