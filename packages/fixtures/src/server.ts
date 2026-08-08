/**
 * Shared fixture-server builder: turns a declarative surface into a pure
 * `(request, profile) => response` function (SPEC §7). Fixtures hold no
 * state — the same request always yields the same response, which is what
 * makes the 3-repeat order probe (SPEC §6) trivially stable here.
 *
 * `makeRawHandler` is the CONFORMANT Streamable HTTP framing wrapped around
 * a fixture — the behavior the T-group assertions (SPEC §5) expect.
 * Nonconformant fixtures (M4) override it deliberately.
 */
/* eslint-disable @typescript-eslint/consistent-type-definitions --
   These MUST be type aliases, not interfaces: TypeScript grants implicit
   index signatures to object type aliases only, and fixture definitions
   must be assignable to Json to go over the wire. */
import type {
  FixtureRawHandler,
  FixtureResponse,
  FixtureServer,
  Json,
  JsonObject,
  JsonRpcRequest,
  ProbeDecl,
  Profile,
  RawHttpRequest,
  RawHttpResponse,
} from "snapgauge";

/** Json-compatible tool definition (type aliases, so it assigns to Json). */
export type ToolDef = {
  name: string;
  title?: string;
  description: string;
  inputSchema: InputSchemaDef;
  outputSchema?: JsonObject;
  icons?: Json[];
  annotations?: JsonObject;
  _meta?: JsonObject;
  /** tools/call behavior — omitted tools answer with a generic complete result. */
  call?: ToolCallFn;
};

export type ToolCallFn = (args: JsonObject, profile: Profile) => ToolCallOutcome;

export type ToolCallOutcome =
  | { result: JsonObject }
  | { error: { code: number; message: string; data?: Json } };

export type InputSchemaDef = {
  type: "object";
  properties: Record<string, JsonObject>;
  required?: string[];
  additionalProperties: boolean;
};

export type SurfaceDef = {
  serverInfo: { name: string; version: string };
  supportedVersions: string[];
  capabilities: JsonObject;
  instructions: string;
  ttlMs: number;
  cacheScope: string;
  /** Array order = observed tools/list order. */
  tools: ToolDef[];
  /**
   * Error code for failed required-argument validation; default -32602.
   * drift-error-code@v2 overrides it (SPEC §5 error.code.changed).
   */
  validationErrorCode?: number;
};

/** A registry entry: the server plus its declared probes and raw framing. */
export type FixtureEntry = {
  server: FixtureServer;
  probes: ProbeDecl[];
  raw: FixtureRawHandler;
};

export function makeServer(surface: SurfaceDef): FixtureServer {
  return (request: JsonRpcRequest, profile, headers): FixtureResponse => {
    switch (request.method) {
      case "server/discover":
        return ok(request, {
          supportedVersions: surface.supportedVersions,
          capabilities: surface.capabilities,
          serverInfo: surface.serverInfo,
          instructions: surface.instructions,
          ttlMs: surface.ttlMs,
          cacheScope: surface.cacheScope,
        });
      case "tools/list":
        return ok(request, {
          tools: surface.tools.map(toolJson),
          ttlMs: surface.ttlMs,
          cacheScope: surface.cacheScope,
        });
      case "tools/call":
        return handleToolCall(surface, request, profile, headers);
      case "initialize":
        // Modern-only fixtures reject legacy initialize the HELPFUL way:
        // naming their supported versions (SPEC §5
        // compat.legacy_error_unhelpful is the server that does not).
        return rpcError(request, -32601, "initialize is a legacy method; this server is modern-only", {
          supported: surface.supportedVersions,
        });
      default:
        return rpcError(request, -32601, `method not found: ${request.method}`);
    }
  };
}

