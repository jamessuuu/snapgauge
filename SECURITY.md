# Security

The headings below are the binding checklist from SPEC §9 feasibility item 9.
M0–M4 (the CLI, the core engine) landed first; M5 (`apps/web` — the hosted
`/api/check` live check) is now built, so this policy describes what actually
runs, not a plan.

## User-supplied-URL threat model and the block list

`POST /api/check` accepts `{ url }` only (Zod-parsed, unknown keys rejected —
`apps/web/app/api/check/route.ts`). The visitor is trusted to name a target,
never to control what gets probed once accepted: no arbitrary headers, no
request body, no tool name or arguments. The pipeline
(`apps/web/src/lib/ssrf-policy.ts` + `packages/snapgauge/src/node/address-policy.ts`)
rejects, in order:

1. Not a parseable URL, or scheme other than `https:`.
2. Userinfo in the URL (`user:pass@host`).
3. A port other than 443 (explicit or default) or 80.
4. An IP-literal hostname — `https://93.184.216.34/mcp` is refused even
   though that address is publicly routable. A hostname is required so a
   later DNS answer can be classified; an IP literal skips that check
   entirely and buys nothing a real hostname doesn't already give a visitor.
5. After DNS resolution, any answer that classifies as unspecified,
   loopback, RFC1918 private, link-local, CGNAT (100.64.0.0/10), IPv6 ULA
   (fc00::/7), IPv6-mapped/NAT64-embedded addresses, or the cloud metadata
   address `169.254.169.254` (`classifyAddress`,
   `packages/snapgauge/src/node/address-policy.ts` — the exhaustive matrix
   lives in that file's own test, and the web-specific additions in
   `apps/web/src/lib/ssrf-block-matrix.test.ts`).

Refusals return `400 TARGET_NOT_ALLOWED` with the **reason class only**
("private address", "loopback address", …) — never the resolved IP, never the
upstream error text (SPEC §6).

## DNS pinning and the no-redirect policy

Once a hostname's address is authorized, that exact resolved IP is **pinned**
for the connection via undici's `Agent({ connect: { lookup } })` — every
request in the check dials that address, regardless of what DNS answers on a
later, separate lookup (defeats DNS rebinding, where a name resolves to a safe
address at authorization time and a private one at connect time).

Redirects are never followed. The transport (`node/http-transport.ts`) uses
undici's plain `request()`, which does not follow redirects unless a redirect
interceptor is explicitly attached — none is. A 3xx response on the MCP
endpoint surfaces as a probe failure naming the redirect, not a hop; see the
matrix's `redirects are never followed` test for the exact behavior.

## `addressPolicy`: different defaults for CLI and web, by decision

One implementation, two defaults (SPEC §3 Decision 4): the web API pins
`public-only` (`apps/web/src/lib/ssrf-policy.ts`); the CLI defaults to
`allow-private` (a developer must be able to point it at `localhost:3000`) and
offers `--strict-net`. The difference is a decision, not an oversight: a CLI
run is something you point at your own infrastructure under your own
authority; a hosted form is something anyone on the internet can submit a URL
to, on infrastructure snapgauge itself does not own.

## We never call `tools/call` on a third-party server

The live check (`apps/web/src/lib/live-check.ts`) calls `record()` with an
**empty declared probe spec** — `record()` only issues `tools/call` for
probes it is given, and the hosted demo declares none. What it does call:
`server/discover` and `tools/list` (paginated, 3-repeat stability check) —
read-only discovery, the same surface the board (SPEC §8, lands at M6) reads.

One T-group framing assertion, `transport.meta_missing_not_32602`, issues a
real `tools/call` in the CLI/eval suite (deliberately missing `_meta`, to
verify the server rejects it correctly per the 2026-07-28 revision) — it is
explicitly excluded from the assertion list the hosted demo runs
(`WEB_SAFE_ASSERTIONS` in `live-check.ts`), because a nonconformant server
could execute it instead of rejecting it. Everything else the live check
reports — the remaining T-group assertions and the X-group **static**
`x-mcp-header` analysis — never issues a tool call.

## We never accept your bearer token in the hosted demo

`/api/check`'s request schema is `{ url: string }` — there is no field for a
header, a token, or credentials of any kind, so there is nothing to redact:
the shape itself refuses the input. Auth-gated checks are a CLI/CI concern,
where the token stays in your own environment (`${ENV}` interpolation only —
`packages/snapgauge/src/node/config.ts`); headers are redacted at capture
there too, not merely at print.

## We never persist a live check's result

`/api/check` has no database write path for check contents. The rate counter
(`apps/web/src/lib/rate-limit.ts`) stores only a **SHA-256 hash of the
requesting IP** and a per-day count — never the target URL, never the probe
result. No `.snapgauge/*.snapshot.json` is written server-side; the response
is the only copy, returned to the browser as JSON and never stored.

## Cost safety (SPEC §6/§9 feasibility item 3)

Three independent layers on `/api/check`:

1. **WAF rate rule** — 5 requests/60s/IP, bound to this route in the Vercel
   dashboard at deploy time (not code; this build does not deploy).
2. **App-level daily counter** — 50 checks/IP/day, 2,000/day global
   (`apps/web/src/lib/rate-limit.ts`), in-memory by default (per instance),
   with a documented Neon-backed implementation that activates the moment
   `DATABASE_URL` is set — no code change, no redeploy. With no database
   provisioned, the app builds and runs on the in-memory limiter and prints a
   one-time note saying so.
3. **Concurrency semaphore** — 3 concurrent checks per instance
   (`apps/web/src/lib/semaphore.ts`).

Per-check caps, enforced inside the pipeline itself
(`apps/web/src/lib/live-check.ts`): ≤40 requests, ≤256 KB per response
(`maxBodyBytes` on the HTTP transport), ≤1 MB total, 20s wall clock. When any
cap trips, or the rate limiter is exhausted, or Neon is unreachable, the
response is a typed error — never a 500, never a hang — and `/demo` (fully
offline, the same engine, zero caps) is offered as the fallback everywhere the
UI surfaces one.

## Typed error taxonomy

`apps/web/src/lib/errors.ts` maps every failure to one of: `TARGET_NOT_ALLOWED`
(400), `RATE_LIMITED` (429), `PROBE_TIMEOUT` (504), `PROBE_FAILURE` (502),
`SNAPSHOT_FORMAT` / `SNAPSHOT_FORMAT_NEWER` / `SPEC_MISMATCH` / `USAGE` (400),
`AUTH` (401), `SERVICE_UNAVAILABLE` (503, Neon unreachable — `/demo`, `/`,
`/board` are unaffected), `INTERNAL` (500). No stack traces, no upstream error
strings, no resolved IPs are ever echoed to the client.

## Reverse threat: snapshots can embed your server's surface

A snapshot captures tool names, titles, descriptions, and schemas. If your
server's tool surface is proprietary, **review `.snapgauge/*.snapshot.json`
before committing it.** Response *values* are not captured by default —
shape-capture is the default precisely so snapshots are safe to commit
(SPEC §2 Decision 1); `capture: "values"` is opt-in per probe. The same
applies in the other direction: if you run `/live` against your own server,
the discovered tool names/descriptions/schemas are rendered back to you in
the browser (and downloadable as JSON) — nothing is sent anywhere else, but
treat that JSON with the same care you'd give a snapshot file.

## Reporting

Email jameslorenzsantos@gmail.com. No bug bounty; honest credit given.
