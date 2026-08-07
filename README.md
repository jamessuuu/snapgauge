# snapgauge

**Contract tests for MCP servers. Record a snapshot of a server's schema and
observable behavior; fail CI when the next version moves. Deterministic,
offline-capable, zero LLM.**

> **Status: pre-release, walking skeleton (M1).** The design in
> [docs/SPEC.md](docs/SPEC.md) is approved and frozen for v1; implementation is
> landing milestone by milestone (SPEC §10). Nothing below claims to work until
> its milestone's tests say so — this README grows only as fast as the receipts do.
>
> Working today, proven by the test suite (77 tests) and 3 golden eval cases at
> 100% exact match: snapshot format v1 + canonicalizer, `record`/`diff` over the
> in-process **fixture** transport, and 6 of the SPEC §5 diff rules spanning all
> four tiers. Not yet real: `http`/`stdio` transports, `check`, config loading
> (M2); the full rule catalog and ≥30-case golden set (M3); the compat/degradation
> engine (M4); the demo site (M5).

## Why

The official MCP conformance suite answers "does this server obey the spec
today". snapgauge answers a different question: **did *this* server change
against its own recorded contract — and does it still work with a client one
version back?** A tool description rewrite, a new required argument, or a
reordered `tools/list` never trips a spec check, but each one silently changes
what an agent connected to that server will do.

| | official conformance suite | snapgauge |
|---|---|---|
| Question | spec compliance, now | self-vs-self drift over time + client-version-back behavior |
| Method | scenario-based, wire-schema validated | recorded snapshot diff + degradation profiles |

This is a **sharp tool** with one job (program tiering: not a flagship), and it
is complementary to — not a replacement for — the official suite.

## Non-goals

No security scanning, tool-poisoning heuristics, or trust scores. No LLM
anywhere in the product. No re-implementation of the official conformance
suite. The hosted demo (M5) never accepts a bearer token and never calls
`tools/call` on a third-party server.

## Exit codes

Load-bearing for CI (SPEC §5). `1` vs `3` is deliberate: different owner,
different fix.

| Code | Meaning | Status |
|---|---|---|
| 0 | clean | implemented |
| 1 | drift at/above the gate (`--fail-on`, default `risky`) | implemented |
| 2 | probe/connection failure (unreachable, malformed responses) | implemented |
| 3 | compat/degradation violation — the server is wrong, not merely different | lands at M4 |
| 4 | usage / config / snapshot-format error (incl. probe-spec mismatch: re-record) | implemented |
| 5 | internal error | implemented |

## Monorepo

| Package | Purpose |
|---|---|
| `snapgauge` | The published package: core engine (isomorphic, zero I/O), node transports, CLI. |
| `@snapgauge/fixtures` | Private. Pure `(request, profile) => response` fixture servers for the eval set and the offline demo. |
| `apps/web` | Next.js demo site — lands at M5. |

---

Part of the [Agent James](https://agentjames.vercel.app) portfolio.
Built by James Lorenz Santos. Code MIT; brand assets excluded (see LICENSE).
