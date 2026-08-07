/**
 * Typed error taxonomy + exit codes (SPEC §5, §9.5). The exit-code table is
 * load-bearing for CI consumers: 1 vs 3 is deliberate — different owner,
 * different fix.
 */

export const EXIT = {
  /** clean */
  CLEAN: 0,
  /** drift at/above the gate */
  DRIFT: 1,
  /** probe/connection failure (unreachable, auth, timeout, malformed responses) */
  PROBE: 2,
  /** compat/degradation violation — the server is wrong, not merely different (lands at M4) */
  COMPAT: 3,
  /** usage/config/snapshot-format error */
  USAGE: 4,
  /** internal error */
  INTERNAL: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type ErrorCode =
  /** exit 2 — target unreachable, server error mid-probe, malformed response */
  | "PROBE_FAILURE"
  /** exit 2 — a request exceeded the per-request timeout (SPEC §6) */
  | "PROBE_TIMEOUT"
  /** exit 2 — auth classification: token missing/expired; never logged (SPEC §6) */
  | "AUTH"
  /** exit 2 — address policy refused the target (SPEC §3 Decision 4); reason class only, never the resolved IP */
  | "TARGET_NOT_ALLOWED"
  /** exit 4 — bad arguments, unknown fixture/profile, missing file */
  | "USAGE"
  /** exit 4 — a file is not a valid v1 snapshot */
  | "SNAPSHOT_FORMAT"
  /** exit 4 — snapshot formatVersion is newer than this binary (SPEC §2 Decision 3) */
  | "SNAPSHOT_FORMAT_NEWER"
  /** exit 4 — probeSpecHash differs; the probe spec changed, re-record (SPEC §2 Decision 3) */
  | "SPEC_MISMATCH"
  /** exit 5 — a bug in snapgauge */
  | "INTERNAL";

export class SnapgaugeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SnapgaugeError";
    this.code = code;
  }
}

export function exitCodeForError(code: ErrorCode): ExitCode {
  switch (code) {
    case "PROBE_FAILURE":
    case "PROBE_TIMEOUT":
    case "AUTH":
    case "TARGET_NOT_ALLOWED":
      return EXIT.PROBE;
    case "USAGE":
    case "SNAPSHOT_FORMAT":
    case "SNAPSHOT_FORMAT_NEWER":
    case "SPEC_MISMATCH":
      return EXIT.USAGE;
    case "INTERNAL":
      return EXIT.INTERNAL;
  }
}
