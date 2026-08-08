/**
 * The compat engine (SPEC §5 D-group + X-group live, §10 M4): probes a
 * target under client profiles and produces
 *
 * - the T-group assertion reports (framing + observation checks),
 * - X-group findings (static x-mcp-header validity + the two live checks),
 * - D-group degradation findings and the per (tool × profile) verdict
 *   matrix: ok | declined-correctly | degraded-reported | degraded-silent |
 *   violation,
 * - compat.* cross-version findings (era, advertised-version honesty,
 *   per-connection stability).
 *
 * Exit-code contract (SPEC §5): any `violation`-class finding is exit 3 —
 * the server is WRONG, not merely different; `risky`-class findings gate at
 * exit 1. 1 vs 3 is deliberate: different owner, different fix.
 */
import { z } from "zod";
import {
  runTransportAssertions,
  type AssertionObservations,
  AssertionReportSchema,
} from "../assertions.js";
import { SnapgaugeError } from "../errors.js";
import { jcsCanonical, type Json, type JsonObject } from "../json.js";
import { JsonRpcResponseSchema } from "../jsonrpc.js";
import type { Profile } from "../profile.js";
import { ProbeSession, type RpcExchange } from "../session.js";
import type { ProbeDecl } from "../snapshot/canonical.js";
import { shapeOf } from "../snapshot/shape.js";
import type { Transport, TransportKind } from "../transport.js";
import { SNAPGAUGE_VERSION } from "../version.js";
import { WireDiscoverSchema, WireToolCallResultSchema, WireToolsListSchema } from "../wire.js";
import { analyzeXmcpHeaders, topLevelPropertyOf } from "./xhdr.js";

export const COMPAT_CLASSES = ["violation", "risky", "info"] as const;
export type CompatClass = (typeof COMPAT_CLASSES)[number];

export const CompatFindingSchema = z.strictObject({
  ruleId: z.string(),
  class: z.enum(COMPAT_CLASSES),
  subject: z.string(),
  message: z.string(),
});
export type CompatFinding = z.infer<typeof CompatFindingSchema>;

export const VERDICTS = [
  "ok",
  "declined-correctly",
  "degraded-reported",
  "degraded-silent",
  "violation",
] as const;
export type CompatVerdict = (typeof VERDICTS)[number];

export const ERAS = ["modern-only", "dual", "legacy", "unknown"] as const;
export type Era = (typeof ERAS)[number];

export const CompatResultSchema = z.strictObject({
  era: z.enum(ERAS),
  profiles: z.array(z.string()),
  findings: z.array(CompatFindingSchema),
  /** tool -> profile -> verdict (reduced profiles only; baseline is the reference). */
  verdicts: z.record(z.string(), z.record(z.string(), z.enum(VERDICTS))),
  assertions: z.array(AssertionReportSchema),
  serverName: z.string().optional(),
});
export type CompatResult = z.infer<typeof CompatResultSchema>;

export interface CompatEngineOptions {
  /** One transport per profile; the engine closes what it opens. */
  transportForProfile(profile: Profile): Promise<Transport> | Transport;
  /** For compat.version_advertised_unsupported; omit to skip version probes. */
  transportForProtocolVersion?(version: string): Promise<Transport> | Transport;
  /** Full matrix incl. the baseline; the baseline is `modern-full` when
   * present, else the first profile. */
  profiles: readonly Profile[];
  probes: readonly ProbeDecl[];
  kind: TransportKind;
}

/** The reported-degradation marker (SPEC §5 degrade.* — wire key pinned here). */
export const DEGRADED_META_KEY = "mcp/degraded";

/** Catalog metadata for docs/RULES.md (single source, no drift — SPEC §10). */
export interface CompatRuleMeta {
  id: string;
  class: CompatClass;
  summary: string;
}

