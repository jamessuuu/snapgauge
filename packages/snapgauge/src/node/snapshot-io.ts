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
import { FORMAT_VERSION, SnapshotV1Schema, type SnapshotV1 } from "../core/snapshot/schema.js";

export function readSnapshotFile(path: string): SnapshotV1 {
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
