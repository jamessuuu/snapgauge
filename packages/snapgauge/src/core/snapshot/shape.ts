/**
 * `structuredShape` (SPEC §2 Decision 1): a recursive TYPE sketch of a JSON
 * value — keys sorted, array element types unioned. Shape capture is the
 * default because it makes snapshots safe to commit (no customer data) and
 * stable against live-data servers; `capture: "values"` is opt-in per probe.
 *
 * Representation (itself Json, so it stores in the snapshot verbatim):
 *   scalar  -> "string" | "number" | "boolean" | "null"
 *   object  -> { object: { <key>: shape } }        (keys sorted by the writer)
 *   array   -> { array: [shape, ...] }             (unioned, deduped, sorted)
 */
import { jcsCanonical, type Json } from "../json.js";

export function shapeOf(value: Json): Json {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default: {
      if (Array.isArray(value)) {
        const seen = new Map<string, Json>();
        for (const element of value) {
          const shape = shapeOf(element);
          seen.set(jcsCanonical(shape), shape);
        }
        const union = [...seen.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([, shape]) => shape);
        return { array: union };
      }
      const object: Record<string, Json> = {};
      for (const key of Object.keys(value).sort()) {
        const child = value[key];
        if (child !== undefined) object[key] = shapeOf(child);
      }
      return { object };
    }
  }
}
