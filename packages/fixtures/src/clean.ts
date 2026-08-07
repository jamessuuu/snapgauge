/**
 * clean@v1 and clean@v2-identical (SPEC §7): the baseline surface, and a
 * "new release" whose observable surface is byte-identical — the negative
 * case that proves the diff engine reports zero findings when nothing
 * changed (recordedAt and target metadata are excluded per SPEC §2).
 */
import type { ProbeDecl } from "snapgauge";
import { makeEntry, type SurfaceDef, type ToolDef } from "./server.ts";

/** Fresh mutable copies every call — drift fixtures derive from this. */
export function buildCleanTools(): ToolDef[] {
  return [
    {
      name: "get_weather",
      title: "Get weather",
      description: "Current conditions for a location, by city name.",
      inputSchema: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
          units: { type: "string", enum: ["metric", "imperial"] },
        },
        required: ["location"],
        additionalProperties: false,
      },
      icons: [{ src: "icons/weather.svg", mimeType: "image/svg+xml", sizes: ["64x64"] }],
      call: () => ({
        result: {
          resultType: "complete",
          content: [{ type: "text", text: "Sunny, 22°C" }],
          structuredContent: { location: "Seattle", tempC: 22, conditions: "sunny" },
        },
      }),
    },
    {
      name: "archive_note",
      description: "Move a note to the archive. The note stays readable at its archive URI.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Note id" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { idempotentHint: true },
    },
    {
      name: "list_notes",
      description: "List notes, newest first.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
  ];
}

export function buildCleanSurface(): SurfaceDef {
  return {
    serverInfo: { name: "clean-fixture", version: "1.0.0" },
    supportedVersions: ["2026-07-28"],
    capabilities: { tools: { listChanged: false } },
    instructions: "Notes demo server. Weather is stubbed; archiving is reversible.",
    ttlMs: 60000,
    cacheScope: "public",
    // Observed order is deliberately NOT alphabetical: the snapshot body
    // sorts tools by name while toolsList.order preserves this (SPEC §2
    // Decision 2) — the probe tests assert both.
    tools: buildCleanTools(),
  };
}

/**
 * Declared probes shared by clean@v1 and EVERY derivative (probeSpecHash
 * must match across a golden pair — SPEC §2 Decision 3). `weather-noargs`
 * deliberately violates the schema so the captured behavior includes an
 * errorCode (feeds `error.code.changed` at M3).
 */
export function buildCleanProbes(): ProbeDecl[] {
  return [
    { id: "weather", tool: "get_weather", arguments: { location: "Seattle" }, capture: "shape" },
    { id: "weather-noargs", tool: "get_weather", arguments: {}, capture: "shape" },
  ];
}

export const cleanV1 = makeEntry(buildCleanSurface(), buildCleanProbes());

/** Same surface, "next release" — must diff to zero findings. */
export const cleanV2Identical = makeEntry(buildCleanSurface(), buildCleanProbes());
