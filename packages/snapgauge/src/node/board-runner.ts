/**
 * Checks ONE roster target using only the read-only, unauthenticated
 * surface the board publishes (SPEC §8/§10 M6): era, advertised
 * `supportedVersions`, the T-group framing assertions, cache-hint presence
 * (folded into those assertions — `transport.cache_hints_missing` /
 * `cachescope_inconsistent_across_pages`), `x-mcp-header` validity
 * (static), and the D-group checks reachable WITHOUT `tools/call` (era,
 * advertised-version honesty, per-connection stability — all driven by
 * `server/discover` + `tools/list` alone).
 *
 * Reuses `runCompat` (SPEC §3: "the same engine runs everywhere") with an
 * EMPTY probe spec — `runCompat` only issues `tools/call` for declared
 * probes and its two X-group LIVE checks, both of which iterate
 * `options.probes`; the board declares none, so neither ever fires. The one
 * remaining path to a `tools/call` is the single T-group assertion
 * `transport.meta_missing_not_32602` (it deliberately omits `_meta` to
 * verify the server rejects the call) — excluded via `BOARD_TRANSPORT_ASSERTIONS`
 * for the identical reason `apps/web/src/lib/live-check.ts`'s
 * `WEB_SAFE_ASSERTIONS` excludes it: the board never calls `tools/call` on a
 * third-party server (SPEC §1/§8).
 *
 * `supportedVersions` is not part of `CompatResult` (SPEC §5 M4's frozen
 * shape), so this makes one extra `server/discover` call of its own rather
 * than widen that already-tested return contract — a second read of a
 * public, side-effect-free endpoint is a fair price for leaving M4 alone.
 */
import {
  TRANSPORT_ASSERTIONS,
  type AssertionReport,
  type TransportAssertion,
} from "../core/assertions.js";
import { runCompat, type CompatFinding, type Era } from "../core/compat/engine.js";
import { SnapgaugeError } from "../core/errors.js";
import { MODERN_FULL } from "../core/profile.js";
import { ProbeSession } from "../core/session.js";
import type { Transport } from "../core/transport.js";
import { WireDiscoverSchema } from "../core/wire.js";
import { authorizeTarget, type AddressPolicy, type AuthorizedTarget } from "./address-policy.js";
import { createHttpTransport } from "./http-transport.js";

/** Excluded for the same reason `WEB_SAFE_ASSERTIONS` excludes it in
 * apps/web/src/lib/live-check.ts: the one T-group assertion that issues a
 * real `tools/call` (SPEC §1/§8 — the board never calls it on a third party). */
export const BOARD_TRANSPORT_ASSERTIONS: readonly TransportAssertion[] = TRANSPORT_ASSERTIONS.filter(
  (assertion) => assertion.id !== "transport.meta_missing_not_32602",
);

export const BOARD_CHECK_STATUSES = ["ok", "unreachable", "auth_required"] as const;
export type BoardCheckStatus = (typeof BOARD_CHECK_STATUSES)[number];

export interface BoardCheckInput {
  url: string;
  protocolVersion?: string | undefined;
  timeoutMs?: number | undefined;
  /** Defaults to `public-only` — a board target is always third-party (SPEC §3 Decision 4). */
  addressPolicy?: AddressPolicy | undefined;
}

export interface BoardCheckOutcome {
  status: BoardCheckStatus;
  statusDetail?: string;
  era?: Era;
  supportedVersions?: string[];
  assertions?: AssertionReport[];
  findings?: CompatFinding[];
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function checkBoardTarget(input: BoardCheckInput): Promise<BoardCheckOutcome> {
  const protocolVersion = input.protocolVersion ?? MODERN_FULL.protocolVersion;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const policy: AddressPolicy = input.addressPolicy ?? "public-only";

  let authorized: AuthorizedTarget;
  try {
    authorized = await authorizeTarget(input.url, policy);
  } catch (error) {
    return classifyFailure(error);
  }

  const httpTransport = (version: string): Transport =>
    createHttpTransport({
      url: authorized.url,
      protocolVersion: version,
      ...(authorized.pinnedAddress !== undefined ? { pinnedAddress: authorized.pinnedAddress } : {}),
      timeoutMs,
    });

  // NOTE: `session.call()`, not `.rpc()` — a server that does not implement
  // `server/discover` at all is a valid, reportable observation (the
  // T-group's `transport.discover_not_implemented` MUST-fail, produced by
  // `runCompat` below), not a transport failure. `.rpc()` would throw on
  // that JSON-RPC error and misclassify the whole target as unreachable.
  let supportedVersions: string[] | undefined;
  const discoverTransport = httpTransport(protocolVersion);
  try {
    const session = new ProbeSession(discoverTransport);
    const exchange = await session.call("server/discover");
    if (exchange.errorCode === undefined) {
      const parsed = WireDiscoverSchema.safeParse(exchange.result);
      if (parsed.success) supportedVersions = parsed.data.supportedVersions;
    }
  } catch (error) {
    return classifyFailure(error);
  } finally {
    await discoverTransport.close?.();
  }

  try {
    const result = await runCompat({
      transportForProfile: () => httpTransport(protocolVersion),
      transportForProtocolVersion: (version) => httpTransport(version),
      profiles: [{ ...MODERN_FULL, protocolVersion }],
      probes: [],
      kind: "http",
      assertions: BOARD_TRANSPORT_ASSERTIONS,
    });
    return {
      status: "ok",
      era: result.era,
      ...(supportedVersions !== undefined ? { supportedVersions } : {}),
      assertions: result.assertions,
      findings: result.findings,
    };
  } catch (error) {
    return classifyFailure(error);
  }
}

function classifyFailure(error: unknown): BoardCheckOutcome {
  if (error instanceof SnapgaugeError) {
    if (error.code === "AUTH") {
      return { status: "auth_required", statusDetail: error.message };
    }
    return { status: "unreachable", statusDetail: `${error.code}: ${error.message}` };
  }
  return {
    status: "unreachable",
    statusDetail: error instanceof Error ? error.message : String(error),
  };
}
