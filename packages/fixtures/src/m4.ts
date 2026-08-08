/**
 * M4 fixtures (SPEC §7 + §10): the compat engine's eval subjects.
 *
 * - degrader-honest — degrades under reduced profiles and SAYS SO
 *   (_meta["mcp/degraded"]), plus a tool that declines correctly (-32021
 *   listing exactly the missing capability it demonstrably uses).
 * - degrader-silent — same degradation, no signal at all (risky, exit 1).
 * - degrader-liar — the director's edge case: -32021 naming `sampling` it
 *   never uses, plus resultType:"input_required" demanding
 *   elicitation/create from a client that advertised none (exit 3).
 * - nonconformant-legacy — mints Mcp-Session-Id, answers GET with SSE, no
 *   resultType, no ttlMs, no server/discover.
 * - paginated — mismatched cacheScope on page 2.
 * - bad-x-mcp-header — seven tools, one violated constraint each.
 * - xhdr-live-bad — accepts a param/header mismatch and demands a header
 *   for an absent value (the two X-group LIVE checks).
 */
import type {
  FixtureRawHandler,
  FixtureServer,
  Json,
  JsonObject,
  JsonRpcRequest,
  ProbeDecl,
  Profile,
  RawHttpResponse,
} from "snapgauge";
import {
  makeEntry,
  makeRawHandler,
  makeServer,
  type FixtureEntry,
  type SurfaceDef,
  type ToolDef,
} from "./server.ts";

const MODERN = "2026-07-28";

function hasCapability(profile: Profile, name: string): boolean {
  return Object.hasOwn(profile.clientCapabilities, name);
}

function baseSurface(name: string, tools: ToolDef[]): SurfaceDef {
  return {
    serverInfo: { name, version: "1.0.0" },
    supportedVersions: [MODERN],
    capabilities: { tools: { listChanged: false } },
    instructions: `${name} fixture server.`,
    ttlMs: 30000,
    cacheScope: "public",
    tools,
  };
}

// ---------------------------------------------------------------------------
// degraders

function summarizeTool(report: boolean): ToolDef {
  return {
    name: "summarize_note",
    description: "Summarize a note; confirms nuance with the user when elicitation is available.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    call: (_args, profile) => {
      if (hasCapability(profile, "elicitation")) {
        return {
          result: {
            resultType: "complete",
            content: [{ type: "text", text: "Summary (confirmed with you): meeting notes." }],
            structuredContent: { summary: "meeting notes", confirmed: true },
          },
        };
      }
      return {
        result: {
          resultType: "complete",
          content: [{ type: "text", text: "Summary (unconfirmed): meeting notes." }],
          structuredContent: { summary: "meeting notes" },
          ...(report ? { _meta: { "mcp/degraded": ["elicitation"] } } : {}),
        },
      };
    },
  };
}

/** Declines CORRECTLY: -32021 naming exactly the capability it demonstrably
 * exercises under modern-full (input_required -> elicitation/create). */
function redactTool(): ToolDef {
  return {
    name: "redact_note",
    description: "Redact a note — requires user confirmation via elicitation.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    call: (_args, profile) => {
      if (hasCapability(profile, "elicitation")) {
        return {
          result: {
            resultType: "input_required",
            inputRequests: [{ method: "elicitation/create", prompt: "Confirm redaction of n1" }],
          },
        };
      }
      return {
        error: {
          code: -32021,
          message: "missing required client capability",
          data: { missing: ["elicitation"] },
        },
      };
    },
  };
}

function degraderProbes(): ProbeDecl[] {
  return [
    { id: "summarize", tool: "summarize_note", arguments: { id: "n1" }, capture: "shape" },
    { id: "redact", tool: "redact_note", arguments: { id: "n1" }, capture: "shape" },
  ];
}

export const degraderHonest: FixtureEntry = makeEntry(
  baseSurface("degrader-honest", [summarizeTool(true), redactTool()]),
  degraderProbes(),
);

export const degraderSilent: FixtureEntry = makeEntry(
  baseSurface("degrader-silent", [summarizeTool(false), redactTool()]),
  degraderProbes(),
);

/** The liar: gates summarize on `sampling` AT REQUEST ENTRY (it never uses
 * it), and demands elicitation from clients that advertised none. */
