#!/usr/bin/env node
/**
 * Stdio bin (SPEC §3: fixtures are "also exposed as a stdio bin"): serve a
 * fixture over newline-delimited JSON-RPC on stdin/stdout — the `stdio`
 * transport's e2e target (SPEC §10 M2 gate). Node ≥24 runs this .ts file
 * directly (type stripping), so ONLY type-level imports may reference the
 * snapgauge package (runtime imports would hit unbuilt ".js" specifiers).
 *
 *   node packages/fixtures/src/stdio-bin.ts <fixture-name> [--hang]
 *
 * `--hang` accepts requests and never answers — the per-request-timeout /
 * SIGKILL / no-orphans contract (SPEC §6) is proven against it.
 *
 * The client profile is reconstructed per request from `_meta`
 * .clientCapabilities (the revision's stateless declaration) — same rule as
 * the HTTP adapter.
 */
import { createInterface } from "node:readline";
import type { JsonObject, JsonRpcRequest, Profile } from "snapgauge";
import { getFixtureEntry } from "./index.ts";

const args = process.argv.slice(2);
const hang = args.includes("--hang");
const fixtureName = args.find((a) => !a.startsWith("--"));

if (fixtureName === undefined) {
  process.stderr.write("usage: stdio-bin.ts <fixture-name> [--hang]\n");
  process.exit(2);
}
const entry = getFixtureEntry(fixtureName);
if (entry === undefined) {
  process.stderr.write(`unknown fixture: ${fixtureName}\n`);
  process.exit(2);
}
const fixture = entry;

function profileFromRequest(request: Record<string, unknown>): Profile {
  let clientCapabilities: JsonObject = {};
  const params = request.params;
  if (typeof params === "object" && params !== null && !Array.isArray(params)) {
    const meta = (params as Record<string, unknown>)._meta;
    if (typeof meta === "object" && meta !== null && !Array.isArray(meta)) {
      const caps = (meta as Record<string, unknown>).clientCapabilities;
      if (typeof caps === "object" && caps !== null && !Array.isArray(caps)) {
        clientCapabilities = caps as JsonObject;
      }
    }
  }
  return { name: "wire", protocolVersion: "2026-07-28", clientCapabilities };
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line: string) => {
  if (hang) return; // deliberately never answer (timeout e2e)
  if (line.trim() === "") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    process.stderr.write("stdio-bin: non-JSON line ignored\n");
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
  const request = parsed as Record<string, unknown>;
  if (typeof request.method !== "string") return;
  if (!("id" in request)) return; // notification — no reply on stdio
  const response = fixture.server(
    parsed as unknown as JsonRpcRequest,
    profileFromRequest(request),
  );
  process.stdout.write(`${JSON.stringify(response.body)}\n`);
});