export const COMPAT_RULES: readonly CompatRuleMeta[] = [
  {
    id: "degrade.wrong_error",
    class: "violation",
    summary:
      "Under a reduced profile a call must succeed with resultType:\"complete\" or fail with -32021 listing exactly the missing capabilities. A 500, a generic -32603, a hang, or an isError:true text blob is a violation.",
  },
  {
    id: "degrade.input_required_without_capability",
    class: "violation",
    summary:
      "resultType:\"input_required\" whose inputRequests name elicitation/create, sampling/createMessage or roots/list to a client that advertised none.",
  },
  {
    id: "degrade.over_declared",
    class: "violation",
    summary:
      "-32021 naming a capability the tool demonstrably never exercises under modern-full — the server gates at request entry rather than at use.",
  },
  {
    id: "degrade.silent",
    class: "risky",
    summary:
      "A complete result under the reduced profile that differs in shape from modern-full with no signal at all. Permitted by the spec, so reported at risky — exactly what the board exists to publish.",
  },
  {
    id: "degrade.reported",
    class: "info",
    summary:
      "The good citizen: the result degrades under the reduced profile AND says so via the degradation marker.",
  },
  {
    id: "degrade.extension_leak",
    class: "violation",
    summary:
      "An advertised extension's resultType or _meta prefix appears in a response to a profile that advertised no extensions.",
  },
  {
    id: "compat.version_advertised_unsupported",
    class: "violation",
    summary:
      "A version listed in discover.supportedVersions fails a plain tools/list — the server is lying about what it supports.",
  },
  {
    id: "compat.surface_varies_by_version",
    class: "info",
    summary:
      "The tool-name set differs across advertised versions (recorded as a matrix, reported, not failed).",
  },
  {
    id: "compat.legacy_error_unhelpful",
    class: "risky",
    summary:
      "A modern-only server rejects initialize without naming its supported versions (SHOULD; legacy clients have no fall-forward).",
  },
  {
    id: "compat.era",
    class: "info",
    summary: "Informational: modern-only | dual | legacy, from the modern-then-initialize probe.",
  },
  {
    id: "compat.set_varies_per_connection",
    class: "violation",
    summary: "Same profile, two fresh connections, different tool set (MUST NOT).",
  },
  {
    id: "compat.ttl_overpromise",
    class: "risky",
    summary:
      "The surface changed between two recorded runs closer together than the ttlMs the server told clients to cache for. Requires the board's time series (M6) — not evaluated by the engine.",
  },
  {
    id: "xhdr.empty",
    class: "violation",
    summary: "x-mcp-header is empty — the tool is invisible to conforming clients.",
  },
  {
    id: "xhdr.control_char",
    class: "violation",
    summary: "x-mcp-header contains a control character — invisible to conforming clients.",
  },
  {
    id: "xhdr.not_token",
    class: "violation",
    summary: "x-mcp-header is not an RFC 9110 token (1*tchar) — invisible to conforming clients.",
  },
  {
    id: "xhdr.not_unique",
    class: "violation",
    summary: "The same header (case-insensitive) is bound more than once — invisible to conforming clients.",
  },
  {
    id: "xhdr.non_primitive",
    class: "violation",
    summary: "The bound value is not a primitive (`number` is not permitted) — invisible to conforming clients.",
  },
  {
    id: "xhdr.unsafe_integer",
    class: "violation",
    summary: "An integer binding involves values outside the safe-integer range — invisible to conforming clients.",
  },
  {
    id: "xhdr.not_statically_reachable",
    class: "violation",
    summary:
      "The declaration chain is not properties keys only (items/oneOf/anyOf/allOf/not/if-then-else/$ref) — invisible to conforming clients.",
  },
  {
    id: "xhdr.param_mismatch_accepted",
    class: "violation",
    summary: "Live check: a call whose bound param disagrees with its header MUST be rejected with -32020.",
  },
  {
    id: "xhdr.absent_param_rejected",
    class: "violation",
    summary: "Live check: the server MUST NOT expect a header for an absent value.",
  },
];

const CAPABILITY_BY_METHOD: Readonly<Record<string, string>> = {
  "elicitation/create": "elicitation",
  "sampling/createMessage": "sampling",
  "roots/list": "roots",
};

