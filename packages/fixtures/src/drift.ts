/**
 * Drift fixtures (SPEC §7), derived from clean@v1 so every difference is a
 * deliberate PLANT. The golden eval cases assert the EXACT finding set by
 * set equality — an accidental extra difference here fails the eval, which
 * is the point.
 */
import { buildCleanProbes, buildCleanSurface } from "./clean.ts";
import { makeEntry, mustFind, removeTool, type SurfaceDef } from "./server.ts";

/**
 * drift-breaking@v2 — one plant per M1 rule, spanning all four tiers:
 * two breaking, one risky, one compatible, two cosmetic.
 */
function buildDriftBreakingSurface(): SurfaceDef {
  const surface = buildCleanSurface();
  // PLANT: serverInfo.version.changed (cosmetic)
  surface.serverInfo = { name: surface.serverInfo.name, version: "2.0.0" };
  // PLANT: tool.removed (breaking)
  removeTool(surface.tools, "archive_note");

  const weather = mustFind(surface.tools, "get_weather");
  // PLANT: tool.description.changed (risky — trigger surface, SPEC §5)
  weather.description = "Weather conditions for a location and date.";
  // PLANT: tool.input.required.added (breaking) — new "date" property, required
  weather.inputSchema.properties.date = {
    type: "string",
    description: "ISO date (YYYY-MM-DD)",
  };
  weather.inputSchema.required = ["location", "date"];
  // PLANT: tool.icons.changed (cosmetic)
  weather.icons = [{ src: "icons/weather-v2.svg", mimeType: "image/svg+xml", sizes: ["64x64"] }];

  // PLANT: tool.input.optional.added (compatible) — "cursor", not required
  mustFind(surface.tools, "list_notes").inputSchema.properties.cursor = { type: "string" };

  return surface;
}

/** drift-cosmetic@v2 — cosmetic-tier plants ONLY; must exit 0 at the default gate. */
function buildDriftCosmeticSurface(): SurfaceDef {
  const surface = buildCleanSurface();
  // PLANT: serverInfo.version.changed (cosmetic)
  surface.serverInfo = { name: surface.serverInfo.name, version: "1.0.1" };
  // PLANT: tool.icons.changed (cosmetic) — an extra icon size
  mustFind(surface.tools, "get_weather").icons = [
    { src: "icons/weather.svg", mimeType: "image/svg+xml", sizes: ["64x64", "128x128"] },
  ];
  return surface;
}

export const driftBreakingV2 = makeEntry(buildDriftBreakingSurface(), buildCleanProbes());
export const driftCosmeticV2 = makeEntry(buildDriftCosmeticSurface(), buildCleanProbes());