function liarSummarize(): ToolDef {
  return {
    name: "summarize_note",
    description: "Summarize a note.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    call: (_args, profile) => {
      if (!hasCapability(profile, "sampling")) {
        // PLANT (degrade.over_declared): sampling is never exercised under
        // modern-full — this gate is at request entry, not at use.
        return {
          error: {
            code: -32021,
            message: "missing required client capability",
            data: { missing: ["sampling"] },
          },
        };
      }
      return {
        result: {
          resultType: "complete",
          content: [{ type: "text", text: "Summary: meeting notes." }],
          structuredContent: { summary: "meeting notes" },
        },
      };
    },
  };
}

function liarConfirmDelete(): ToolDef {
  return {
    name: "confirm_delete",
    description: "Delete a note after user confirmation.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    // PLANT (degrade.input_required_without_capability): demands
    // elicitation/create REGARDLESS of what the client advertised.
    call: () => ({
      result: {
        resultType: "input_required",
        inputRequests: [{ method: "elicitation/create", prompt: "Really delete n1?" }],
      },
    }),
  };
}

export const degraderLiar: FixtureEntry = makeEntry(
  baseSurface("degrader-liar", [liarSummarize(), liarConfirmDelete()]),
  [
    { id: "summarize", tool: "summarize_note", arguments: { id: "n1" }, capture: "shape" },
    { id: "confirm", tool: "confirm_delete", arguments: { id: "n1" }, capture: "shape" },
  ],
);

// ---------------------------------------------------------------------------
// nonconformant-legacy (SPEC §7): mints Mcp-Session-Id, answers GET with
// SSE, no resultType, no ttlMs, and no server/discover at all.

function nonconformantServer(): FixtureServer {
  return (request: JsonRpcRequest) => {
    const ok = (result: Json) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { jsonrpc: "2.0", id: request.id, result } as Json,
    });
    switch (request.method) {
      case "initialize":
        return ok({
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "nonconformant-legacy", version: "0.9.0" },
        });
      case "tools/list":
        // No ttlMs, no cacheScope (cache_hints_missing).
        return ok({
          tools: [
            {
              name: "legacy_echo",
              description: "Echo back a payload.",
              inputSchema: { type: "object", properties: {}, additionalProperties: true },
            },
          ],
        });
      case "tools/call":
        // Accepts calls WITHOUT _meta (meta_missing_not_32602) and answers
        // without resultType (result_type_absent).
        return ok({ content: [{ type: "text", text: "echo" }] });
      default:
        // server/discover lands here too: not implemented (-32601).
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32601, message: `method not found: ${request.method}` },
          },
        };
    }
  };
}

function nonconformantRaw(server: FixtureServer): FixtureRawHandler {
  return (raw, profile): RawHttpResponse => {
    if (raw.method === "GET") {
      // Answers GET with SSE — fails get_not_405 AND, with Last-Event-ID,
      // behaves as a resumable stream (last_event_id_honored).
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        bodyText: "event: message\ndata: {}\n\n",
      };
    }
    if (raw.method === "DELETE") {
      return { status: 405, headers: { allow: "POST" }, bodyText: "method not allowed" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.bodyText ?? "");
    } catch {
      return { status: 400, headers: {}, bodyText: "bad json" };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { status: 400, headers: {}, bodyText: "bad body" };
    }
    const body = parsed as Record<string, unknown>;
    if (!("id" in body)) return { status: 202, headers: {}, bodyText: "" };
    // NO version / MCP-Name / Origin validation of any kind — and every
    // response mints a session id (session_id_echoed).
    const response = server(body as unknown as JsonRpcRequest, profile);
    return {
      status: response.status,
      headers: { ...response.headers, "mcp-session-id": "legacy-session-1" },
      bodyText: JSON.stringify(response.body),
    };
  };
}

const nonconformantServerInstance = nonconformantServer();
export const nonconformantLegacy: FixtureEntry = {
  server: nonconformantServerInstance,
  probes: [{ id: "echo", tool: "legacy_echo", arguments: {}, capture: "shape" }],
  raw: nonconformantRaw(nonconformantServerInstance),
};

// ---------------------------------------------------------------------------
// paginated (SPEC §7): mismatched cacheScope on page 2.

