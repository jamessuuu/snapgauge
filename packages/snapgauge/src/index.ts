/**
 * snapgauge — contract tests for MCP servers (SPEC docs/SPEC.md).
 *
 * This entry ("." export) is the programmatic API and is CORE-ONLY:
 * isomorphic, zero I/O, safe to import from a browser Web Worker or a
 * Vercel function (SPEC §3). The CLI lives behind "snapgauge/bin"; node
 * transports and file I/O land at M2 behind the node side of the boundary.
 *
 * M1 surface (SPEC §10 walking skeleton): snapshot model v1 + canonicalizer,
 * `record`/`diff` over the fixture transport, six diff rules spanning the
 * four tiers, exit-code taxonomy.
 */
export { SNAPGAUGE_VERSION } from "./core/version.js";
export {
  EXIT,
  exitCodeForError,
  SnapgaugeError,
  type ErrorCode,
  type ExitCode,
} from "./core/errors.js";
export { canonicalStringify, jcsCanonical, type Json, type JsonObject } from "./core/json.js";
export { sha256Hex } from "./core/sha256.js";
export type { JsonRpcRequest } from "./core/jsonrpc.js";
export { MODERN_FULL, getProfile, profileNames, type Profile } from "./core/profile.js";
export {
  createFixtureTransport,
  type FixtureResponse,
  type FixtureServer,
  type Transport,
  type TransportResponse,
} from "./core/transport.js";
export {
  FORMAT_VERSION,
  RULESET_VERSION,
  SnapshotToolSchema,
  SnapshotV1Schema,
  type SnapshotTarget,
  type SnapshotTool,
  type SnapshotV1,
} from "./core/snapshot/schema.js";
export {
  BUILTIN_VOLATILE_SELECTORS,
  normalizeVolatile,
  probeSpecHash,
  type ProbeDecl,
  type ProbeSpec,
} from "./core/snapshot/canonical.js";
export { record, type RecordOptions } from "./core/probe.js";
export {
  DiffOutputSchema,
  FindingSchema,
  TIERS,
  diffSnapshots,
  gateFailed,
  parseTier,
  tierRank,
  type DiffOutput,
  type DiffResult,
  type Finding,
  type Tier,
} from "./core/diff/diff.js";
