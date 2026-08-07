/**
 * Shared fixture-server builder: turns a declarative surface into a pure
 * `(request, profile) => response` function (SPEC §7). Fixtures hold no
 * state — the same request always yields the same response, which is what
 * makes the 3-repeat order probe (SPEC §6) trivially stable here.
 */
/* eslint-disable @typescript-eslint/consistent-type-definitions --
   These MUST be type aliases, not interfaces: TypeScript grants implicit
   index signatures to object type aliases only, and fixture definitions
   must be assignable to Json to go over the wire. */
import type {
  FixtureResponse,
  FixtureServer,
  Json,
  JsonObject,
  JsonRpcRequest,
} from "snapgauge";

/** Json-compatible tool definition (type aliases, so it assigns to Json). */
export type ToolDef = {
  name: string;
  title?: string;
  description: string;
  inputSchema: InputSchemaDef;
  icons?: Json[];
  annotations?: JsonObject;
};

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
};

export function makeServer(surface: SurfaceDef): FixtureServer {
  return (request: JsonRpcRequest, _profile): FixtureResponse => {
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
      default:
        return rpcError(request, -32601, `method not found: ${request.method}`);
    }
  };
}

function toolJson(tool: ToolDef): Json {
  return {
    name: tool.name,
    ...(tool.title !== undefined ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.icons !== undefined ? { icons: tool.icons } : {}),
    ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
  };
}

function ok(request: JsonRpcRequest, result: Json): FixtureResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { jsonrpc: "2.0", id: request.id, result },
  };
}

function rpcError(request: JsonRpcRequest, code: number, message: string): FixtureResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { jsonrpc: "2.0", id: request.id, error: { code, message } },
  };
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
