/**
 * snapgauge — contract tests for MCP servers (SPEC docs/SPEC.md).
 *
 * This entry ("." export) is the programmatic API and is CORE-ONLY:
 * isomorphic, zero I/O, safe to import from a browser Web Worker or a
 * Vercel function (SPEC §3). The CLI lives behind "snapgauge/bin"; node
 * transports and file I/O land at M2 behind the node side of the boundary.
 *
 * Surface: snapshot model v1 + canonicalizer, `record`/`diff`, the diff
 * rule catalog, transport assertions (T-group) and reporters. Node
 * transports (http/stdio), config loading and file I/O live behind the
 * node side of the boundary and are consumed by the CLI.
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
  type FixtureRawHandler,
  type FixtureResponse,
  type FixtureServer,
  type RawHttpRequest,
  type RawHttpResponse,
  type Transport,
  type TransportKind,
  type TransportResponse,
} from "./core/transport.js";
export {
  ASSERTION_VERDICTS,
  AssertionReportSchema,
  runTransportAssertions,
  TRANSPORT_ASSERTIONS,
  type AssertionContext,
  type AssertionReport,
  type AssertionVerdict,
  type TransportAssertion,
} from "./core/assertions.js";
export {
  CheckOutputSchema,
  CompatSectionSchema,
  parseReportFormat,
  render,
  REPORT_FORMATS,
  summarize,
  type CheckOutput,
  type CompatSection,
  type ReportFormat,
} from "./core/report/report.js";
export { ProbeSession, type RpcExchange } from "./core/session.js";
export { shapeOf } from "./core/snapshot/shape.js";
export {
  COMPAT_CLASSES,
  CompatFindingSchema,
  CompatResultSchema,
  DEGRADED_META_KEY,
  ERAS,
  runCompat,
  VERDICTS,
  xhdrStaticFindings,
  type CompatClass,
  type CompatEngineOptions,
  type CompatFinding,
  type CompatResult,
  type CompatVerdict,
  type Era,
} from "./core/compat/engine.js";
export {
  analyzeXmcpHeaders,
  type XhdrViolation,
  type XmcpHeaderReport,
} from "./core/compat/xhdr.js";
export {
  migrateSnapshotDocument,
  MIGRATIONS,
  type SnapshotMigration,
} from "./core/snapshot/migrations/index.js";
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
  normalizeVolatileKeys,
  probeSpecHash,
  VOLATILE_KEYS,
  type ProbeDecl,
  type ProbeSpec,
} from "./core/snapshot/canonical.js";
export {
  record,
  type ProbeFailure,
  type RecordOptions,
  type RecordOutcome,
} from "./core/probe.js";
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
export {
  BOARD_ROW_STATUSES,
  BoardFileSchema,
  BoardRowSchema,
  RosterSchema,
  RosterTargetSchema,
  type BoardFile,
  type BoardRow,
  type BoardRowStatus,
  type Roster,
  type RosterTarget,
} from "./core/board/schema.js";
export {
  buildBoardRow,
  isPublishable,
  mustViolationCountOf,
  type BuildBoardRowInput,
  type DisclosureInput,
} from "./core/board/disclosure.js";