function capabilityOfMethod(method: string): string {
  return CAPABILITY_BY_METHOD[method] ?? method.split("/")[0] ?? method;
}

const MAX_LIST_PAGES = 32;

interface BaselineProbe {
  /** Shape essence of the result (minus _meta) or the error code — the
   * reference the reduced-profile responses are compared against. */
  essence: string;
  /** Capabilities observably exercised under the baseline (input_required). */
  exercised: ReadonlySet<string>;
}

function isObj(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function essenceOf(exchange: RpcExchange): string {
  if (exchange.errorCode !== undefined) {
    return jcsCanonical({ errorCode: exchange.errorCode });
  }
  const result = exchange.result ?? null;
  if (!isObj(result)) return jcsCanonical({ shape: shapeOf(result) });
  const { _meta, ...rest } = result;
  void _meta;
  return jcsCanonical({ shape: shapeOf(rest) });
}

function inputRequestMethods(result: Json | undefined): string[] {
  if (!isObj(result)) return [];
  const requests = result.inputRequests;
  if (!Array.isArray(requests)) return [];
  const methods: string[] = [];
  for (const request of requests) {
    if (isObj(request) && typeof request.method === "string") methods.push(request.method);
  }
  return methods;
}

function degradedMarker(result: Json | undefined): string[] | undefined {
  if (!isObj(result)) return undefined;
  const meta = result._meta;
  if (!isObj(meta)) return undefined;
  const marker = meta[DEGRADED_META_KEY];
  if (!Array.isArray(marker)) return undefined;
  return marker.filter((entry): entry is string => typeof entry === "string");
}

function verdictRank(verdict: CompatVerdict): number {
  return VERDICTS.indexOf(verdict);
}

interface LegacyInitializeProbe {
  /** True when the server answered `initialize` with a JSON-RPC success. */
  ok: boolean;
  errorCode?: number;
  errorData?: Json;
  result?: Json;
}

/**
 * The era probe (SPEC §5 D-group `compat.era`): try the LEGACY `initialize`
 * handshake. A real legacy client predates `MCP-Protocol-Version` entirely,
 * so this deliberately sends NO version header — sending the baseline's
 * modern header alongside a legacy body would trip the framing-level
 * `header_body_mismatch` / `unsupported_version` MUSTs (HTTP 400 + a
 * JSON-RPC error body), which `ProbeSession.call` treats as a hard
 * PROBE_FAILURE (non-200 is not "data" there) — exactly the regression that
 * broke the M2 HTTP gate the first time this probe was wired up. Going
 * through `Transport.raw` when available sidesteps that: any HTTP status is
 * inspected as data, never thrown. stdio has no raw layer, but its `send()`
 * always synthesizes status 200 (SPEC: real failures reject instead), so
 * `session.call` is already safe there.
 */
async function probeLegacyInitialize(
  transport: Transport,
  session: ProbeSession,
): Promise<LegacyInitializeProbe> {
  const params: JsonObject = {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "snapgauge", version: SNAPGAUGE_VERSION },
  };
  if (transport.raw !== undefined) {
    try {
      const response = await transport.raw({
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        bodyText: JSON.stringify({
          jsonrpc: "2.0",
          id: "snapgauge-legacy-init",
          method: "initialize",
          params,
        }),
      });
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(response.bodyText);
      } catch {
        return { ok: false };
      }
      const envelope = JsonRpcResponseSchema.safeParse(parsedBody);
      if (!envelope.success) return { ok: false };
      if ("error" in envelope.data) {
        const { code, data } = envelope.data.error;
        return { ok: false, errorCode: code, ...(data !== undefined ? { errorData: data } : {}) };
      }
      return { ok: true, result: envelope.data.result };
    } catch {
      // A transport-level failure (timeout, connection reset) is evidence
      // the legacy handshake did not succeed — not a reason to crash the
      // whole compat run over a purely exploratory probe.
      return { ok: false };
    }
  }
  try {
    const exchange = await session.call("initialize", params);
    if (exchange.errorCode !== undefined) {
      return {
        ok: false,
        errorCode: exchange.errorCode,
        ...(exchange.errorData !== undefined ? { errorData: exchange.errorData } : {}),
      };
    }
    return { ok: true, ...(exchange.result !== undefined ? { result: exchange.result } : {}) };
  } catch {
    return { ok: false };
  }
}

