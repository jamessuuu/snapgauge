/**
 * Snapshot formatVersion migrations (SPEC §2 Decision 3): forward-only PURE
 * functions, one per version step, named `00N-*.ts` beside this registry.
 * A reader MUST refuse a higher version and MUST migrate lower ones through
 * this chain — and NEVER rewrites a consumer's file without `--migrate`.
 *
 * The registry is empty while formatVersion is 1 (there is no lower version
 * to migrate FROM); the machinery is unit-tested with injected migrations so
 * the first real bump lands on a proven path.
 */
import { SnapgaugeError } from "../../errors.js";
import { FORMAT_VERSION } from "../schema.js";

export interface SnapshotMigration {
  /** The formatVersion this migration consumes. */
  from: number;
  /** Must be exactly from + 1 — forward-only, one step at a time. */
  to: number;
  /** Pure: returns a NEW document, never mutates the input. */
  migrate(document: Record<string, unknown>): Record<string, unknown>;
}

/** Ordered chain; each entry's `to` is the next entry's `from`. */
export const MIGRATIONS: readonly SnapshotMigration[] = [
  // 001-*.ts lands with the first formatVersion bump.
];

export interface MigrationOutcome {
  document: Record<string, unknown>;
  /** Steps applied, e.g. ["1->2"]. Empty when already current. */
  applied: string[];
}

/**
 * Bring a parsed snapshot document up to FORMAT_VERSION. Callers decide what
 * "migration happened" means for the file on disk (`--migrate` only).
 */
export function migrateSnapshotDocument(
  document: unknown,
  migrations: readonly SnapshotMigration[] = MIGRATIONS,
  targetVersion: number = FORMAT_VERSION,
): MigrationOutcome {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new SnapgaugeError("SNAPSHOT_FORMAT", "snapshot document is not an object");
  }
  let current = document as Record<string, unknown>;
  const applied: string[] = [];
  const initial = current.formatVersion;
  if (typeof initial !== "number" || !Number.isInteger(initial) || initial < 1) {
    throw new SnapgaugeError("SNAPSHOT_FORMAT", "snapshot document has no integer formatVersion");
  }
  let version: number = initial;
  if (version > targetVersion) {
    throw new SnapgaugeError(
      "SNAPSHOT_FORMAT_NEWER",
      `snapshot formatVersion ${String(version)} is newer than this snapgauge (reads up to ${String(targetVersion)}) — upgrade snapgauge`,
    );
  }
  while (version < targetVersion) {
    const step = migrations.find((m) => m.from === version);
    if (step === undefined) {
      throw new SnapgaugeError(
        "SNAPSHOT_FORMAT",
        `no migration from formatVersion ${String(version)} — cannot reach ${String(targetVersion)}`,
      );
    }
    if (step.to !== step.from + 1) {
      throw new SnapgaugeError(
        "INTERNAL",
        `migration ${String(step.from)}->${String(step.to)} is not a single forward step`,
      );
    }
    const next = step.migrate(current);
    if (next === current) {
      throw new SnapgaugeError(
        "INTERNAL",
        `migration ${String(step.from)}->${String(step.to)} returned its input — migrations must be pure`,
      );
    }
    if (next.formatVersion !== step.to) {
      throw new SnapgaugeError(
        "INTERNAL",
        `migration ${String(step.from)}->${String(step.to)} did not stamp formatVersion ${String(step.to)}`,
      );
    }
    applied.push(`${String(step.from)}->${String(step.to)}`);
    current = next;
    version = step.to;
  }
  return { document: current, applied };
}
