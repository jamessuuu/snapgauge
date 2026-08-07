/**
 * JSON-RPC 2.0 envelope types and the response schemas every transport
 * response is parsed with BEFORE interpretation (SPEC §9: Zod at every
 * boundary — including every JSON-RPC response).
 */
import { z } from "zod";
import { JsonValueSchema, type JsonObject } from "./json.js";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: JsonObject;
}

export const JsonRpcSuccessSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]),
  result: JsonValueSchema,
});

export const JsonRpcErrorSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string(), z.null()]),
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    data: JsonValueSchema.optional(),
  }),
});

export const JsonRpcResponseSchema = z.union([JsonRpcSuccessSchema, JsonRpcErrorSchema]);
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;