export async function runCompat(options: CompatEngineOptions): Promise<CompatResult> {
  const profiles = [...options.profiles];
  if (profiles.length === 0) {
    throw new SnapgaugeError("USAGE", "compat needs at least one profile");
  }
  const baseline = profiles.find((p) => p.name === "modern-full") ?? profiles[0];
  if (baseline === undefined) throw new SnapgaugeError("INTERNAL", "unreachable");
  const reduced = profiles.filter((p) => p !== baseline);

  const findings: CompatFinding[] = [];
  const verdicts: Record<string, Record<string, CompatVerdict>> = {};
  const errorCodes: number[] = [];
  const opened: Transport[] = [];

  const open = async (profile: Profile): Promise<Transport> => {
    const transport = await options.transportForProfile(profile);
    opened.push(transport);
    return transport;
  };

  const track = (exchange: RpcExchange): RpcExchange => {
    if (exchange.errorCode !== undefined) errorCodes.push(exchange.errorCode);
    return exchange;
  };

  try {
    const baseTransport = await open(baseline);
    const baseSession = new ProbeSession(baseTransport);

    // -- era + discover ----------------------------------------------------
    const discoverExchange = track(await baseSession.call("server/discover"));
    const discoverParsed =
      discoverExchange.errorCode === undefined
        ? WireDiscoverSchema.safeParse(discoverExchange.result)
        : undefined;
    const discoverOk = discoverParsed?.success === true;
    const discover = discoverParsed?.success === true ? discoverParsed.data : undefined;

    const initializeProbe = await probeLegacyInitialize(baseTransport, baseSession);
    if (initializeProbe.errorCode !== undefined) errorCodes.push(initializeProbe.errorCode);
    const initializeOk = initializeProbe.ok;

    const era: Era = discoverOk
      ? initializeOk
        ? "dual"
        : "modern-only"
      : initializeOk
        ? "legacy"
        : "unknown";
    findings.push({
      ruleId: "compat.era",
      class: "info",
      subject: "discover",
      message: `era: ${era} (server/discover ${discoverOk ? "answered" : "failed"}, initialize ${initializeOk ? "answered" : "failed"})`,
    });

    if (era === "modern-only") {
      const data = initializeProbe.errorData;
      const supported = isObj(data) ? data.supported : undefined;
      if (!Array.isArray(supported) || supported.length === 0) {
        findings.push({
          ruleId: "compat.legacy_error_unhelpful",
          class: "risky",
          subject: "initialize",
          message:
            "a modern-only server rejected initialize without naming its supported versions (SHOULD; legacy clients have no fall-forward)",
        });
      }
    }

    let serverName = discover?.serverInfo.name;
    if (serverName === undefined && initializeOk && isObj(initializeProbe.result)) {
      const info = initializeProbe.result.serverInfo;
      if (isObj(info) && typeof info.name === "string") serverName = info.name;
    }

    // -- tools/list with per-page cache observation -------------------------
    const pageScopes: (string | null)[] = [];
    interface ListedTool {
      name: string;
      inputSchema: JsonObject;
    }
    const tools: ListedTool[] = [];
    let firstTtl: number | undefined;
    let firstScope: string | undefined;
    let listOk = false;
    {
      let cursor: string | undefined;
      let pages = 0;
      do {
        pages += 1;
        if (pages > MAX_LIST_PAGES) break;
        const exchange = track(
          await baseSession.call("tools/list", cursor !== undefined ? { cursor } : undefined),
        );
        if (exchange.errorCode !== undefined) break;
        const parsed = WireToolsListSchema.safeParse(exchange.result);
        if (!parsed.success) break;
        listOk = true;
        pageScopes.push(parsed.data.cacheScope ?? null);
        if (pages === 1) {
          firstTtl = parsed.data.ttlMs;
          firstScope = parsed.data.cacheScope;
        }
        for (const tool of parsed.data.tools) {
          tools.push({ name: tool.name, inputSchema: tool.inputSchema });
        }
        cursor = parsed.data.nextCursor;
      } while (cursor !== undefined);
    }

    // -- X-group static ----------------------------------------------------
    for (const tool of tools) {
      const reports = analyzeXmcpHeaders(tool.inputSchema);
      const uniqueViolationsSeen = new Set<string>();
      for (const report of reports) {
        for (const violation of report.violations) {
          if (violation === "not_unique") {
            const key = report.header.toLowerCase();
            if (uniqueViolationsSeen.has(key)) continue;
            uniqueViolationsSeen.add(key);
            findings.push({
              ruleId: "xhdr.not_unique",
              class: "violation",
              subject: `tools.${tool.name}.inputSchema.x-mcp-header.${key}`,
              message: `header "${report.header}" is bound more than once (case-insensitive) — this tool is invisible to conforming clients`,
            });
            continue;
          }
          findings.push({
            ruleId: `xhdr.${violation}`,
            class: "violation",
            subject: `tools.${tool.name}.inputSchema.${report.path}`,
            message: `x-mcp-header "${report.header}" ${describeXhdrViolation(violation)} — this tool is invisible to conforming clients`,
          });
        }
      }
    }

    // -- behavior probes: baseline then each reduced profile ----------------
    const callProbe = async (
      session: ProbeSession,
      probe: ProbeDecl,
      profile: Profile,
      argumentsOverride?: JsonObject,
      headers?: Record<string, string>,
    ): Promise<RpcExchange> =>
      track(
        await session.call(
          "tools/call",
          {
            name: probe.tool,
            arguments: argumentsOverride ?? (probe.arguments as JsonObject),
            _meta: { clientCapabilities: profile.clientCapabilities },
          },
          headers,
        ),
      );

    const baselines = new Map<string, BaselineProbe>();
    const resultTypeAbsent: string[] = [];
    for (const probe of options.probes) {
      const exchange = await callProbe(baseSession, probe, baseline);
      const exercised = new Set<string>();
      if (exchange.errorCode === undefined) {
        const parsed = WireToolCallResultSchema.safeParse(exchange.result);
        if (parsed.success) {
          if (parsed.data.resultType === undefined) resultTypeAbsent.push(probe.id);
          for (const method of inputRequestMethods(exchange.result)) {
            exercised.add(capabilityOfMethod(method));
          }
        }
      }
      baselines.set(probe.id, { essence: essenceOf(exchange), exercised });
    }

    const extensionsCapability = discover?.capabilities?.extensions;
    const advertisedExtensions = isObj(extensionsCapability)
      ? Object.keys(extensionsCapability)
      : [];

    for (const profile of reduced) {
      const transport = await open(profile);
      const session = new ProbeSession(transport);
      for (const probe of options.probes) {
        const base = baselines.get(probe.id);
        if (base === undefined) continue;
        const { verdict, probeFindings } = await judgeDegradation(
          () => callProbe(session, probe, profile),
          probe,
          profile,
          base,
          advertisedExtensions,
        );
        findings.push(...probeFindings);
        const row = (verdicts[probe.tool] ??= {});
        const existing = row[profile.name];
        if (existing === undefined || verdictRank(verdict) > verdictRank(existing)) {
          row[profile.name] = verdict;
        }
      }
    }

    // -- X-group live checks (valid bindings on probed tools) ---------------
    for (const probe of options.probes) {
      const tool = tools.find((t) => t.name === probe.tool);
      if (tool === undefined) continue;
      for (const report of analyzeXmcpHeaders(tool.inputSchema)) {
        if (!report.valid) continue;
        const property = topLevelPropertyOf(report);
        if (property === undefined) continue;
        const subject = `tools.${tool.name}.inputSchema.${report.path}`;
        // Live check 1: param/header mismatch MUST be rejected with -32020.
        const mismatch = await callProbe(
          baseSession,
          probe,
          baseline,
          { ...(probe.arguments as JsonObject), [property]: "snapgauge-body-value" },
          { [report.header.toLowerCase()]: "snapgauge-header-value" },
        );
        if (mismatch.errorCode !== -32020) {
          findings.push({
            ruleId: "xhdr.param_mismatch_accepted",
            class: "violation",
            subject,
            message: `a call with "${property}" disagreeing with its ${report.header} header was ${mismatch.errorCode === undefined ? "accepted" : `rejected with ${String(mismatch.errorCode)}`} — the server MUST reject with -32020`,
          });
        }
        // Live check 2: an ABSENT value must not demand its header.
        const withoutParam = Object.fromEntries(
          Object.entries(probe.arguments as JsonObject).filter(([key]) => key !== property),
        );
        const absent = await callProbe(baseSession, probe, baseline, withoutParam);
        if (absent.errorCode === -32020) {
          findings.push({
            ruleId: "xhdr.absent_param_rejected",
            class: "violation",
            subject,
            message: `a call omitting optional "${property}" (and its header) was rejected with -32020 — the server MUST NOT expect a header for an absent value`,
          });
        }
      }
    }

    // -- compat.set_varies_per_connection -----------------------------------
    const setA = await toolNameSet(await open(baseline));
    const setB = await toolNameSet(await open(baseline));
    if (setA !== undefined && setB !== undefined && setA !== setB) {
      findings.push({
        ruleId: "compat.set_varies_per_connection",
        class: "violation",
        subject: "toolsList",
        message:
          "two fresh connections under the same profile saw different tool sets (MUST NOT)",
      });
    }

    // -- advertised-version honesty -----------------------------------------
    if (discover !== undefined && options.transportForProtocolVersion !== undefined) {
      const setsByVersion = new Map<string, string>();
      for (const version of discover.supportedVersions) {
        const transport = await options.transportForProtocolVersion(version);
        opened.push(transport);
        const names = await toolNameSet(transport, (exchange) => track(exchange));
        if (names === undefined) {
          findings.push({
            ruleId: "compat.version_advertised_unsupported",
            class: "violation",
            subject: `discover.supportedVersions.${version}`,
            message: `advertised version ${version} fails a plain tools/list — the server is lying about what it supports`,
          });
          continue;
        }
        setsByVersion.set(version, names);
      }
      if (new Set(setsByVersion.values()).size > 1) {
        findings.push({
          ruleId: "compat.surface_varies_by_version",
          class: "info",
          subject: "discover.supportedVersions",
          message:
            "the tool-name set differs across advertised versions (recorded as a matrix, reported, not failed)",
        });
      }
    }

    // -- observation-backed T-group assertions ------------------------------
    const cacheHintsMissing: string[] = [];
    if (discover !== undefined && (discover.ttlMs === undefined || discover.cacheScope === undefined)) {
      cacheHintsMissing.push("server/discover");
    }
    if (listOk && (firstTtl === undefined || firstScope === undefined)) {
      cacheHintsMissing.push("tools/list");
    }
    const observations: AssertionObservations = {
      discover: discoverOk
        ? "ok"
        : { ...(discoverExchange.errorCode !== undefined ? { errorCode: discoverExchange.errorCode } : {}) },
      ...(options.probes.length > 0 ? { resultTypeAbsent } : {}),
      ...(discoverOk || listOk ? { cacheHintsMissing } : {}),
      ...(listOk ? { cacheScopeByPage: pageScopes } : {}),
      observedErrorCodes: errorCodes,
    };
    const assertions = await runTransportAssertions({
      kind: options.kind,
      raw: baseTransport.raw?.bind(baseTransport),
      serverName,
      protocolVersion: baseline.protocolVersion,
      sampleTool: tools[0]?.name,
      observations,
    });
    for (const report of assertions) {
      if (report.verdict === "fail") {
        findings.push({
          ruleId: report.id,
          class: "violation",
          subject: "transport",
          message: `${report.detail} (${report.cite})`,
        });
      } else if (report.verdict === "warn") {
        findings.push({
          ruleId: report.id,
          class: "risky",
          subject: "transport",
          message: `${report.detail} (${report.cite})`,
        });
      }
    }

    findings.sort(
      (a, b) =>
        COMPAT_CLASSES.indexOf(a.class) - COMPAT_CLASSES.indexOf(b.class) ||
        compareStrings(a.ruleId, b.ruleId) ||
        compareStrings(a.subject, b.subject),
    );

    return {
      era,
      profiles: profiles.map((p) => p.name),
      findings,
      verdicts,
      assertions,
      ...(serverName !== undefined ? { serverName } : {}),
    };
  } finally {
    for (const transport of opened) {
      await transport.close?.();
    }
  }
}

