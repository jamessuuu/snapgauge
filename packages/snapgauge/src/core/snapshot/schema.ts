/**
 * Snapshot model v1 (SPEC §2). The Zod schema is the read boundary: every
 * snapshot file is parsed through it before any comparison, and `record`
 * parses its own output through it before returning (so an invalid file can
 * never be written).
 *
 * `strictObject` throughout: the committed format rejects unknown keys — a
 * key this version does not model belongs to a higher formatVersion, and
 * Decision 3 says a reader MUST refuse higher versions rather than guess.
 */
import { z } from "zod";
import { JsonObjectSchema, JsonValueSchema } from "../json.js";

/** Monotonic integer; a reader refuses higher versions (SPEC §2 Decision 3). */
export const FORMAT_VERSION = 1;

/**
 * Version of the diff-rule catalog baked into this build. M1 ships six rules
 * spanning the four tiers (SPEC §10); the full §5 taxonomy lands at M3 and
 * bumps this.
 */
export const RULESET_VERSION = 1;

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "sha-256 hex");
const Iso8601Schema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/, "ISO 8601 timestamp");

export const SnapshotTargetSchema = z.strictObject({
  transport: z.enum(["http", "stdio", "fixture"]),
  host: z.string(),
  path: z.string(),
  protocolVersion: z.string(),
  auth: z.enum(["none", "bearer(redacted)"]),
});
export type SnapshotTarget = z.infer<typeof SnapshotTargetSchema>;

export const SnapshotToolSchema = z.strictObject({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: JsonObjectSchema,
  outputSchema: JsonObjectSchema.optional(),
  annotations: JsonObjectSchema.optional(),
  icons: z.array(JsonValueSchema).optional(),
  _meta: JsonObjectSchema.optional(),
  // xmcpHeaders (per-tool x-mcp-header static analysis, SPEC §2/§5 X-group)
  // lands with the compat engine at M4.
});
export type SnapshotTool = z.infer<typeof SnapshotToolSchema>;

export const SnapshotDiscoverSchema = z.strictObject({
  supportedVersions: z.array(z.string()),
  capabilities: JsonObjectSchema,
  serverInfo: z.strictObject({ name: z.string(), version: z.string() }),
  instructions: z.string().optional(),
  // The 2026-07-28 revision says server/discover MUST carry ttlMs + cacheScope.
  // The snapshot stays tolerant: absence is recorded here and becomes a
  // T-group finding (cache_hints_missing) at M4 — a parse failure would hide
  // the evidence instead of reporting it.
  ttlMs: z.number().int().nonnegative().optional(),
  cacheScope: z.string().optional(),
});

/**
 * One captured behavior probe (SPEC §2 `behavior`): a tools/call exchange
 * reduced to its observable contract. JSON-RPC error responses are DATA
 * (isError + errorCode feed `error.code.changed`); only transport-level
 * failures keep a probe out of the snapshot entirely (SPEC §6).
 */
export const SnapshotBehaviorProbeSchema = z.strictObject({
  resultType: z.string().optional(),
  /** Shape capture: text blocks are `{type:"text", sha256}` (Decision 1). */
  contentBlocks: z.array(JsonValueSchema).optional(),
  structuredShape: JsonValueSchema.optional(),
  /** `capture: "values"` only — opt-in per probe (Decision 1). */
  structuredContent: JsonObjectSchema.optional(),
  isError: z.boolean(),
  errorCode: z.number().int().optional(),
  metaKeys: z.array(z.string()).optional(),
  httpStatus: z.number().int(),
  contentType: z.string().optional(),
});
export type SnapshotBehaviorProbe = z.infer<typeof SnapshotBehaviorProbeSchema>;

export const SnapshotToolsListSchema = z.strictObject({
  /** Observed order — diffed at its own tier (SPEC §2 Decision 2). */
  order: z.array(z.string()),
  pages: z.number().int().positive(),
  ttlMs: z.number().int().nonnegative().optional(),
  cacheScope: z.string().optional(),
  /** False when 3 repeated lists disagree on order (SPEC §6). */
  orderStable: z.boolean(),
});

export const SnapshotV1Schema = z.strictObject({
  formatVersion: z.literal(FORMAT_VERSION),
  snapgaugeVersion: z.string(),
  rulesetVersion: z.number().int().positive(),
  probeSpecHash: Sha256HexSchema,
  /** Metadata — excluded from every diff (SPEC §2 Decision 2). */
  recordedAt: Iso8601Schema,
  target: SnapshotTargetSchema,
  discover: SnapshotDiscoverSchema,
  /** Sorted by name in the body; observed order lives in toolsList.order. */
  tools: z.array(SnapshotToolSchema),
  toolsList: SnapshotToolsListSchema,
  // Optional sections: a snapshot stays honest about what was actually
  // probed instead of writing empty placeholders. `behavior` is written when
  // the target declares probes (M2); resources/prompts capture is deferred
  // (no SPEC §5 tier-table rule consumes them yet); transport (T-group) and
  // compat (D/X-group) verdicts land at M4.
  resources: JsonObjectSchema.optional(),
  prompts: z.array(JsonValueSchema).optional(),
  behavior: z.record(z.string(), SnapshotBehaviorProbeSchema).optional(),
  transport: JsonObjectSchema.optional(),
  compat: JsonObjectSchema.optional(),
});
export type SnapshotV1 = z.infer<typeof SnapshotV1Schema>;