function paginatedEntry(): FixtureEntry {
  const surface = baseSurface("paginated", [
    {
      name: "alpha_tool",
      description: "First page tool.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "beta_tool",
      description: "Second page tool.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ]);
  const base = makeServer(surface);
  const server: FixtureServer = (request, profile, headers) => {
    if (request.method !== "tools/list") return base(request, profile, headers);
    const cursor = request.params?.cursor;
    const ok = (result: Json) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { jsonrpc: "2.0", id: request.id, result } as Json,
    });
    const tools = surface.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    if (cursor === undefined) {
      return ok({
        tools: [tools[0] ?? null].filter((t): t is Exclude<typeof t, null> => t !== null),
        nextCursor: "page-2",
        ttlMs: surface.ttlMs,
        cacheScope: "public",
      });
    }
    // PLANT: cacheScope flips on page 2 (MUST be identical on every page).
    return ok({
      tools: [tools[1] ?? null].filter((t): t is Exclude<typeof t, null> => t !== null),
      ttlMs: surface.ttlMs,
      cacheScope: "private",
    });
  };
  return { server, probes: [], raw: makeRawHandler(server, surface) };
}

export const paginated: FixtureEntry = paginatedEntry();

// ---------------------------------------------------------------------------
// bad-x-mcp-header (SPEC §7): seven tools, ONE violated constraint each.

function badXTool(name: string, properties: Record<string, JsonObject>): ToolDef {
  return {
    name,
    description: `x-mcp-header violation showcase: ${name}.`,
    inputSchema: { type: "object", properties, additionalProperties: false },
  };
}

export const badXMcpHeader: FixtureEntry = makeEntry(
  baseSurface("bad-x-mcp-header", [
    badXTool("t_empty", { h: { type: "string", "x-mcp-header": "" } }),
    badXTool("t_control", { h: { type: "string", "x-mcp-header": "X-Bad\u0007" } }),
    badXTool("t_not_token", { h: { type: "string", "x-mcp-header": "X Bad Header" } }),
    badXTool("t_dup", {
      a: { type: "string", "x-mcp-header": "X-Api-Key" },
      b: { type: "string", "x-mcp-header": "x-api-key" },
    }),
    badXTool("t_number", { h: { type: "number", "x-mcp-header": "X-Num" } }),
    badXTool("t_unsafe", { h: { type: "integer", "x-mcp-header": "X-Big", maximum: 1e16 } }),
    badXTool("t_unreachable", {
      opts: {
        type: "object",
        oneOf: [{ properties: { key: { type: "string", "x-mcp-header": "X-Key" } } }],
      },
    }),
  ]),
  [],
);

// ---------------------------------------------------------------------------
// xhdr-live-bad: violates BOTH live checks — accepts a param/header
// mismatch, and rejects an absent value demanding its header.

function xhdrLiveBadEntry(): FixtureEntry {
  const surface = baseSurface("xhdr-live-bad", [
    {
      name: "lookup",
      description: "Look something up in a region.",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string" },
          region: { type: "string", "x-mcp-header": "X-Region" },
        },
        required: ["q"],
        additionalProperties: false,
      },
    },
  ]);
  const base = makeServer(surface);
  const server: FixtureServer = (request, profile, headers) => {
    if (request.method !== "tools/call") return base(request, profile, headers);
    const params = request.params;
    const rpcError = (code: number, message: string): { status: number; headers: Record<string, string>; body: Json } => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { jsonrpc: "2.0", id: request.id, error: { code, message } },
    });
    if (params === undefined || typeof params.name !== "string") {
      return rpcError(-32602, "tools/call requires params.name");
    }
    if (typeof params._meta !== "object" || params._meta === null) {
      return rpcError(-32602, "tools/call requires _meta");
    }
    const args =
      typeof params.arguments === "object" && params.arguments !== null && !Array.isArray(params.arguments)
        ? params.arguments
        : {};
    const lowered: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (value !== "") lowered[name.toLowerCase()] = value;
    }
    // PLANT (xhdr.absent_param_rejected): demands the header when the value
    // is absent.
    if (args.region === undefined && lowered["x-region"] === undefined) {
      return rpcError(-32020, "X-Region header required");
    }
    // PLANT (xhdr.param_mismatch_accepted): silently accepts a body/header
    // disagreement instead of rejecting with -32020.
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          resultType: "complete",
          content: [{ type: "text", text: "42 results" }],
          structuredContent: { hits: 42 },
        },
      },
    };
  };
  return {
    server,
    probes: [
      { id: "lookup", tool: "lookup", arguments: { q: "test", region: "apac" }, capture: "shape" },
    ],
    raw: makeRawHandler(server, surface),
  };
}

export const xhdrLiveBad: FixtureEntry = xhdrLiveBadEntry();
