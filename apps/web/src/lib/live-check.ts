/**
 * The `/api/check` pipeline (SPEC §4): the full URL policy + DNS pinning +
 * no-redirect + cost caps, then a READ-ONLY audit of the target — never a
 * `tools/call` (SPEC §1 non-goal, restated as a hard rule in SECURITY.md).
 *
 * Because the pipeline never calls `tools/call`, it cannot run the D-group
 * degradation checks (they replay a declared probe under reduced client
 * profiles) or diff against a prior snapshot (nothing is persisted, SPEC
 * §6). What it CAN do, safely, with only `server/discover` + `tools/list`:
 *
 *   - `record()` with an EMPTY probe spec — this is what guarantees no
 *     `tools/call` is ever issued (SPEC §4/§9.5); the same `record()` the
 *     CLI uses, just with nothing declared to call.
 *   - the T-group transport-framing assertions (SPEC §5), MINUS
 *     `transport.meta_missing_not_32602` — that ONE assertion issues a real
 *     `tools/call` (deliberately missing `_meta`, to see whether the
 *     server rejects it correctly) and is excluded here for that reason,
 *     even though the CLI/eval suite still runs it against fixtures and
 *     consenting targets.
 *   - the X-group STATIC `x-mcp-header` analysis (SPEC §5) — schema-only,
 *     no live check (the two live X-group checks also call `tools/call`).
 *
 * The result is returned in the SAME `CheckOutput` shape (command:"compat")
 * the CLI's `compat` command emits and `snapgauge report` can reformat —
 * "the same Result object the CLI emits, downloadable as JSON" (SPEC §4).
 */
import {
  EXIT,
  MODERN_FULL,
  SnapgaugeError,
  TRANSPORT_ASSERTIONS,
  record,
  runTransportAssertions,
  xhdrStaticFindings,
  type CheckOutput,
  type ExitCode,
  type Transport,
} from "snapgauge";
import { createHttpTransport } from "snapgauge/node";
import { authorizeWebTarget } from "./ssrf-policy.js";

/** SPEC §6 cost safety caps. */
const MAX_REQUESTS_PER_CHECK = 40;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const WALL_CLOCK_MS = 20_000;
const PER_REQUEST_TIMEOUT_MS = 10_000;

const WEB_SAFE_ASSERTIONS = TRANSPORT_ASSERTIONS.filter(
  (assertion) => assertion.id !== "transport.meta_missing_not_32602",
);

function approxBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/** Wraps a transport with the ≤40 requests / ≤1 MB total caps (SPEC §6);
 * the ≤256 KB per-response cap is enforced inside the transport itself via
 * `maxBodyBytes` (packages/snapgauge/src/node/http-transport.ts). */
function budgeted(inner: Transport): Transport {
  let requests = 0;
  let totalBytes = 0;
  const track = (bytes: number): void => {
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new SnapgaugeError(
        "PROBE_FAILURE",
        `response budget exceeded (${String(MAX_TOTAL_BYTES)} bytes total per check, SPEC §6)`,
      );
    }
  };
  const gate = (): void => {
    requests += 1;
    if (requests > MAX_REQUESTS_PER_CHECK) {
      throw new SnapgaugeError(
        "PROBE_FAILURE",
        `request budget exceeded (${String(MAX_REQUESTS_PER_CHECK)} requests per check, SPEC §6)`,
      );
    }
  };
  const wrapped: Transport = {
    async send(request, headers) {
      gate();
      const response = await inner.send(request, headers);
      track(approxBytes(response.body));
      return response;
    },
  };
  if (inner.raw !== undefined) {
    const innerRaw = inner.raw.bind(inner);
    wrapped.raw = async (request) => {
      gate();
      const response = await innerRaw(request);
      track(response.bodyText.length);
      return response;
    };
  }
  if (inner.close !== undefined) wrapped.close = inner.close.bind(inner);
  return wrapped;
}

export async function runLiveCheck(rawUrl: string): Promise<CheckOutput> {
  const authorized = await authorizeWebTarget(rawUrl);
  const transport = budgeted(
    createHttpTransport({
      url: authorized.url,
      protocolVersion: MODERN_FULL.protocolVersion,
      ...(authorized.pinnedAddress !== undefined ? { pinnedAddress: authorized.pinnedAddress } : {}),
      timeoutMs: PER_REQUEST_TIMEOUT_MS,
      maxBodyBytes: MAX_BODY_BYTES,
    }),
  );

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      reject(
        new SnapgaugeError(
          "PROBE_TIMEOUT",
          `check exceeded the ${String(WALL_CLOCK_MS)}ms wall-clock budget (SPEC §6)`,
        ),
      );
    }, WALL_CLOCK_MS);
  });

  try {
    return await Promise.race([pipeline(transport, authorized.url), deadline]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    await transport.close?.();
  }
}

async function pipeline(transport: Transport, url: URL): Promise<CheckOutput> {
  // Empty probe spec: record() probes server/discover + tools/list only —
  // it NEVER calls tools/call unless a probe is declared, and the hosted
  // demo declares none (SPEC §1/§4 hard rule).
  const outcome = await record({
    transport,
    target: { transport: "http", host: url.host, path: url.pathname, protocolVersion: MODERN_FULL.protocolVersion, auth: "none" },
    probeSpec: { probes: [], profiles: [MODERN_FULL.name] },
    recordedAt: new Date().toISOString(),
    clientCapabilities: {},
  });

  const cacheHintsMissing: string[] = [];
  if (outcome.snapshot.discover.ttlMs === undefined || outcome.snapshot.discover.cacheScope === undefined) {
    cacheHintsMissing.push("server/discover");
  }
  if (outcome.snapshot.toolsList.ttlMs === undefined || outcome.snapshot.toolsList.cacheScope === undefined) {
    cacheHintsMissing.push("tools/list");
  }

  const assertions = await runTransportAssertions(
    {
      kind: "http",
      ...(transport.raw !== undefined ? { raw: transport.raw.bind(transport) } : {}),
      serverName: outcome.snapshot.discover.serverInfo.name,
      protocolVersion: MODERN_FULL.protocolVersion,
      observations: {
        discover: "ok",
        cacheHintsMissing,
        observedErrorCodes: [],
      },
    },
    WEB_SAFE_ASSERTIONS,
  );

  const xhdrFindings = xhdrStaticFindings(outcome.snapshot.tools);
  const violation = xhdrFindings.some((finding) => finding.class === "violation");
  const exitCode: ExitCode = violation ? EXIT.COMPAT : EXIT.CLEAN;

  return {
    command: "compat",
    target: { name: url.host, transport: "http" },
    findings: [],
    summary: { breaking: 0, risky: 0, compatible: 0, cosmetic: 0 },
    gate: { failOn: "risky", failed: exitCode !== EXIT.CLEAN },
    assertions,
    compat: { era: "unknown", profiles: [MODERN_FULL.name], findings: xhdrFindings, verdicts: {} },
    exitCode,
  };
}