async function judgeDegradation(
  call: () => Promise<RpcExchange>,
  probe: ProbeDecl,
  profile: Profile,
  base: BaselineProbe,
  advertisedExtensions: readonly string[],
): Promise<{ verdict: CompatVerdict; probeFindings: CompatFinding[] }> {
  const subject = `${probe.tool}@${profile.name}`;
  const declared = new Set(Object.keys(profile.clientCapabilities));
  let exchange: RpcExchange;
  try {
    exchange = await call();
  } catch (error) {
    return {
      verdict: "violation",
      probeFindings: [
        {
          ruleId: "degrade.wrong_error",
          class: "violation",
          subject,
          message: `under ${profile.name} the call failed at the transport level (${error instanceof Error ? error.message : String(error)}) — a reduced client gets a crash, not a contract (MUST NOT rely on undeclared capabilities)`,
        },
      ],
    };
  }

  // Extension leak: a no-extensions profile got extension-flavored output.
  const leaks: CompatFinding[] = [];
  if ((profile.extensions ?? []).length === 0 && exchange.errorCode === undefined) {
    const result = isObj(exchange.result) ? exchange.result : undefined;
    const resultType = typeof result?.resultType === "string" ? result.resultType : undefined;
    const metaKeys = isObj(result?._meta) ? Object.keys(result._meta) : [];
    for (const extension of advertisedExtensions) {
      const prefixed = (value: string): boolean => value.startsWith(`${extension}/`);
      if ((resultType !== undefined && prefixed(resultType)) || metaKeys.some(prefixed)) {
        leaks.push({
          ruleId: "degrade.extension_leak",
          class: "violation",
          subject,
          message: `extension "${extension}" surfaced in a response to a profile that advertised no extensions (the supporting party MUST revert to core behavior or reject)`,
        });
      }
    }
  }

  if (exchange.errorCode === -32021) {
    const data = exchange.errorData;
    const missing = isObj(data) && Array.isArray(data.missing)
      ? data.missing.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (missing.length === 0) {
      return {
        verdict: "violation",
        probeFindings: [
          {
            ruleId: "degrade.wrong_error",
            class: "violation",
            subject,
            message:
              "-32021 MissingRequiredClientCapability without listing the missing capabilities (data.missing)",
          },
        ],
      };
    }
    const declaredAnyway = missing.filter((name) => declared.has(name));
    if (declaredAnyway.length > 0) {
      return {
        verdict: "violation",
        probeFindings: [
          {
            ruleId: "degrade.wrong_error",
            class: "violation",
            subject,
            message: `-32021 names capability(ies) the client DECLARED: ${declaredAnyway.join(", ")}`,
          },
        ],
      };
    }
    const overDeclared = missing.filter((name) => !base.exercised.has(name));
    if (overDeclared.length > 0) {
      return {
        verdict: "violation",
        probeFindings: [
          {
            ruleId: "degrade.over_declared",
            class: "violation",
            subject,
            message: `-32021 names capability(ies) the tool demonstrably never exercises under modern-full: ${overDeclared.join(", ")} — the server gates on capabilities at request entry rather than at use`,
          },
        ],
      };
    }
    return { verdict: "declined-correctly", probeFindings: leaks };
  }

  if (exchange.errorCode !== undefined) {
    // Same failure as the baseline (e.g. a probe that is a planted argument
    // error) is not degradation — the profile changed nothing.
    if (essenceOf(exchange) === base.essence) {
      return { verdict: "ok", probeFindings: leaks };
    }
    return {
      verdict: "violation",
      probeFindings: [
        ...leaks,
        {
          ruleId: "degrade.wrong_error",
          class: "violation",
          subject,
          message: `under ${profile.name} the call failed with ${String(exchange.errorCode)} — a reduced client must get resultType:"complete" or -32021 listing the missing capabilities, never a generic error`,
        },
      ],
    };
  }

  const parsed = WireToolCallResultSchema.safeParse(exchange.result);
  const resultType = parsed.success ? parsed.data.resultType : undefined;
  const isError = parsed.success && parsed.data.isError === true;

  if (isError) {
    return {
      verdict: "violation",
      probeFindings: [
        ...leaks,
        {
          ruleId: "degrade.wrong_error",
          class: "violation",
          subject,
          message: `under ${profile.name} the call returned isError:true prose instead of -32021 (a text blob is not a contract)`,
        },
      ],
    };
  }

  if (resultType === "input_required") {
    const demanded = inputRequestMethods(exchange.result).map(capabilityOfMethod);
    const undeclared = [...new Set(demanded.filter((name) => !declared.has(name)))];
    if (undeclared.length > 0) {
      return {
        verdict: "violation",
        probeFindings: [
          ...leaks,
          {
            ruleId: "degrade.input_required_without_capability",
            class: "violation",
            subject,
            message: `resultType:"input_required" demands ${undeclared.join(", ")} from a client that advertised none of it`,
          },
        ],
      };
    }
    return { verdict: "ok", probeFindings: leaks };
  }

  if (essenceOf(exchange) === base.essence) {
    return { verdict: "ok", probeFindings: leaks };
  }

  const marker = degradedMarker(exchange.result);
  if (marker !== undefined) {
    return {
      verdict: "degraded-reported",
      probeFindings: [
        ...leaks,
        {
          ruleId: "degrade.reported",
          class: "info",
          subject,
          message: `under ${profile.name} the result degrades and SAYS SO (_meta["${DEGRADED_META_KEY}"]: ${marker.join(", ") || "(empty)"})`,
        },
      ],
    };
  }
  return {
    verdict: "degraded-silent",
    probeFindings: [
      ...leaks,
      {
        ruleId: "degrade.silent",
        class: "risky",
        subject,
        message: `under ${profile.name} the result differs in shape from modern-full with NO signal — permitted by the spec, so reported at risky; exactly what the board exists to publish`,
      },
    ],
  };
}

async function toolNameSet(
  transport: Transport,
  track?: (exchange: RpcExchange) => RpcExchange,
): Promise<string | undefined> {
  const session = new ProbeSession(transport);
  try {
    const exchange = await session.call("tools/list");
    track?.(exchange);
    if (exchange.errorCode !== undefined) return undefined;
    const parsed = WireToolsListSchema.safeParse(exchange.result);
    if (!parsed.success) return undefined;
    return parsed.data.tools
      .map((tool) => tool.name)
      .sort()
      .join("\n");
  } catch {
    return undefined;
  }
}

function describeXhdrViolation(violation: string): string {
  switch (violation) {
    case "empty":
      return "is empty";
    case "control_char":
      return "contains a control character";
    case "not_token":
      return "is not an RFC 9110 token";
    case "non_primitive":
      return "binds a non-primitive value (number is not permitted)";
    case "unsafe_integer":
      return "involves an unsafe integer";
    case "not_statically_reachable":
      return "is not statically reachable (the chain must be properties keys only)";
    default:
      return `violates ${violation}`;
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
