# snapgauge — SPEC

**Project:** P4 (SHARP TOOL · protocol) · **Status:** approved for build · **Date:** 2026-08-08
**Binds to:** PROGRAM.md (constraints + D1–D6), SELECTION.md (P4 guards), research/feasibility.md
(§2, §4, §4.1, §4.2, §5.A, §7), research/director-verdict.md (finalist #4), BRAND-KIT.md.
**Spec facts verified live 2026-08-08** against modelcontextprotocol.io/specification/2026-07-28
(transports/streamable-http, versioning, server/discover, server/tools, server/utilities/caching,
basic/index) and github.com/modelcontextprotocol/conformance. Every assertion id below cites a real
MUST/SHOULD from those pages.

## 1. Goal + non-goals

**Goal.** Contract tests for MCP servers. Record a snapshot of a server's schema *and* observable
behavior; fail CI when the next version moves. Second surface: cross-version compatibility and
graceful-degradation checks under the 2026-07-28 revision — the surface the official conformance
suite does not cover. Deterministic, offline-capable, zero LLM, zero model spend at any traffic level.

**Non-goals (hard guards).** No security scanning, tool-poisoning heuristics, or trust scores
(SELECTION.md guard: stay out of the saturated scanner category). No LLM anywhere in the product.
No re-implementation of the official suite — snapgauge answers "did *this* server change, and does it
still work with a client one version back", the official suite answers "does this server obey the spec
today". No credential collection: the hosted demo never accepts a bearer token from a visitor and never
calls `tools/call` on a third-party server. No SARIF at v1. Client-side (agent-side) conformance is
out of scope; snapgauge tests servers.

## 2. Data model — the snapshot

One file per target, committed to the consumer's repo: `.snapgauge/<target>.snapshot.json`.

```
{ formatVersion: 1, snapgaugeVersion, rulesetVersion, probeSpecHash, recordedAt,
  target: { transport, host, path, protocolVersion, auth: "none"|"bearer(redacted)" },
  discover:  { supportedVersions[], capabilities{...extensions{}}, serverInfo{name,version},
               instructions, ttlMs, cacheScope },
  tools:     [ { name, title, description, inputSchema, outputSchema, annotations, icons, _meta,
                 xmcpHeaders: [{path, header, valid, violations[]}] } ],
             + toolsList: { order[], pages, ttlMs, cacheScope, orderStable }
  resources: { list[], templates[], readEnvelopes: {uri -> {mimeType, blocks[], ttlMs, cacheScope}} },
  prompts:   [ { name, title, description, arguments[] } ],
  behavior:  { <probeId>: { resultType, contentBlocks[], structuredShape, isError, errorCode,
                            metaKeys[], httpStatus, contentType } },
  transport: { <assertionId>: { verdict, observed } },      // T-group, see §5
  compat:    { <profile>: { <assertionId>|<tool>: verdict } } // D/X-group, see §5
}
```

**Decision 1 — capture shape, not values, by default.** `structuredShape` is a recursive type sketch
(keys sorted, array element types unioned); text blocks are stored as `{type:"text", sha256}`.
`capture: "values"` is opt-in per probe. This is what makes snapshots (a) safe to commit —
they cannot leak customer data out of a tool response — and (b) stable against servers that return
live data. Value capture is for fixtures and for tools the owner knows are deterministic.

**Decision 2 — canonicalization is part of the format, not the writer.** Objects are written with
keys sorted lexicographically, 2-space indent, `\n` endings, trailing newline (git-diff legibility
beats byte-canonical JCS; hashes are computed separately over JCS bytes). Tool/resource/prompt arrays
are sorted by `name`/`uri` in the body so a server reordering its list does not produce a bogus schema
diff — observed order is preserved separately in `toolsList.order` and diffed at its own tier, because
the spec only SHOULDs deterministic ordering and the real cost of churn is prompt-cache misses.
Volatile fields are normalized to type tokens (`"<iso8601>"`, `"<uuid>"`, `"<number>"`) by a fixed
built-in list plus user selectors in config. `recordedAt` is metadata and excluded from every diff.

**Decision 3 — the snapshot is only comparable to itself.** `probeSpecHash` (hash of the target's
declared probes + profiles) is stored. If it differs at check time the run exits 4 ("re-record"),
never a silent partial diff. `formatVersion` is a monotonic integer; a reader MUST refuse a higher
version and MUST migrate lower ones through forward-only pure functions in
`src/snapshot/migrations/00N-*.ts`. Migrations never rewrite a consumer's file without `--migrate`.

## 3. Module / boundary map

```
snapgauge/                                  (pnpm workspace, public repo jamessuuu/snapgauge)
  packages/snapgauge/         ← the ONLY npm-published package (v1)
    src/core/    probe | snapshot | diff | compat | report   pure, isomorphic, zero I/O, Zod types
    src/node/    http-transport (undici, address policy) | stdio-transport | config-loader | fs
    src/cli/     commander bin `snapgauge` — the only place with process.exit / env / cwd
    exports: "."  → programmatic API + core;  "./bin" → CLI. sideEffects:false.
  packages/fixtures/          @snapgauge/fixtures, PRIVATE (never published)
    pure (request, profile) => response servers; also exposed as a stdio bin and a Next route
  apps/web/                   Next.js 16 demo site (workspace:* dep on snapgauge + fixtures)
  action.yml                  composite GitHub Action at repo root → uses: jamessuuu/snapgauge@v1
  boards/<YYYY-MM-DD>.json    committed board results (the durable asset)
  evals/cases/*.json          golden set; docs/SPEC.md; SECURITY.md; scripts/brand.mjs
```

**What stays isolated.** `core` never imports `node:*` and never opens a socket — it consumes an
injected `Transport { send(req, headers) → {status, headers, body|stream} }`. That single boundary is
what lets the *same engine* run in a Vercel function, in a browser Web Worker (offline demo), and in
the CLI, with the eval suite proving all three produce identical findings.

**Decision 4 — the SSRF policy is a transport parameter with different defaults per host.** One
implementation, `addressPolicy: "public-only" | "allow-private"`, tested both ways. The web API pins
`public-only`; the CLI defaults to `allow-private` (a developer must be able to point it at
`localhost:3000`) and offers `--strict-net`. Documented in SECURITY.md so the difference reads as a
decision, not an oversight.

## 4. API surface

### CLI (the npm artifact; `snapgauge` name verified free 2026-08-08)

| Command | Does |
|---|---|
| `snapgauge init` | writes `snapgauge.config.json`, probes the target, seeds probes from `tools/list` |
| `snapgauge record [target]` | probe → write `.snapgauge/<target>.snapshot.json` |
| `snapgauge check [target]` | probe live → diff vs stored → compat matrix → gate → exit code. `--update` rewrites |
| `snapgauge diff <a> <b>` | **offline**, two snapshot files, no network (also the web demo's engine) |
| `snapgauge compat [target]` | profile matrix + degradation assertions only |
| `snapgauge report <result.json> --format text\|json\|md` | pure reformat of a saved result |
| `snapgauge ci` | alias for `check --reporter=github --fail-on=risky --summary` |

Flags: `--config`, `--target`, `--fail-on`, `--only breaking,risky`, `--ignore <ruleId>`,
`--profiles`, `--timeout`, `--strict-net`, `--json`, `--no-color`.

**Config** — `snapgauge.config.json` is canonical and **contains no executable code** (the demo site
parses configs; a JS config would be an RCE surface). `.mjs`/`.ts` are also loaded via dynamic import
(Node ≥24 strips types) for people who want `defineConfig()`. Zod-parsed, unknown keys rejected.

```jsonc
{ "snapshotDir": ".snapgauge",
  "targets": {
    "acme":    { "transport": "http",    "url": "https://mcp.acme.com/mcp",
                 "headers": { "Authorization": "Bearer ${ACME_TOKEN}" },   // ${ENV} only; literals warn
                 "protocolVersion": "2026-07-28",
                 "profiles": ["modern-full","modern-minimal","no-elicitation"],
                 "probes": [{ "id":"weather", "tool":"get_weather",
                              "arguments":{"location":"Seattle"}, "capture":"shape" }],
                 "resources": { "read": ["config://app"] },
                 "volatile": ["behavior.weather.structuredShape.requestId"],
                 "failOn": "risky", "ignore": ["tool.icons.changed"], "timeoutMs": 10000 },
    "local":   { "transport": "stdio",   "command": "node", "args": ["./server.mjs"] },
    "fixture": { "transport": "fixture", "fixture": "drifty@v2" } } }
```

**Transports.** `http` (Streamable HTTP — primary; the only one where the framing assertions exist),
`stdio` (local servers; HTTP-only assertions are reported `n/a (stdio)` **with the reason printed** —
never silently passed), `fixture` (in-process, used by evals and the offline demo). Every assertion
declares `appliesTo`.

### HTTP (apps/web) — Node runtime, iad1

| Route | Auth | Notes |
|---|---|---|
| `GET /` `/demo` `/board` | none | static / client-side; render with every function paused (D3) |
| `POST /api/check` | none, read-only | live check. WAF rule bound here (the one Hobby rule). No `tools/call`. No bearer accepted. No result persisted. |
| `GET /schema/v1.json` | none | static config JSON Schema |

`/api/check` request: `{ url }` only. Server-side: Zod parse → URL policy (https only, port 443/80,
no userinfo, no IP-literal hosts) → DNS resolve → reject RFC1918 / loopback / link-local / CGNAT /
IPv6 ULA & mapped / 169.254.169.254 → **pin the resolved IP** for connect (defeats rebinding) →
`maxRedirections: 0` (a redirect on an MCP endpoint is itself a finding) → ≤40 requests, ≤256 KB each,
≤1 MB total, 20 s wall clock. Response: the same `Result` object the CLI emits, downloadable as JSON.

## 5. Assertion catalog (the product)

**Diff tiers and exit codes.** Four tiers, direction-aware (old→new):

| Tier | Examples (rule ids) |
|---|---|
| `breaking` | `tool.removed`, `tool.input.required.added`, `tool.input.type.narrowed`, `tool.input.enum.removed`, `tool.output.required.added`, `xhdr.added` / `xhdr.changed` (a client on a cached `tools/list` will now be rejected with -32020), `capability.removed`, `version.dropped`, `annotation.readOnlyHint.revoked`, `annotation.destructiveHint.raised`, `annotation.idempotentHint.revoked`, `error.code.changed` |
| `risky` | `tool.description.changed`, `tool.title.changed`, `tool.added` (expands the agent's action surface / shadowing), `instructions.changed`, `order.changed`, `order.nondeterministic`, `cacheScope.widened` (private→public: responses may now be shared across authorization contexts), `ttlMs.raised`, `output.enum.added`, `annotation.*.relaxed` |
| `compatible` | `tool.input.optional.added`, `tool.input.enum.added`, `tool.input.type.widened`, `required.removed`, `capability.added`, `version.added`, `ttlMs.lowered`, `cacheScope.narrowed` |
| `cosmetic` | `tool.icons.changed`, `serverInfo.version.changed`, `_meta.vendor.changed`, whitespace-only |

Descriptions are **not** cosmetic: description and title text is the trigger surface a model routes on,
so it is `risky` and the default gate fails on it. Default `failOn: "risky"`.

**Exit codes** (README table, load-bearing for CI): `0` clean · `1` drift at/above the gate ·
`2` probe/connection failure (unreachable, auth, timeout) · `3` compat/degradation violation
(the server is wrong, not merely different) · `4` usage/config/snapshot-format error · `5` internal.
1 vs 3 is deliberate: different owner, different fix.

**T-group — 2026-07-28 framing (HTTP only).** `transport.get_not_405` / `delete_not_405` (SHOULD 405);
`session_id_echoed` (MUST ignore `Mcp-Session-Id`, never mint/echo); `last_event_id_honored` (streams
are not resumable); `missing_protocol_version_accepted`; `header_body_mismatch_accepted` (MUST 400 +
**-32020 HeaderMismatch**); `mcp_name_missing_accepted` / `mcp_name_mismatch_accepted`;
`mcp_name_base64_not_decoded` (MUST decode the `=?base64?…?=` sentinel before comparing);
`unknown_method_not_404_32601`; `unsupported_version_not_32022` (+ `data.supported[]` must be
non-empty); `origin_invalid_not_403`; `meta_missing_not_32602` (missing required `_meta` →
-32602/400); `notification_not_202`; `sse_no_accel_buffering` (SHOULD) and `sse_no_keepalive` on a
`subscriptions/listen` stream; `discover_not_implemented` (MUST implement `server/discover`);
`result_type_absent`; `cache_hints_missing` (MUST carry `ttlMs`≥0 + `cacheScope` on `server/discover`,
`tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read`);
`cachescope_inconsistent_across_pages` (MUST be identical on every page);
`reserved_error_code_misuse` (-32020..-32099 is spec-reserved; -32002/-32042 MUST NOT be emitted).

**X-group — `x-mcp-header` validity (static, all transports).** One rule per constraint:
`xhdr.empty`, `xhdr.not_token` (RFC 9110 `1*tchar`), `xhdr.control_char`, `xhdr.not_unique`
(case-insensitive), `xhdr.non_primitive` (`number` is not permitted), `xhdr.unsafe_integer`,
`xhdr.not_statically_reachable` (chain must be `properties` keys only — no `items`, `oneOf`/`anyOf`/
`allOf`/`not`, `if`/`then`/`else`, `$ref`). Any hit is reported as **"this tool is invisible to
conforming clients"**, because clients MUST exclude it from `tools/list`. Plus live checks
`xhdr.param_mismatch_accepted` (server MUST reject with -32020) and `xhdr.absent_param_rejected`
(server MUST NOT expect a header for an absent value).

**D-group — cross-version and degradation (the differentiator).** A **profile** is
(protocolVersion, clientCapabilities, extensions, header behavior). Built-ins: `modern-full`,
`modern-minimal` (`clientCapabilities: {}`, no extensions — the critical one), `no-elicitation`,
`no-sampling`, `no-roots`, `no-tasks`, `no-ui`, `legacy-2025-11-25`, `legacy-headers-absent`.

- `degrade.wrong_error` — under a reduced profile, a call must either succeed with
  `resultType:"complete"` or fail with **-32021 MissingRequiredClientCapability** listing exactly the
  missing capabilities. A 500, a generic -32603, a hang, or an `isError:true` text blob saying
  "elicitation not supported" is a violation. (Spec: a server MUST NOT rely on undeclared capabilities.)
- `degrade.input_required_without_capability` — returns `resultType:"input_required"` whose
  `inputRequests` name `elicitation/create`, `sampling/createMessage` or `roots/list` to a client that
  advertised none.
- `degrade.over_declared` — **the "degrades but reports it wrongly" edge, half one:** returns -32021
  naming a capability that the tool demonstrably never exercises under `modern-full`. Servers that gate
  on capabilities at request entry rather than at use fail here.
- `degrade.silent` — **half two:** returns a `complete` result under the reduced profile that differs
  in shape/content from `modern-full` with no signal at all. Permitted by the spec, so it is reported
  at `risky`, not as a violation — and it is exactly what the board exists to publish.
- `degrade.extension_leak` — an advertised extension's `resultType` or `_meta` prefix appears in a
  response to a profile that advertised no extensions (spec: the supporting party MUST revert to core
  behavior or reject).
- `compat.version_advertised_unsupported` — a version listed in `discover.supportedVersions` fails a
  plain `tools/list`. The server is lying about what it supports.
- `compat.surface_varies_by_version` — the tool-name set differs across advertised versions (recorded
  as a matrix, reported, not failed).
- `compat.legacy_error_unhelpful` — a modern-only server rejects `initialize` without naming its
  supported versions (SHOULD; legacy clients have no fall-forward).
- `compat.era` — informational: `modern-only | dual | legacy`, from the modern-then-`initialize` probe.
- `compat.set_varies_per_connection` — same profile, two fresh connections, different tool set (MUST NOT).
- `compat.ttl_overpromise` — the surface changed between two recorded runs closer together than the
  `ttlMs` the server told clients to cache for. Requires the board's time series; this is why the board
  is an asset rather than a screenshot.

Per (tool × profile) verdict: `ok | declined-correctly | degraded-reported | degraded-silent | violation`.

## 6. Failure contracts (the ugly paths)

| Situation | Contract |
|---|---|
| Target unreachable / TLS failure / timeout | exit 2, no snapshot written, no partial diff. `check` never writes a snapshot. |
| Target returns 5xx mid-probe | probe marked `error`, remaining probes still run, result carries `incomplete: true`; gate treats missing evidence as **not passing** (exit 2), never as "no change". |
| Server is non-deterministic (order/values churn) | 3 repeats per list; instability becomes `order.nondeterministic` (risky) instead of a false `breaking`. Value churn is why shape-capture is the default. |
| `probeSpecHash` changed | exit 4 + "config changed; re-record" — never a silent partial comparison. |
| `formatVersion` newer than the binary | exit 4 with the required version. Older → migrate on `--migrate` only. |
| Auth token missing/expired | exit 2 with `auth` classification; the token is never written to the snapshot or the log (headers are redacted at capture, not at print). |
| Redirect on the MCP endpoint | not followed; recorded as `transport.redirect` finding. |
| Response > 256 KB / snapshot > 1 MB | truncate, mark `truncated: true`, that probe cannot produce a `breaking` finding (evidence is incomplete). |
| stdio server hangs or dies | 10 s per-request timeout, SIGKILL on teardown, exit 2. No orphan processes (verified in e2e). |
| Live demo: SSRF-blocked target | 400 `TARGET_NOT_ALLOWED` with the reason class only (never the resolved IP). |
| Live demo: rate limit | 429 from the WAF (edge) or `RATE_LIMITED` from the Neon counter, with a link to `/demo`. |
| Live demo: Neon suspended / quota | `/api/check` returns 503 + banner "live checks paused"; `/`, `/demo`, `/board` are unaffected (D3). |
| Hobby blackout (all functions paused) | `/`, `/demo`, `/board` are static or client-side and keep working; `/demo` runs the real engine in a Web Worker with zero network. |
| Board job fails or is auto-disabled (60-day rule) | `/board` shows a dead-man banner when the newest `boards/*.json` is >10 days old, with the date. Never presents stale data as current. |
| Idempotency / duplicate CI runs | every command is pure-read against the target; no side effects to be exactly-once about. `record` writes atomically (tmp + rename). |

**Cost safety (D2).** Zero model calls anywhere in the product, so there is no token ceiling to set;
the compute ceiling is stated instead. Caps: WAF 5 req/60 s per IP on `/api/check`; Neon counter 50
checks/IP/day and 2,000/day global; concurrency semaphore 3; ≤40 requests and ≤20 s per check.
Abuse numbers: one IP at the WAF cap = 7,200 checks/day → clamped to 50 by the app counter. At the
global cap: 2,000 × 20 s × 2 GB ≈ **22 GB-hrs of 360**, ~60k invocations/month of 1M, I/O-bound so
Active CPU is untouched. Fallback when a cap trips is `/demo` (offline, free, identical engine), never
a 500. Neon holds two tables only — `check_run` (ts, host_sha256, outcome, duration, finding_count,
ip_hash) and `rate_bucket` — and **never a raw target URL** (§4.2.6 observability without becoming a
directory of other people's endpoints).

## 7. Eval / golden set (CI stage 5)

Fixture servers in `packages/fixtures`, each a pure `(request, profile) => response`:
`clean@v1`, `clean@v2-identical` (negative), `drift-breaking@v2`, `drift-compatible@v2`,
`drift-cosmetic@v2`, `drift-steering@v2` (description rewrite + `readOnlyHint` flip),
`degrader-honest`, `degrader-silent`, **`degrader-liar`** (the director's edge case: -32021 naming
`sampling` it never uses, plus an `input_required` demanding `elicitation/create` from a client that
advertised none), `nonconformant-legacy` (mints `Mcp-Session-Id`, answers GET with SSE, no
`resultType`, no `ttlMs`), `flaky-order` (seeded shuffle), `paginated` (mismatched `cacheScope` on
page 2), `bad-x-mcp-header` (seven tools, one violated constraint each).

Each `evals/cases/*.json` names the fixture pair/profile and the **exact expected set of finding ids
and tiers**. Scoring is set equality, so a false positive fails the case. **Bar: 100% exact match,
≥30 cases; CI fails on any mismatch.** Three additional gates: a **false-positive suite**
(`clean→clean` under all nine profiles must yield zero findings), a **stability eval** (record twice →
byte-identical canonical snapshot), and a **determinism eval** (shuffle the fixture's key/array order
→ identical snapshot). The README badge carries the case count and pass rate, reproducible from the
pinned commit (`pnpm eval` from a clean clone).

CI (GitHub Actions, public repo, free): `typecheck → lint → unit → e2e:smoke → eval`.

## 8. The board (v1 scope — decided)

8–12 named public MCP servers, **unauthenticated read-only surface only**: era, advertised
`supportedVersions`, the T-group framing assertions, cache-hint presence, `x-mcp-header` validity,
and the D-group checks reachable without `tools/call`. Auth-gated servers are rows marked
`not tested (auth required)` — never guessed. Refreshed weekly by a GitHub Actions job (D4) that
commits `boards/<date>.json`; the commit doubles as the keep-alive against the 60-day auto-disable,
and the git history is the durable, un-fakeable asset. Each row publishes `checkedAt`, the exact CLI
command to reproduce it, and links to the raw result.

**Disclosure policy (binding).** For any MUST-level violation, an upstream issue is filed first and
the row records `reportedAt`; publication follows ≥7 days later (`publishedAt`). Findings are stated
as neutral observations ("returns 200 on GET; the revision says 405"), never as scores, grades, or
security claims. Expect the honest headline eleven days after the revision to be "*N* of *M* public
servers are still legacy-era, and here is exactly what breaks for a 2026-07-28 client" — that is the
finding, not a failure of the board.

## 9. Acceptance criteria

**Brand (BRAND-KIT).** `public/brand/` chip-mark set; 16px chip-mark favicon; footer on every page
(chip mark + "Built by James Lorenz Santos" + agentjames.vercel.app + repo link); README lockup
header + "Part of the Agent James portfolio" footer; deterministic `scripts/brand.mjs` generating the
snapgauge glyph (caliper jaws closing on a part, ink strokes, one amber jaw-tip, 64px grid, no
`Math.random`, no webfont); build-time OG image in PAPER/INK/AMBER; MIT code license with the
`public/brand` carve-out. **No hire-me CTA anywhere (D1).**

**Feasibility §4.2.** (1) Zod at every boundary — config, snapshot read, `/api/check` body, every
JSON-RPC response before interpretation. (2) No unauthenticated write path — there is no write path.
(3) WAF rule on `/api/check` **plus** the Neon counter **plus** the concurrency semaphore.
(4)+(8) N/A with the reason printed in the README: no model call exists in this product. (5) Typed
error taxonomy (`TARGET_NOT_ALLOWED`, `RATE_LIMITED`, `PROBE_TIMEOUT`, `SNAPSHOT_FORMAT`, …); no stack
traces, no upstream error strings echoed to the client. (6) `check_run` event log in Neon (Hobby keeps
runtime logs 1 hour). (7) Drizzle migrations checked in + `db:seed`. (9) **SECURITY.md** covering: the
user-supplied-URL threat model and the full block list, DNS pinning and no-redirect policy, the
`addressPolicy` default difference between CLI and web (and why), "we never call `tools/call` on a
third-party server", "we never accept your bearer token in the hosted demo", **and the reverse threat —
snapshots may embed proprietary tool descriptions and schemas, so review before committing** — plus a
responsible-disclosure address.

**Positioning.** README carries a complementary-to-official table (official conformance = "does this
server obey the spec now", scenario-based, wire-schema validated; snapgauge = "did *this* server change
vs its own recorded contract, and how does it behave one client-version back"), a link to the official
repo, an explicit SHARP TOOL tier statement, and a Limitations section (auth-gated tools, per-tenant
tool sets, servers with genuinely non-deterministic output, stdio's `n/a` assertion set).

## 10. Build order (each milestone ends on a green five-stage CI commit)

| M | Deliverable | Green gate |
|---|---|---|
| **M0** | Workspace, TS strict + `noUncheckedIndexedAccess`, ESLint 9, Vitest 4, Playwright, CI 5 stages, brand assets, SECURITY.md, static `/` deployed | CI green; `/` live on Vercel |
| **M1** | **Walking skeleton:** snapshot model v1 + canonicalizer + `record`/`diff` over the `fixture` transport, 3 fixtures, 6 rules, exit codes | `snapgauge diff` classifies the planted breaking drift; 3 golden cases pass |
| **M2** | `http` transport (undici + address policy) and `stdio`; `check`; config loader; reporters; `init` | e2e records+checks a fixture served over real HTTP and over stdio; `n/a (stdio)` printed with reasons |
| **M3** | Full diff taxonomy + rule catalog table in docs; volatile handling; migration scaffold | golden set ≥30 at 100% exact match; false-positive, stability and determinism suites green |
| **M4** | Compat engine: profiles, T/X/D groups, `compat`, degradation verdicts | `degrader-honest` / `-silent` / `-liar` and `nonconformant-legacy` each produce exactly the expected finding set; exit 3 distinct from exit 1 |
| **M5** | Demo site: `/demo` (Web Worker, real engine, offline), `/live` + `/api/check` (SSRF guard, WAF, Neon), Playwright smoke | SSRF block matrix green (RFC1918/loopback/link-local/ULA/metadata/rebinding); blackout render test green; live check against a self-hosted fixture endpoint |
| **M6** | Board: schema, weekly Actions job, static `/board`, dead-man banner, upstream-report columns | first board committed with ≥8 real dated rows; banner unit-tested at the 10-day boundary |
| **M7** | Publish `snapgauge@1.0.0`, root `action.yml`, README + limitations, portfolio entry | `npx snapgauge@1 check` works from a clean directory; the Action runs green in a scratch consumer repo |

Cut line if the program slips (director's guard): M0–M4 plus a static `/` is a complete, honest,
publishable tool. M5–M6 are the amplifier, not the product.

## 11. Open questions (deferred to the main session / James)

1. **Board target list** — the specific 8–12 public servers need James's go/no-go before the first
   publish. The disclosure policy above is decided; only the roster is open.
2. **`@snapgauge/core` split** — stay single-package unless the web bundle exceeds ~150 KB gzipped
   from CLI-adjacent imports; measure at M5, split only with evidence.
3. **D1 Vercel Hobby commercial question** — already consolidated on the agentjames ticket; nothing in
   this build changes either way.
4. **Shareable `/live` results** — deferred; it would introduce a public write path and a moderation
   surface. Revisit only after v1.
5. **SARIF / GitHub code-scanning output** — deferred to v1.1; the `github` reporter's inline
   annotations cover the CI need.
6. **Resource body capture** — default off (privacy). Revisit if the board shows `resources/read`
   drift is where real breakage lives.

---

## Appendix — architect's verification notes (2026-08-08)

- MCP spec details in §5 were fetched live from
  `modelcontextprotocol.io/specification/2026-07-28/{basic/transports/streamable-http,
  basic/versioning, basic/index, server/discover, server/tools, server/utilities/caching}`.
  `MissingRequiredClientCapability` is **-32021** (feasibility §2.2 did not name it; it is the
  load-bearing code for the whole degradation suite); `UnsupportedProtocolVersion` is **-32022**.
- The official suite's scope was confirmed from its README: it validates client and server
  implementations against the spec for a negotiated version, with wire-schema validation, via
  `npx @modelcontextprotocol/conformance server --url <url>` plus a GitHub Action. snapgauge's axis
  is *self-vs-self over time* and *client-version-back*, neither of which that tool does.
