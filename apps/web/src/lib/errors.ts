/**
 * Typed error taxonomy for the hosted live check (SPEC §4/§6/§9 feasibility
 * item 5): no stack traces, no upstream error strings echoed to the client.
 * Reuses the CLI's own `ErrorCode` union (SPEC's taxonomy is one taxonomy)
 * and adds exactly the two codes that only make sense for a hosted demo.
 */
import type { ErrorCode } from "snapgauge";

export type WebErrorCode = ErrorCode | "RATE_LIMITED" | "SERVICE_UNAVAILABLE";

export class RateLimitedError extends Error {
  readonly code = "RATE_LIMITED";
  constructor(message: string) {
    super(message);
    this.name = "RateLimitedError";
  }
}

export class ServiceUnavailableError extends Error {
  readonly code = "SERVICE_UNAVAILABLE";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ServiceUnavailableError";
  }
}

export function httpStatusForCode(code: WebErrorCode): number {
  switch (code) {
    case "TARGET_NOT_ALLOWED":
    case "USAGE":
    case "SNAPSHOT_FORMAT":
    case "SNAPSHOT_FORMAT_NEWER":
    case "SPEC_MISMATCH":
      return 400;
    case "AUTH":
      return 401;
    case "RATE_LIMITED":
      return 429;
    case "PROBE_TIMEOUT":
      return 504;
    case "PROBE_FAILURE":
      return 502;
    case "SERVICE_UNAVAILABLE":
      return 503;
    case "INTERNAL":
      return 500;
  }
}
