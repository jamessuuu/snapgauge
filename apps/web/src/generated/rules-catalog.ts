/**
 * GENERATED — do not edit by hand. Source: packages/snapgauge/src/core/diff/rules.ts.
 * Regenerate: `pnpm docs:rules` (also rewrites docs/RULES.md from the same
 * registry). CI fails on drift: `pnpm ci:docs-check`.
 *
 * The full four-tier diff-rule catalog as plain data, so the /docs page can
 * render it without importing anything from "snapgauge" beyond its public
 * "." export — this file, not a deep import of package internals, is the
 * boundary apps/web crosses to show the real registry.
 */
export interface CatalogRule {
  readonly id: string;
  readonly summary: string;
}

export const RULE_CATALOG: Readonly<Record<"breaking" | "risky" | "compatible" | "cosmetic", readonly CatalogRule[]>> = {
  "breaking": [
    {
      "id": "annotation.destructiveHint.raised",
      "summary": "destructiveHint became true — the tool now declares it destroys data."
    },
    {
      "id": "annotation.idempotentHint.revoked",
      "summary": "idempotentHint was true and no longer is — retry logic built on it is now unsafe."
    },
    {
      "id": "annotation.readOnlyHint.revoked",
      "summary": "readOnlyHint was true and no longer is — clients treating the tool as safe now mutate."
    },
    {
      "id": "capability.removed",
      "summary": "A server capability disappeared from discover — features clients negotiated are gone."
    },
    {
      "id": "error.code.changed",
      "summary": "A probed call's error code changed — client error handling keyed on the code breaks."
    },
    {
      "id": "tool.input.enum.removed",
      "summary": "Enum value(s) removed from an input — clients sending them are now rejected."
    },
    {
      "id": "tool.input.required.added",
      "summary": "An input became required — clients recorded against the old contract do not send it."
    },
    {
      "id": "tool.input.type.narrowed",
      "summary": "An input's accepted value space shrank (type set reduced/changed, or an enum constraint introduced) — previously-valid calls are now rejected."
    },
    {
      "id": "tool.output.required.added",
      "summary": "An output field became required (SPEC §5 places this at breaking)."
    },
    {
      "id": "tool.removed",
      "summary": "A tool present in the old contract is gone — clients holding the old contract fail."
    },
    {
      "id": "version.dropped",
      "summary": "A previously-advertised protocol version is no longer supported."
    },
    {
      "id": "xhdr.added",
      "summary": "An x-mcp-header binding appeared on an existing tool — a client on a cached tools/list will now be rejected with -32020."
    },
    {
      "id": "xhdr.changed",
      "summary": "An x-mcp-header binding's header name changed — clients still send the old header and are rejected with -32020."
    }
  ],
  "risky": [
    {
      "id": "annotation.destructiveHint.relaxed",
      "summary": "destructiveHint was true and no longer is (annotation.*.relaxed family) — the tool now claims to be safer."
    },
    {
      "id": "annotation.idempotentHint.relaxed",
      "summary": "idempotentHint became true (annotation.*.relaxed family) — clients may now retry freely on its word."
    },
    {
      "id": "annotation.readOnlyHint.relaxed",
      "summary": "readOnlyHint became true (annotation.*.relaxed family) — an increased safety claim clients may act on."
    },
    {
      "id": "cacheScope.widened",
      "summary": "cacheScope went private → public — responses may now be shared across authorization contexts."
    },
    {
      "id": "instructions.changed",
      "summary": "Server instructions changed — system-prompt-adjacent steering text."
    },
    {
      "id": "order.changed",
      "summary": "tools/list order changed (same tool set, both sides stable) — churns prompt caches keyed on list order."
    },
    {
      "id": "order.nondeterministic",
      "summary": "Repeated tools/list calls disagree on order (3-repeat probe) — reported as instability, NEVER as a false breaking diff."
    },
    {
      "id": "output.enum.added",
      "summary": "Enum value(s) added to an output — consumers may not handle the new values."
    },
    {
      "id": "tool.added",
      "summary": "A new tool appeared — expands the agent's action surface (shadowing risk)."
    },
    {
      "id": "tool.description.changed",
      "summary": "Description text changed — the trigger surface a model routes on (never cosmetic)."
    },
    {
      "id": "tool.title.changed",
      "summary": "Title text changed — also routing surface."
    },
    {
      "id": "ttlMs.raised",
      "summary": "ttlMs increased — clients will serve stale surface data for longer."
    }
  ],
  "compatible": [
    {
      "id": "cacheScope.narrowed",
      "summary": "cacheScope went public → private — strictly safer sharing semantics."
    },
    {
      "id": "capability.added",
      "summary": "A new server capability appeared in discover."
    },
    {
      "id": "required.removed",
      "summary": "An input is no longer required — clients that send it are still fine."
    },
    {
      "id": "tool.input.enum.added",
      "summary": "Enum value(s) added to an input — everything the old contract sent still works."
    },
    {
      "id": "tool.input.optional.added",
      "summary": "A new optional input appeared — old calls remain valid."
    },
    {
      "id": "tool.input.type.widened",
      "summary": "An input's accepted value space grew (type set expanded, or an enum constraint dropped) — old calls remain valid."
    },
    {
      "id": "ttlMs.lowered",
      "summary": "ttlMs decreased — clients refresh sooner."
    },
    {
      "id": "version.added",
      "summary": "A new protocol version is now advertised."
    }
  ],
  "cosmetic": [
    {
      "id": "_meta.vendor.changed",
      "summary": "A tool's vendor _meta changed — vendor-prefixed keys carry no contract."
    },
    {
      "id": "serverInfo.version.changed",
      "summary": "serverInfo.version changed — releases are expected to happen."
    },
    {
      "id": "text.whitespace-only",
      "summary": "A description/title/instructions change that is whitespace-only — the one text change that IS cosmetic."
    },
    {
      "id": "tool.icons.changed",
      "summary": "Tool icons changed."
    }
  ]
} as const;
