/**
 * `record` (SPEC §4): probe a target through the injected Transport and
 * build a v1 snapshot. Pure core — no clock (recordedAt is injected), no
 * I/O (the transport is the only way out), no process state.
 *
 * M1 probe surface: server/discover + tools/list (3 repeats, SPEC §6:
 * instability becomes data — orderStable — instead of a false breaking
 * finding). Resources/prompts/behavior probes land at M2.
 */
import type { ZodType } from "zod";
import { SnapgaugeError } from "./errors.js";
import type { Json } from "./json.js";
import { JsonRpcResponseSchema } from "./jsonrpc.js";
import {
  BUILTIN_VOLATILE_SELECTORS,
  normalizeVolatile,
  probeSpecHash,
  type ProbeSpec,
} from "./snapshot/canonical.js";
import {
  FORMAT_VERSION,
  RULESET_VERSION,
  SnapshotV1Schema,
  type SnapshotTarget,
  type SnapshotTool,
  type SnapshotV1,
} from "./snapshot/schema.js";
import type { Transport } from "./transport.js";
import { SNAPGAUGE_VERSION } from "./version.js";
import { WireDiscoverSchema, WireToolsListSchema, type WireTool } from "./wire.js";

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
  /** Defaults to the build's own version. */
  snapgaugeVersion?: string;
  /** User volatile selectors, merged with the built-in list (SPEC §2). */
  volatile?: readonly string[];
}

export async function record(options: RecordOptions): Promise<SnapshotV1> {
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
  return parsed.data;
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

function toSnapshotTool(tool: WireTool): SnapshotTool {
  return {
    name: tool.name,
    ...(tool.title !== undefined ? { title: tool.title } : {}),
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
    ...(tool.icons !== undefined ? { icons: tool.icons } : {}),
    ...(tool._meta !== undefined ? { _meta: tool._meta } : {}),
  };
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

class ProbeSession {
  private nextId = 1;

  constructor(private readonly transport: Transport) {}

  async rpc(method: string, params?: Record<string, Json>): Promise<Json> {
    let response;
    try {
      response = await this.transport.send({
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        ...(params !== undefined ? { params } : {}),
      });
    } catch (cause) {
      throw new SnapgaugeError("PROBE_FAILURE", `${method}: transport failure`, { cause });
    }
    if (response.status !== 200) {
      throw new SnapgaugeError("PROBE_FAILURE", `${method}: HTTP ${String(response.status)}`);
    }
    const envelope = JsonRpcResponseSchema.safeParse(response.body);
    if (!envelope.success) {
      throw new SnapgaugeError("PROBE_FAILURE", `${method}: malformed JSON-RPC envelope`);
    }
    if ("error" in envelope.data) {
      const { code, message } = envelope.data.error;
      throw new SnapgaugeError(
        "PROBE_FAILURE",
        `${method}: server error ${String(code)}: ${message}`,
      );
    }
    return envelope.data.result;
  }

  parseResult<T>(schema: ZodType<T>, result: Json, method: string): T {
    const parsed = schema.safeParse(result);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new SnapgaugeError("PROBE_FAILURE", `${method}: malformed result (${detail})`);
    }
    return parsed.data;
  }
}
