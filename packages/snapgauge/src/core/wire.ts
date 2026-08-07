/**
 * Wire schemas for the MCP results the M1 probe interprets (server/discover,
 * tools/list — 2026-07-28 revision). Plain z.object, not strict: servers may
 * legally send fields this version does not model, and the wire boundary
 * strips them; the SNAPSHOT schema is the strict one. Every response body is
 * parsed here before interpretation (SPEC §9: Zod at every boundary).
 */
import { z } from "zod";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";

export const WireDiscoverSchema = z.object({
  supportedVersions: z.array(z.string()),
  capabilities: JsonObjectSchema.optional(),
  serverInfo: z.object({ name: z.string(), version: z.string() }),
  instructions: z.string().optional(),
  ttlMs: z.number().int().nonnegative().optional(),
  cacheScope: z.string().optional(),
});
export type WireDiscover = z.infer<typeof WireDiscoverSchema>;

export const WireToolSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: JsonObjectSchema,
  outputSchema: JsonObjectSchema.optional(),
  annotations: JsonObjectSchema.optional(),
  icons: z.array(JsonValueSchema).optional(),
  _meta: JsonObjectSchema.optional(),
});
export type WireTool = z.infer<typeof WireToolSchema>;

export const WireToolsListSchema = z.object({
  tools: z.array(WireToolSchema),
  nextCursor: z.string().optional(),
  ttlMs: z.number().int().nonnegative().optional(),
  cacheScope: z.string().optional(),
});
export type WireToolsList = z.infer<typeof WireToolsListSchema>;