function handleToolCall(
  surface: SurfaceDef,
  request: JsonRpcRequest,
  profile: Profile,
  headers?: Record<string, string>,
): FixtureResponse {
  const params = request.params;
  if (params === undefined || typeof params.name !== "string") {
    return rpcError(request, -32602, "tools/call requires params.name");
  }
  // 2026-07-28 revision: tools/call MUST carry _meta (the stateless client
  // declaration) — its absence is -32602 (SPEC §5 meta_missing_not_32602).
  if (typeof params._meta !== "object" || params._meta === null || Array.isArray(params._meta)) {
    return rpcError(request, -32602, "tools/call requires _meta");
  }
  const tool = surface.tools.find((t) => t.name === params.name);
  if (tool === undefined) {
    return rpcError(request, -32602, `unknown tool: ${params.name}`);
  }
  const args = isObject(params.arguments) ? params.arguments : {};
  // Conformant x-mcp-header handling (SPEC §5 X-group live checks): a bound
  // parameter present in BOTH body and header with different values MUST be
  // rejected with -32020; an absent value must never demand its header.
  const lowered: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value !== "") lowered[name.toLowerCase()] = value;
  }
  for (const [property, schema] of Object.entries(tool.inputSchema.properties)) {
    const bound = schema["x-mcp-header"];
    if (typeof bound !== "string" || bound === "") continue;
    const headerValue = lowered[bound.toLowerCase()];
    const argString = primitiveString(args[property]);
    if (argString !== undefined && headerValue !== undefined && argString !== headerValue) {
      return rpcError(request, -32020, `header ${bound} disagrees with argument "${property}"`);
    }
  }
  for (const required of tool.inputSchema.required ?? []) {
    if (!(required in args)) {
      return rpcError(
        request,
        surface.validationErrorCode ?? -32602,
        `missing required argument: ${required}`,
      );
    }
  }
  const outcome: ToolCallOutcome =
    tool.call !== undefined
      ? tool.call(args, profile)
      : {
          result: {
            resultType: "complete",
            content: [{ type: "text", text: `${tool.name}: ok` }],
          },
        };
  if ("error" in outcome) {
    return rpcError(
      request,
      outcome.error.code,
      outcome.error.message,
      outcome.error.data,
    );
  }
  return ok(request, outcome.result);
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only primitives round-trip through a header value — objects/arrays never
 * do (x-mcp-header bindings are constrained to string|boolean|integer). */
function primitiveString(value: Json | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function toolJson(tool: ToolDef): Json {
  return {
    name: tool.name,
    ...(tool.title !== undefined ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.icons !== undefined ? { icons: tool.icons } : {}),
    ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
    ...(tool._meta !== undefined ? { _meta: tool._meta } : {}),
  };
}

function ok(request: JsonRpcRequest, result: Json): FixtureResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { jsonrpc: "2.0", id: request.id, result },
  };
}

function rpcError(
  request: JsonRpcRequest,
  code: number,
  message: string,
  data?: Json,
): FixtureResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: {
      jsonrpc: "2.0",
      id: request.id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    },
  };
}

/** The MCP-Name base64 sentinel: `=?base64?<payload>?=` (SPEC §5). */
function decodeMcpName(header: string): string {
  const match = /^=\?base64\?(.*)\?=$/.exec(header);
  if (match === null) return header;
  try {
    return atob(match[1] ?? "");
  } catch {
    return header;
  }
}

/**
 * Conformant Streamable HTTP framing around a fixture server — every
 * T-group assertion passes here (the clean-fixture negative case). Options
 * carry what the framing layer must know about the surface.
 */
