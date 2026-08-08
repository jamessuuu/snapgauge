/**
 * @snapgauge/fixtures — pure (request, profile) => response MCP fixture
 * servers (SPEC §7). PRIVATE: never published; consumed by the eval set,
 * the CLI's fixture transport (in-repo), and — at M5 — the offline demo.
 *
 * M3 roster: the clean pair, the four M1/M2 drift fixtures, one planted
 * fixture per SPEC §5 rule family, flaky-order (seeded shuffle) and
 * clean@v1-shuffled (wire key order scrambled — the determinism eval's
 * subject).
 *
 * M4 roster (compat engine): the three degraders (honest/silent/liar),
 * nonconformant-legacy, paginated (mismatched cacheScope on page 2),
 * bad-x-mcp-header (seven tools, one violated X-group constraint each) and
 * xhdr-live-bad (the two X-group LIVE checks).
 */
import type { FixtureServer, ProbeDecl } from "snapgauge";
import { cleanV1, cleanV2Identical } from "./clean.ts";
import { driftBreakingV2, driftCosmeticV2 } from "./drift.ts";
import {
  cleanV1Shuffled,
  driftAnnotationsBreakingV2,
  driftAnnotationsRelaxedV2,
  driftCacheV2,
  driftCapsV2,
  driftErrorCodeV2,
  driftInstructionsV2,
  driftMetaV2,
  driftOrderV2,
  driftSchemaV2,
  driftSteeringV2,
  driftXhdrV2,
  flakyOrder,
} from "./drift-m3.ts";
import {
  badXMcpHeader,
  degraderHonest,
  degraderLiar,
  degraderSilent,
  nonconformantLegacy,
  paginated,
  xhdrLiveBad,
} from "./m4.ts";
import type { FixtureEntry } from "./server.ts";

const REGISTRY: Readonly<Record<string, FixtureEntry>> = {
  "bad-x-mcp-header": badXMcpHeader,
  "clean@v1": cleanV1,
  "clean@v1-shuffled": cleanV1Shuffled,
  "clean@v2-identical": cleanV2Identical,
  "degrader-honest": degraderHonest,
  "degrader-liar": degraderLiar,
  "degrader-silent": degraderSilent,
  "drift-annotations-breaking@v2": driftAnnotationsBreakingV2,
  "drift-annotations-relaxed@v2": driftAnnotationsRelaxedV2,
  "drift-breaking@v2": driftBreakingV2,
  "drift-cache@v2": driftCacheV2,
  "drift-caps@v2": driftCapsV2,
  "drift-cosmetic@v2": driftCosmeticV2,
  "drift-error-code@v2": driftErrorCodeV2,
  "drift-instructions@v2": driftInstructionsV2,
  "drift-meta@v2": driftMetaV2,
  "drift-order@v2": driftOrderV2,
  "drift-schema@v2": driftSchemaV2,
  "drift-steering@v2": driftSteeringV2,
  "drift-xhdr@v2": driftXhdrV2,
  "flaky-order": flakyOrder,
  "nonconformant-legacy": nonconformantLegacy,
  "paginated": paginated,
  "xhdr-live-bad": xhdrLiveBad,
};

/** Full entry: server + declared probes + raw framing (SPEC §5 T-group). */
export function getFixtureEntry(name: string): FixtureEntry | undefined {
  return Object.hasOwn(REGISTRY, name) ? REGISTRY[name] : undefined;
}

export function getFixture(name: string): FixtureServer | undefined {
  return getFixtureEntry(name)?.server;
}

export function getFixtureProbes(name: string): ProbeDecl[] | undefined {
  return getFixtureEntry(name)?.probes;
}

export function fixtureNames(): string[] {
  return Object.keys(REGISTRY).sort();
}

export {
  makeEntry,
  makeRawHandler,
  makeServer,
  type FixtureEntry,
  type SurfaceDef,
  type ToolDef,
} from "./server.ts";
