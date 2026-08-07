/**
 * @snapgauge/fixtures — pure (request, profile) => response MCP fixture
 * servers (SPEC §7). PRIVATE: never published; consumed by the eval set,
 * the CLI's fixture transport (in-repo), and — at M5 — the offline demo.
 *
 * M2 roster: clean@v1, clean@v2-identical, drift-breaking@v2 plus
 * drift-cosmetic@v2 (the cosmetic-only golden case needs a cosmetic-only
 * pair; it is part of the SPEC §7 roster). The remaining §7 fixtures
 * (drift-steering, degraders, nonconformant-legacy, flaky-order, paginated,
 * bad-x-mcp-header) land at M3/M4 with the rules that consume them.
 */
import type { FixtureServer, ProbeDecl } from "snapgauge";
import { cleanV1, cleanV2Identical } from "./clean.ts";
import { driftBreakingV2, driftCosmeticV2 } from "./drift.ts";
import type { FixtureEntry } from "./server.ts";

const REGISTRY: Readonly<Record<string, FixtureEntry>> = {
  "clean@v1": cleanV1,
  "clean@v2-identical": cleanV2Identical,
  "drift-breaking@v2": driftBreakingV2,
  "drift-cosmetic@v2": driftCosmeticV2,
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
