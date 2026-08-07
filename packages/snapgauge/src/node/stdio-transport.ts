/**
 * The `stdio` transport (SPEC §4): spawn a local MCP server and speak
 * newline-delimited JSON-RPC over its stdin/stdout. Contracts (SPEC §6):
 * 10s per-request timeout, SIGKILL on teardown, no orphan processes
 * (e2e-verified). HTTP-only assertions report `n/a (stdio)` — this
 * transport deliberately exposes no raw() capability.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { SnapgaugeError } from "../core/errors.js";
import { JsonValueSchema, type Json } from "../core/json.js";
import { JsonRpcResponseSchema } from "../core/jsonrpc.js";
import type { Transport, TransportResponse } from "../core/transport.js";

export interface StdioTransportOptions {
  command: string;
  args?: readonly string[];
  /** Per-request timeout; default 10s (SPEC §6). */
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface StdioTransport extends Transport {
  close(): Promise<void>;
  /** For e2e orphan checks: the child pid once spawned. */
  pid(): number | undefined;
}

interface Pending {
  resolve(value: Json): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export function createStdioTransport(options: StdioTransportOptions): StdioTransport {
  const timeoutMs = options.timeoutMs ?? 10_000;
  let child: ChildProcessWithoutNullStreams | undefined;
  let buffer = "";
  let exited = false;
  let spawnError: Error | undefined;
  const pending = new Map<number | string, Pending>();

  function ensureChild(): ChildProcessWithoutNullStreams {
    if (child !== undefined) return child;
    child = spawn(options.command, [...(options.args ?? [])], {
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
    });
    child.on("error", (error) => {
      spawnError = error;
      failAll(new SnapgaugeError("PROBE_FAILURE", `stdio server failed to start: ${error.message}`));
    });
    child.on("exit", () => {
      exited = true;
      failAll(new SnapgaugeError("PROBE_FAILURE", "stdio server exited mid-conversation"));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.trim() !== "") handleLine(line);
        newline = buffer.indexOf("\n");
      }
    });
    // stderr is drained (a blocked pipe would hang the child) but not
    // interpreted; server logs are the server's business.
    child.stderr.resume();
    return child;
  }

  function handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // non-JSON noise on stdout — ignore, the timeout is the backstop
    }
    const envelope = JsonRpcResponseSchema.safeParse(parsed);
    if (!envelope.success) return;
    const id = envelope.data.id;
    if (id === null) return;
    const waiter = pending.get(id);
    if (waiter === undefined) return;
    pending.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(JsonValueSchema.parse(parsed));
  }

  function failAll(error: Error): void {
    for (const [id, waiter] of pending) {
      pending.delete(id);
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  function kill(): void {
    if (child !== undefined && !exited) {
      // SPEC §6: SIGKILL on teardown — no graceful-shutdown negotiation with
      // a server that may already be hung.
      child.kill("SIGKILL");
    }
  }

  return {
    send(rpcRequest): Promise<TransportResponse> {
      if (spawnError !== undefined) {
        return Promise.reject(
          new SnapgaugeError("PROBE_FAILURE", `stdio server failed to start: ${spawnError.message}`),
        );
      }
      const proc = ensureChild();
      return new Promise<TransportResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(rpcRequest.id);
          kill();
          reject(
            new SnapgaugeError(
              "PROBE_TIMEOUT",
              `stdio server did not answer ${rpcRequest.method} within ${String(timeoutMs)}ms — killed (SPEC §6)`,
            ),
          );
        }, timeoutMs);
        pending.set(rpcRequest.id, {
          resolve: (body) => {
            // stdio has no HTTP layer: status 200 is the synthesized "the
            // envelope arrived" — real failures reject instead.
            resolve({ status: 200, headers: {}, body });
          },
          reject,
          timer,
        });
        proc.stdin.write(`${JSON.stringify(rpcRequest)}\n`, (error) => {
          if (error !== null && error !== undefined) {
            const waiter = pending.get(rpcRequest.id);
            if (waiter !== undefined) {
              pending.delete(rpcRequest.id);
              clearTimeout(waiter.timer);
              waiter.reject(
                new SnapgaugeError("PROBE_FAILURE", `stdio write failed: ${error.message}`),
              );
            }
          }
        });
      });
    },

    close(): Promise<void> {
      failAll(new SnapgaugeError("PROBE_FAILURE", "transport closed"));
      if (child === undefined || exited) return Promise.resolve();
      const proc = child;
      return new Promise<void>((resolve) => {
        proc.once("exit", () => {
          resolve();
        });
        kill();
        // Belt-and-suspenders: never hang teardown on a zombie.
        setTimeout(resolve, 2000).unref();
      });
    },

    pid(): number | undefined {
      return child?.pid;
    },
  };
}
