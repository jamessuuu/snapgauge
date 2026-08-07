/**
 * Canonicalization helpers that are part of the FORMAT, not the writer
 * (SPEC §2 Decision 2): volatile-field normalization and the probe-spec
 * hash that makes a snapshot "only comparable to itself" (Decision 3).
 */
import { jcsCanonical } from "../json.js";
import { sha256Hex } from "../sha256.js";

/** One probe declaration (SPEC §4 config shape). Probes are seeded at M2 (`init`). */
export interface ProbeDecl {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
  capture: "shape" | "values";
}

/** What probeSpecHash covers: the DECLARED probes + profiles — not the
 * transport or target identity, so two fixtures recorded under the same
 * probe spec stay comparable. */
export interface ProbeSpec {
  probes: ProbeDecl[];
  profiles: string[];
}

export function probeSpecHash(spec: ProbeSpec): string {
  return sha256Hex(jcsCanonical(spec));
}

/**
 * Built-in volatile selectors (SPEC §2 Decision 2: "a fixed built-in list
 * plus user selectors in config"). The built-ins target behavior captures
 * (request ids / timestamps inside structuredShape), which land with the
 * http transport at M2; full volatile handling is an M3 deliverable
 * (SPEC §10). The mechanism below is live now and consumed by `record` for
 * user selectors.
 */
export const BUILTIN_VOLATILE_SELECTORS: readonly string[] = [];

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Replace the values at the given dot-path selectors (snapshot-rooted, e.g.
 * "behavior.weather.structuredShape.requestId"; numeric segments index
 * arrays) with type tokens: "<iso8601>", "<uuid>", "<string>", "<number>",
 * "<boolean>", "<array>", "<object>". Untouched branches are returned by
 * reference; typed scalar fields of the snapshot itself are not legal
 * targets — `record` parses its output afterwards and fails loudly rather
 * than writing a file that cannot be read back.
 */
export function normalizeVolatile(value: unknown, selectors: readonly string[]): unknown {
  const paths = selectors.filter((s) => s.length > 0).map((s) => s.split("."));
  if (paths.length === 0) return value;
  return walk(value, paths);
}

function walk(node: unknown, paths: string[][]): unknown {
  if (paths.some((p) => p.length === 0)) return typeToken(node);
  if (Array.isArray(node)) {
    const children = node as unknown[];
    const out: unknown[] = [];
    let touched = false;
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      const next = paths.filter((p) => p[0] === String(index)).map((p) => p.slice(1));
      if (next.length === 0) {
        out.push(child);
        continue;
      }
      touched = true;
      out.push(walk(child, next));
    }
    return touched ? out : node;
  }
  if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    let touched = false;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      const next = paths.filter((p) => p[0] === key).map((p) => p.slice(1));
      if (next.length === 0) {
        out[key] = record[key];
      } else {
        touched = true;
        out[key] = walk(record[key], next);
      }
    }
    return touched ? out : node;
  }
  return node;
}

function typeToken(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case "number":
      return "<number>";
    case "boolean":
      return "<boolean>";
    case "string":
      if (ISO8601_RE.test(value)) return "<iso8601>";
      if (UUID_RE.test(value)) return "<uuid>";
      return "<string>";
    default:
      return Array.isArray(value) ? "<array>" : "<object>";
  }
}
