# Security

snapgauge is pre-release. Most of the surface this policy governs is the hosted
demo, which lands at M5 (SPEC §10) — the policy is committed first so the build
is held to it rather than retrofitted. The headings below are the binding
checklist from SPEC §9; each is marked with the milestone where its enforcement
surface lands.

## User-supplied-URL threat model and the block list — lands at M5

The hosted `/api/check` accepts `{ url }` only. Planned policy: https only,
ports 443/80, no userinfo, no IP-literal hosts; after DNS resolution, reject
RFC1918, loopback, link-local, CGNAT, IPv6 ULA and mapped addresses, and
169.254.169.254.

## DNS pinning and the no-redirect policy — lands at M5

The resolved IP is pinned for the connection (defeats DNS rebinding) and
redirects are never followed — a redirect on an MCP endpoint is itself a
finding, not a hop.

## `addressPolicy`: different defaults for CLI and web, by decision — lands at M2 (CLI) / M5 (web)

One implementation, two defaults (SPEC §3 Decision 4): the web API pins
`public-only`; the CLI defaults to `allow-private` (a developer must be able to
point it at `localhost:3000`) and offers `--strict-net`. Documented here so the
difference reads as a decision, not an oversight.

## We never call `tools/call` on a third-party server — lands at M5

The hosted demo probes the read-only discovery surface only.

## We never accept your bearer token in the hosted demo — lands at M5

Auth-gated checks are for the CLI in your own CI, where the token stays in your
environment. Headers are redacted at capture, not at print.

## Reverse threat: snapshots can embed your server's surface — applies from M1

A snapshot captures tool names, titles, descriptions, and schemas. If your
server's tool surface is proprietary, review `.snapgauge/*.snapshot.json`
before committing it. Response *values* are not captured by default —
shape-capture is the default precisely so snapshots are safe to commit
(SPEC §2 Decision 1); `capture: "values"` is opt-in per probe.

## Reporting

Email jameslorenzsantos@gmail.com. No bug bounty; honest credit given.
