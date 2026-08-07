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
 * Built-in volatile handling (SPEC §2 Decision 2: "a fixed built-in list
 * plus user selectors in config") comes in two parts:
 *
 * - `BUILTIN_VOLATILE_SELECTORS`: fixed dot-path selectors into the
 *   snapshot. Empty by design — built-ins cannot be paths because paths
 *   depend on user-declared probe ids; the built-in list is KEY-based.
 * - `VOLATILE_KEYS` + `normalizeVolatileKeys`: any object key on the fixed
 *   list, wherever it appears inside a VALUE capture (contentBlocks /
 *   structuredContent under `capture:"values"`), is normalized to a type
 *   token. Shape captures never need this — shapes carry no values.
 *
 * User selectors from config are merged with the selector list by `record`.
 */
export const BUILTIN_VOLATILE_SELECTORS: readonly string[] = [];

/** The fixed built-in list (SPEC §2 Decision 2), lowercase-compared. */
export const VOLATILE_KEYS: readonly string[] = [
  "requestid",
  "request_id",
  "traceid",
  "trace_id",
  "spanid",
  "span_id",
  "correlationid",
  "correlation_id",
  "timestamp",
  "generatedat",
  "generated_at",
  "servedat",
  "served_at",
  "etag",
  "nonce",
  "uuid",
];

const VOLATILE_KEY_SET: ReadonlySet<string> = new Set(VOLATILE_KEYS);

/** Recursively replace values under built-in volatile KEYS with type tokens. */
export function normalizeVolatileKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((element) => normalizeVolatileKeys(element));
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      out[key] = VOLATILE_KEY_SET.has(key.toLowerCase())
        ? volatileToken(record[key])
        : normalizeVolatileKeys(record[key]);
    }
    return out;
  }
  return value;
}

function volatileToken(value: unknown): unknown {
  return typeToken(value);
}

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
