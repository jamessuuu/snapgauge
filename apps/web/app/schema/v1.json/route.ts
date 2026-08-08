/**
 * GET /schema/v1.json (SPEC §4): the static `snapgauge.config.json` JSON
 * Schema, generated straight from the same Zod schema the CLI's config
 * loader parses against ("snapgauge/node" ConfigSchema) — one source, no
 * drift. Zero request-dependent behavior, so this is statically generated
 * at build time (D3: works during a Hobby function-pause blackout too,
 * since it never needs to run again after the build).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { ConfigSchema } from "snapgauge/node";

export const dynamic = "force-static";
export const runtime = "nodejs";

export function GET(): NextResponse {
  const schema = z.toJSONSchema(ConfigSchema, { unrepresentable: "any" });
  return NextResponse.json({ title: "snapgauge.config.json", ...schema });
}
