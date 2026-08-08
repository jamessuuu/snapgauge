/**
 * `record` (SPEC §4): probe a target through the injected Transport and
 * build a v1 snapshot. Pure core — no clock (recordedAt is injected), no
 * I/O (the transport is the only way out), no process state.
 *
 * Probe surface: server/discover + tools/list (3 repeats, SPEC §6:
 * instability becomes data — orderStable — instead of a false breaking
 * finding) + one tools/call per declared probe (SPEC §2 `behavior`,
 * shape-captured by default per Decision 1).
 */
import { SnapgaugeError } from "./errors.js";
import type { Json, JsonObject } from "./json.js";
import { jcsCanonical } from "./json.js";
import {
  BUILTIN_VOLATILE_SELECTORS,
  normalizeVolatile,
  normalizeVolatileKeys,
  probeSpecHash,
  type ProbeDecl,
  type ProbeSpec,
} from "./snapshot/canonical.js";
import {
  FORMAT_VERSION,
  RULESET_VERSION,
  SnapshotV1Schema,
  type SnapshotBehaviorProbe,
  type SnapshotTarget,
  type SnapshotTool,
  type SnapshotV1,
} from "./snapshot/schema.js";
import { analyzeXmcpHeaders } from "./compat/xhdr.js";
import { shapeOf } from "./snapshot/shape.js";
import { sha256Hex } from "./sha256.js";
import { ProbeSession, type RpcExchange } from "./session.js";
import type { Transport } from "./transport.js";
import { SNAPGAUGE_VERSION } from "./version.js";
import {
  WireDiscoverSchema,
  WireToolCallResultSchema,
  WireToolsListSchema,
  type WireTool,
} from "./wire.js";

/** 3 repeats per list (SPEC §6): order churn becomes `orderStable: false`. */
const LIST_REPEATS = 3;
/** Hard cap on pagination follow — a runaway cursor is a probe failure. */
const MAX_LIST_PAGES = 32;

export interface RecordOptions {
  transport: Transport;
  target: SnapshotTarget;
  probeSpec: ProbeSpec;
  /** ISO 8601 — injected; core has no clock. */
  recordedAt: string;
  /** Sent as `_meta.clientCapabilities` on every tools/call (the revision's
   * stateless capability declaration). Defaults to none declared. */
  clientCapabilities?: JsonObject;
  /** Defaults to the build's own version. */
  snapgaugeVersion?: string;
  /** User volatile selectors, merged with the built-in list (SPEC §2). */
  volatile?: readonly string[];
}

/** A probe that failed at the TRANSPORT level (SPEC §6: missing evidence). */
export interface ProbeFailure {
  probeId: string;
  message: string;
}

export interface RecordOutcome {
  snapshot: SnapshotV1;
  /**
   * Non-empty when a declared probe could not produce evidence (5xx,
   * timeout, malformed envelope). The gate treats missing evidence as NOT
   * passing (exit 2), never as "no change" (SPEC §6).
   */
  probeFailures: ProbeFailure[];
}

export async function record(options: RecordOptions): Promise<RecordOutcome> {
  const session = new ProbeSession(options.transport);

  const discover = session.parseResult(
    WireDiscoverSchema,
    await session.rpc("server/discover"),
    "server/discover",
  );

  const first = await observeToolsList(session);
  let orderStable = true;
  for (let i = 1; i < LIST_REPEATS; i++) {
    const repeat = await observeToolsList(session);
    if (!sameOrder(first.order, repeat.order)) orderStable = false;
  }

  const tools = [...first.tools]
    .map(toSnapshotTool)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const { behavior, probeFailures } = await runBehaviorProbes(
    session,
    options.probeSpec.probes,
    options.clientCapabilities ?? {},
  );

  const built: unknown = {
    formatVersion: FORMAT_VERSION,
    snapgaugeVersion: options.snapgaugeVersion ?? SNAPGAUGE_VERSION,
    rulesetVersion: RULESET_VERSION,
    probeSpecHash: probeSpecHash(options.probeSpec),
    recordedAt: options.recordedAt,
    target: options.target,
    discover: {
      supportedVersions: discover.supportedVersions,
      capabilities: discover.capabilities ?? {},
      serverInfo: { name: discover.serverInfo.name, version: discover.serverInfo.version },
      ...(discover.instructions !== undefined ? { instructions: discover.instructions } : {}),
      ...(discover.ttlMs !== undefined ? { ttlMs: discover.ttlMs } : {}),
      ...(discover.cacheScope !== undefined ? { cacheScope: discover.cacheScope } : {}),
    },
    tools,
    toolsList: {
      order: first.order,
      pages: first.pages,
      ...(first.ttlMs !== undefined ? { ttlMs: first.ttlMs } : {}),
      ...(first.cacheScope !== undefined ? { cacheScope: first.cacheScope } : {}),
      orderStable,
    },
    ...(Object.keys(behavior).length > 0 ? { behavior } : {}),
  };

  const userSelectors = options.volatile ?? [];
  const normalized = normalizeVolatile(built, [...BUILTIN_VOLATILE_SELECTORS, ...userSelectors]);

  const parsed = SnapshotV1Schema.safeParse(normalized);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    if (userSelectors.length > 0) {
      throw new SnapgaugeError(
        "USAGE",
        `record produced an invalid snapshot — a volatile selector likely targets a typed snapshot field instead of a captured value (${detail})`,
      );
    }
    throw new SnapgaugeError("INTERNAL", `record built an invalid snapshot: ${detail}`);
  }
  return { snapshot: parsed.data, probeFailures };
}