export function makeRawHandler(server: FixtureServer, surface: SurfaceDef): FixtureRawHandler {
  return (raw: RawHttpRequest, profile: Profile): RawHttpResponse => {
    const headers = lowercaseHeaders(raw.headers);
    if (raw.method === "GET" || raw.method === "DELETE") {
      return text(405, { allow: "POST" }, "method not allowed");
    }
    if (raw.method !== "POST") {
      return text(405, { allow: "POST" }, "method not allowed");
    }
    // Origin validation (DNS-rebinding defense): non-local origins are 403.
    const origin = headers.origin;
    if (origin !== undefined && !isLocalOrigin(origin)) {
      return text(403, {}, "forbidden origin");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.bodyText ?? "");
    } catch {
      return text(400, {}, "invalid JSON body");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return text(400, {}, "invalid JSON-RPC body");
    }
    const body = parsed as Record<string, unknown>;
    // A lone notification MUST be answered 202 Accepted (SPEC §5).
    if (!("id" in body)) {
      return { status: 202, headers: {}, bodyText: "" };
    }
    // MCP-Name: absent → accepted; present → decode the base64 sentinel,
    // then compare; mismatch MUST be rejected with -32020 (SPEC §5).
    const mcpName = headers["mcp-name"];
    if (mcpName !== undefined && decodeMcpName(mcpName) !== surface.serverInfo.name) {
      return jsonError(400, body.id, -32020, "MCP-Name does not match this server");
    }
    // MCP-Protocol-Version: absent → accepted (assume current); present but
    // unsupported → -32022 with data.supported non-empty (SPEC §5).
    const version = headers["mcp-protocol-version"];
    if (version !== undefined && !surface.supportedVersions.includes(version)) {
      return jsonError(400, body.id, -32022, "unsupported protocol version", {
        supported: surface.supportedVersions,
      });
    }
    // Header/body version mismatch MUST be 400 + -32020 HeaderMismatch.
    const params = body.params;
    if (
      version !== undefined &&
      typeof params === "object" &&
      params !== null &&
      !Array.isArray(params) &&
      typeof (params as Record<string, unknown>).protocolVersion === "string" &&
      (params as Record<string, unknown>).protocolVersion !== version
    ) {
      return jsonError(400, body.id, -32020, "MCP-Protocol-Version disagrees with the body");
    }
    // subscriptions/listen: a genuine SSE stream (SPEC §5 sse_no_accel_buffering
    // / sse_no_keepalive) — a periodic ": " comment IS the keepalive, and
    // X-Accel-Buffering: no defeats proxy buffering of the long-lived stream.
    if (body.method === "subscriptions/listen" && headers.accept?.includes("text/event-stream") === true) {
      return {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-accel-buffering": "no" },
        bodyText: ": keepalive\n\nevent: message\ndata: {}\n\n",
      };
    }
    // Mcp-Session-Id MUST be ignored: never echoed, never minted.
    const rpcRequest = body as unknown as JsonRpcRequest;
    const response = server(rpcRequest, profile, headers);
    return {
      status: response.status,
      headers: response.headers,
      bodyText: JSON.stringify(response.body),
    };
  };
}

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  } catch {
    return origin === "null";
  }
}

function lowercaseHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === "") continue; // empty = suppressed header (absence probe)
    out[name.toLowerCase()] = value;
  }
  return out;
}

function text(status: number, headers: Record<string, string>, bodyText: string): RawHttpResponse {
  return { status, headers: { "content-type": "text/plain", ...headers }, bodyText };
}

function jsonError(
  status: number,
  id: unknown,
  code: number,
  message: string,
  data?: Json,
): RawHttpResponse {
  const rpcId: Json = typeof id === "number" || typeof id === "string" ? id : null;
  return {
    status,
    headers: { "content-type": "application/json" },
    bodyText: JSON.stringify({
      jsonrpc: "2.0",
      id: rpcId,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    }),
  };
}

/** Assemble a registry entry with conformant framing and declared probes. */
export function makeEntry(surface: SurfaceDef, probes: ProbeDecl[]): FixtureEntry {
  const server = makeServer(surface);
  return { server, probes, raw: makeRawHandler(server, surface) };
}

/** Find a tool by name in a mutable surface, or throw (drift builders only). */
export function mustFind(tools: ToolDef[], name: string): ToolDef {
  const tool = tools.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`fixture drift builder: no tool named "${name}"`);
  return tool;
}

export function removeTool(tools: ToolDef[], name: string): void {
  const index = tools.findIndex((t) => t.name === name);
  if (index === -1) throw new Error(`fixture drift builder: no tool named "${name}"`);
  tools.splice(index, 1);
}
