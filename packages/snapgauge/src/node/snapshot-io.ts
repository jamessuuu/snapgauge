/**
 * Snapshot file I/O — node side of the SPEC §3 boundary. Reads are
 * Zod-gated (a file that does not parse as snapshot v1 never reaches the
 * diff engine); writes are atomic (tmp + rename, SPEC §6) and canonical
 * (SPEC §2 Decision 2).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SnapgaugeError } from "../core/errors.js";
import { canonicalStringify } from "../core/json.js";
import {
  migrateSnapshotDocument,
  MIGRATIONS,
  type SnapshotMigration,
} from "../core/snapshot/migrations/index.js";
import { FORMAT_VERSION, SnapshotV1Schema, type SnapshotV1 } from "../core/snapshot/schema.js";

export interface ReadSnapshotOptions {
  /**
   * SPEC §2 Decision 3: older formats are migrated through forward-only pure
   * functions on `--migrate` ONLY — the file is rewritten in place; without
   * it an older file is a targeted exit-4 refusal.
   */
  migrate?: boolean;
  /** Injectable for tests; production uses the real registry. */
  migrations?: readonly SnapshotMigration[];
}

export function readSnapshotFile(path: string, options?: ReadSnapshotOptions): SnapshotV1 {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new SnapgaugeError("USAGE", `cannot read snapshot file: ${path}`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new SnapgaugeError("SNAPSHOT_FORMAT", `${path} is not JSON`, { cause });
  }
  // A higher formatVersion gets a targeted refusal naming the required
  // version (SPEC §2 Decision 3 / §6), not a generic validation error.
  if (typeof parsed === "object" && parsed !== null && "formatVersion" in parsed) {
    const formatVersion = parsed.formatVersion;
    if (typeof formatVersion === "number" && formatVersion > FORMAT_VERSION) {
      throw new SnapgaugeError(
        "SNAPSHOT_FORMAT_NEWER",
        `${path} has formatVersion ${String(formatVersion)}; this snapgauge reads up to ${String(FORMAT_VERSION)} — upgrade snapgauge`,
      );
    }
    if (typeof formatVersion === "number" && formatVersion < FORMAT_VERSION) {
      if (options?.migrate !== true) {
        throw new SnapgaugeError(
          "SNAPSHOT_FORMAT",
          `${path} has formatVersion ${String(formatVersion)}; this snapgauge writes ${String(FORMAT_VERSION)} — re-run with --migrate to upgrade the file in place (SPEC §2 Decision 3: never rewritten without it)`,
        );
      }
      const outcome = migrateSnapshotDocument(parsed, options.migrations ?? MIGRATIONS);
      const migrated = SnapshotV1Schema.safeParse(outcome.document);
      if (!migrated.success) {
        throw new SnapgaugeError(
          "SNAPSHOT_FORMAT",
          `${path} did not migrate to a valid v${String(FORMAT_VERSION)} snapshot (steps: ${outcome.applied.join(", ") || "none"})`,
        );
      }
      writeSnapshotFileAtomic(path, migrated.data);
      return migrated.data;
    }
  }
  const result = SnapshotV1Schema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new SnapgaugeError("SNAPSHOT_FORMAT", `${path} is not a valid v1 snapshot (${detail})`);
  }
  return result.data;
}

export function writeSnapshotFileAtomic(path: string, snapshot: SnapshotV1): void {
  const text = canonicalStringify(snapshot);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path); // replaces atomically; MoveFileEx semantics on Windows
}