interface ListObservation {
  tools: WireTool[];
  order: string[];
  pages: number;
  ttlMs?: number;
  cacheScope?: string;
}

async function observeToolsList(session: ProbeSession): Promise<ListObservation> {
  const tools: WireTool[] = [];
  const order: string[] = [];
  let pages = 0;
  let ttlMs: number | undefined;
  let cacheScope: string | undefined;
  let cursor: string | undefined;

  do {
    pages += 1;
    if (pages > MAX_LIST_PAGES) {
      throw new SnapgaugeError(
        "PROBE_FAILURE",
        `tools/list paginated past ${String(MAX_LIST_PAGES)} pages — runaway cursor`,
      );
    }
    const result = session.parseResult(
      WireToolsListSchema,
      await session.rpc("tools/list", cursor !== undefined ? { cursor } : undefined),
      "tools/list",
    );
    if (pages === 1) {
      ttlMs = result.ttlMs;
      cacheScope = result.cacheScope;
    }
    for (const tool of result.tools) {
      tools.push(tool);
      order.push(tool.name);
    }
    cursor = result.nextCursor;
  } while (cursor !== undefined);

  return {
    tools,
    order,
    pages,
    ...(ttlMs !== undefined ? { ttlMs } : {}),
    ...(cacheScope !== undefined ? { cacheScope } : {}),
  };
}

async function runBehaviorProbes(
  session: ProbeSession,
  probes: readonly ProbeDecl[],
  clientCapabilities: JsonObject,
): Promise<{ behavior: Record<string, SnapshotBehaviorProbe>; probeFailures: ProbeFailure[] }> {
  const behavior: Record<string, SnapshotBehaviorProbe> = {};
  const probeFailures: ProbeFailure[] = [];
  for (const probe of probes) {
    let exchange: RpcExchange;
    try {
      exchange = await session.call("tools/call", {
        name: probe.tool,
        arguments: probe.arguments as JsonObject,
        // The revision's stateless capability declaration: tools/call MUST
        // carry _meta; clientCapabilities rides on it (SPEC §5 D-group).
        _meta: { clientCapabilities },
      });
    } catch (error) {
      // SPEC §6: the probe is marked failed, the REMAINING probes still run,
      // and the caller treats missing evidence as not passing (exit 2).
      probeFailures.push({
        probeId: probe.id,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    behavior[probe.id] = captureBehavior(probe, exchange);
  }
  return { behavior, probeFailures };
}

function captureBehavior(probe: ProbeDecl, exchange: RpcExchange): SnapshotBehaviorProbe {
  const base = {
    httpStatus: exchange.status,
    ...(exchange.contentType !== undefined ? { contentType: exchange.contentType } : {}),
  };
  if (exchange.errorCode !== undefined) {
    return { ...base, isError: true, errorCode: exchange.errorCode };
  }
  const parsed = WireToolCallResultSchema.safeParse(exchange.result);
  if (!parsed.success) {
    // A non-object result is still observable behavior — capture its shape.
    return {
      ...base,
      isError: false,
      structuredShape: shapeOf(exchange.result ?? null),
    };
  }
  const result = parsed.data;
  const values = probe.capture === "values";
  const capture: SnapshotBehaviorProbe = {
    ...base,
    isError: result.isError ?? false,
  };
  if (result.resultType !== undefined) capture.resultType = result.resultType;
  if (result.content !== undefined) {
    capture.contentBlocks = result.content.map((block) => captureBlock(block, values));
  }
  if (result.structuredContent !== undefined) {
    if (values) {
      capture.structuredContent = normalizeVolatileKeys(result.structuredContent) as JsonObject;
    } else {
      capture.structuredShape = shapeOf(result.structuredContent);
    }
  }
  if (result._meta !== undefined) capture.metaKeys = Object.keys(result._meta).sort();
  return capture;
}

function captureBlock(block: Record<string, Json>, values: boolean): Json {
  // normalizeVolatileKeys preserves Json-ness (it only replaces leaves with
  // string tokens); the unknown signature exists for pre-validation callers.
  if (values) return normalizeVolatileKeys(block) as Json;
  const { type, ...rest } = block;
  if (type === "text" && typeof rest.text === "string") {
    // Decision 1: text blocks are stored as {type:"text", sha256} — they
    // cannot leak customer data out of a tool response.
    return { type: "text", sha256: sha256Hex(rest.text) };
  }
  return {
    type: typeof type === "string" ? type : jcsCanonical(type),
    shape: shapeOf(rest),
  };
}

function toSnapshotTool(tool: WireTool): SnapshotTool {
  // X-group static analysis is recorded per tool (SPEC §2 xmcpHeaders) —
  // present only when the tool declares bindings, so binding-free snapshots
  // stay noise-free.
  const xmcpHeaders = analyzeXmcpHeaders(tool.inputSchema);
  return {
    name: tool.name,
    ...(tool.title !== undefined ? { title: tool.title } : {}),
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
    ...(tool.icons !== undefined ? { icons: tool.icons } : {}),
    ...(tool._meta !== undefined ? { _meta: tool._meta } : {}),
    ...(xmcpHeaders.length > 0 ? { xmcpHeaders } : {}),
  };
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}
