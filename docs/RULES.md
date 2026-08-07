# snapgauge rule catalog

Diff rules (SPEC §5), direction-aware old → new. Generated from
`packages/snapgauge/src/core/diff/rules.ts` — do NOT edit by hand:
run `pnpm docs:rules` after changing the registry (a unit test fails
when this file drifts from the registry).

Descriptions and titles are risky, not cosmetic: text is the trigger
surface a model routes on. Default gate: `failOn: "risky"`.

## breaking (13)

| Rule id | What it means |
|---|---|
| `annotation.destructiveHint.raised` | destructiveHint became true — the tool now declares it destroys data. |
| `annotation.idempotentHint.revoked` | idempotentHint was true and no longer is — retry logic built on it is now unsafe. |
| `annotation.readOnlyHint.revoked` | readOnlyHint was true and no longer is — clients treating the tool as safe now mutate. |
| `capability.removed` | A server capability disappeared from discover — features clients negotiated are gone. |
| `error.code.changed` | A probed call's error code changed — client error handling keyed on the code breaks. |
| `tool.input.enum.removed` | Enum value(s) removed from an input — clients sending them are now rejected. |
| `tool.input.required.added` | An input became required — clients recorded against the old contract do not send it. |
| `tool.input.type.narrowed` | An input's accepted value space shrank (type set reduced/changed, or an enum constraint introduced) — previously-valid calls are now rejected. |
| `tool.output.required.added` | An output field became required (SPEC §5 places this at breaking). |
| `tool.removed` | A tool present in the old contract is gone — clients holding the old contract fail. |
| `version.dropped` | A previously-advertised protocol version is no longer supported. |
| `xhdr.added` | An x-mcp-header binding appeared on an existing tool — a client on a cached tools/list will now be rejected with -32020. |
| `xhdr.changed` | An x-mcp-header binding's header name changed — clients still send the old header and are rejected with -32020. |

## risky (12)

| Rule id | What it means |
|---|---|
| `annotation.destructiveHint.relaxed` | destructiveHint was true and no longer is (annotation.*.relaxed family) — the tool now claims to be safer. |
| `annotation.idempotentHint.relaxed` | idempotentHint became true (annotation.*.relaxed family) — clients may now retry freely on its word. |
| `annotation.readOnlyHint.relaxed` | readOnlyHint became true (annotation.*.relaxed family) — an increased safety claim clients may act on. |
| `cacheScope.widened` | cacheScope went private → public — responses may now be shared across authorization contexts. |
| `instructions.changed` | Server instructions changed — system-prompt-adjacent steering text. |
| `order.changed` | tools/list order changed (same tool set, both sides stable) — churns prompt caches keyed on list order. |
| `order.nondeterministic` | Repeated tools/list calls disagree on order (3-repeat probe) — reported as instability, NEVER as a false breaking diff. |
| `output.enum.added` | Enum value(s) added to an output — consumers may not handle the new values. |
| `tool.added` | A new tool appeared — expands the agent's action surface (shadowing risk). |
| `tool.description.changed` | Description text changed — the trigger surface a model routes on (never cosmetic). |
| `tool.title.changed` | Title text changed — also routing surface. |
| `ttlMs.raised` | ttlMs increased — clients will serve stale surface data for longer. |

## compatible (8)

| Rule id | What it means |
|---|---|
| `cacheScope.narrowed` | cacheScope went public → private — strictly safer sharing semantics. |
| `capability.added` | A new server capability appeared in discover. |
| `required.removed` | An input is no longer required — clients that send it are still fine. |
| `tool.input.enum.added` | Enum value(s) added to an input — everything the old contract sent still works. |
| `tool.input.optional.added` | A new optional input appeared — old calls remain valid. |
| `tool.input.type.widened` | An input's accepted value space grew (type set expanded, or an enum constraint dropped) — old calls remain valid. |
| `ttlMs.lowered` | ttlMs decreased — clients refresh sooner. |
| `version.added` | A new protocol version is now advertised. |

## cosmetic (4)

| Rule id | What it means |
|---|---|
| `_meta.vendor.changed` | A tool's vendor _meta changed — vendor-prefixed keys carry no contract. |
| `serverInfo.version.changed` | serverInfo.version changed — releases are expected to happen. |
| `text.whitespace-only` | A description/title/instructions change that is whitespace-only — the one text change that IS cosmetic. |
| `tool.icons.changed` | Tool icons changed. |
