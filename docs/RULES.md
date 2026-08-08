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

## Transport assertions (T-group, SPEC §5)

HTTP-framing checks for the 2026-07-28 revision. On transports without
an HTTP layer each one is reported `n/a` WITH the reason — never
silently passed. Failing a MUST is a `violation` (exit 3); failing a
SHOULD is `risky`.

| Assertion id | Level | Citation |
|---|---|---|
| `transport.cache_hints_missing` | MUST | utilities/caching 2026-07-28: cacheable surfaces MUST carry ttlMs>=0 + cacheScope |
| `transport.cachescope_inconsistent_across_pages` | MUST | utilities/caching 2026-07-28: cacheScope MUST be identical on every page of a paginated list |
| `transport.delete_not_405` | SHOULD | streamable-http: a server SHOULD respond 405 to DELETE on the MCP endpoint |
| `transport.discover_not_implemented` | MUST | server/discover 2026-07-28: servers MUST implement server/discover |
| `transport.get_not_405` | SHOULD | streamable-http: a server SHOULD respond 405 to GET on the MCP endpoint |
| `transport.header_body_mismatch_accepted` | MUST | versioning 2026-07-28: header/body protocol-version disagreement MUST be 400 + -32020 HeaderMismatch |
| `transport.last_event_id_honored` | MUST | streamable-http 2026-07-28: streams are not resumable — Last-Event-ID MUST NOT resume a stream |
| `transport.mcp_name_base64_not_decoded` | MUST | streamable-http 2026-07-28: the =?base64?…?= MCP-Name sentinel MUST be decoded before comparing |
| `transport.mcp_name_mismatch_accepted` | MUST | streamable-http 2026-07-28: a mismatched MCP-Name MUST be rejected (-32020) |
| `transport.mcp_name_missing_accepted` | MUST | streamable-http 2026-07-28: a request without MCP-Name MUST be accepted |
| `transport.meta_missing_not_32602` | MUST | server/tools 2026-07-28: tools/call without required _meta MUST be -32602 (or HTTP 400) |
| `transport.missing_protocol_version_accepted` | MUST | versioning 2026-07-28: a request without MCP-Protocol-Version MUST be accepted |
| `transport.notification_not_202` | MUST | streamable-http: a lone notification MUST be answered 202 Accepted |
| `transport.origin_invalid_not_403` | MUST | streamable-http: an invalid Origin MUST be rejected 403 (DNS-rebinding defense) |
| `transport.reserved_error_code_misuse` | MUST | basic 2026-07-28: -32020..-32099 is spec-reserved; -32002/-32042 MUST NOT be emitted |
| `transport.result_type_absent` | MUST | server/tools 2026-07-28: tool results MUST carry resultType |
| `transport.session_id_echoed` | MUST | streamable-http 2026-07-28: servers MUST ignore Mcp-Session-Id — never mint or echo one |
| `transport.sse_no_accel_buffering` | SHOULD | streamable-http: SSE responses SHOULD carry X-Accel-Buffering: no |
| `transport.sse_no_keepalive` | SHOULD | streamable-http: long-lived SSE streams SHOULD send keepalive comments |
| `transport.unknown_method_not_404_32601` | MUST | basic: an unknown method MUST yield JSON-RPC -32601, not HTTP 404 |
| `transport.unsupported_version_not_32022` | MUST | versioning 2026-07-28: an unsupported version MUST be -32022 with non-empty data.supported[] |

## Compat rules (X-group + D-group, SPEC §5)

Degradation verdicts run per (tool × profile): `ok |
declined-correctly | degraded-reported | degraded-silent | violation`.
Any `violation`-class finding exits 3 — the server is wrong, not merely
different (different owner, different fix than exit 1).

| Rule id | Class | What it means |
|---|---|---|
| `compat.era` | info | Informational: modern-only \| dual \| legacy, from the modern-then-initialize probe. |
| `compat.legacy_error_unhelpful` | risky | A modern-only server rejects initialize without naming its supported versions (SHOULD; legacy clients have no fall-forward). |
| `compat.set_varies_per_connection` | violation | Same profile, two fresh connections, different tool set (MUST NOT). |
| `compat.surface_varies_by_version` | info | The tool-name set differs across advertised versions (recorded as a matrix, reported, not failed). |
| `compat.ttl_overpromise` | risky | The surface changed between two recorded runs closer together than the ttlMs the server told clients to cache for. Requires the board's time series (M6) — not evaluated by the engine. |
| `compat.version_advertised_unsupported` | violation | A version listed in discover.supportedVersions fails a plain tools/list — the server is lying about what it supports. |
| `degrade.extension_leak` | violation | An advertised extension's resultType or _meta prefix appears in a response to a profile that advertised no extensions. |
| `degrade.input_required_without_capability` | violation | resultType:"input_required" whose inputRequests name elicitation/create, sampling/createMessage or roots/list to a client that advertised none. |
| `degrade.over_declared` | violation | -32021 naming a capability the tool demonstrably never exercises under modern-full — the server gates at request entry rather than at use. |
| `degrade.reported` | info | The good citizen: the result degrades under the reduced profile AND says so via the degradation marker. |
| `degrade.silent` | risky | A complete result under the reduced profile that differs in shape from modern-full with no signal at all. Permitted by the spec, so reported at risky — exactly what the board exists to publish. |
| `degrade.wrong_error` | violation | Under a reduced profile a call must succeed with resultType:"complete" or fail with -32021 listing exactly the missing capabilities. A 500, a generic -32603, a hang, or an isError:true text blob is a violation. |
| `xhdr.absent_param_rejected` | violation | Live check: the server MUST NOT expect a header for an absent value. |
| `xhdr.control_char` | violation | x-mcp-header contains a control character — invisible to conforming clients. |
| `xhdr.empty` | violation | x-mcp-header is empty — the tool is invisible to conforming clients. |
| `xhdr.non_primitive` | violation | The bound value is not a primitive (`number` is not permitted) — invisible to conforming clients. |
| `xhdr.not_statically_reachable` | violation | The declaration chain is not properties keys only (items/oneOf/anyOf/allOf/not/if-then-else/$ref) — invisible to conforming clients. |
| `xhdr.not_token` | violation | x-mcp-header is not an RFC 9110 token (1*tchar) — invisible to conforming clients. |
| `xhdr.not_unique` | violation | The same header (case-insensitive) is bound more than once — invisible to conforming clients. |
| `xhdr.param_mismatch_accepted` | violation | Live check: a call whose bound param disagrees with its header MUST be rejected with -32020. |
| `xhdr.unsafe_integer` | violation | An integer binding involves values outside the safe-integer range — invisible to conforming clients. |
