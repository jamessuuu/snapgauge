# snapgauge

**Contract tests for MCP servers. Record a snapshot of a server's schema and
observable behavior; fail CI when the next version moves. Deterministic,
offline-capable, zero LLM.**

> **Status: pre-release, M0–M5 landed.** The design in
> [docs/SPEC.md](docs/SPEC.md) is approved and frozen for v1; implementation is
> landing milestone by milestone (SPEC §10). Nothing below claims to work until
> its milestone's tests say so — this README grows only as fast as the receipts do.
>
> Working today, proven by the five-stage CI (typecheck → lint → unit → e2e:smoke
> → eval, plus build/pack-check/brand-drift guards) and 37 golden/compat eval
> cases (30 golden + 7 compat, SPEC §7's ≥30-case bar) at 100% exact match: the
> full snapshot + diff + compat/degradation
> engine (`record`/`check`/`diff`/`compat`) over `http`, `stdio`, and `fixture`
> transports; the CLI; and the demo site — `/` (static), `/demo` (the real engine,
> offline, in a Web Worker), `/live` + `POST /api/check` (an SSRF-guarded,
> rate-limited, read-only live audit of a visitor-named server), and `/board`
> (ships honestly empty — the weekly board job is M6, not yet built). Not yet
> real: the board's own scheduled runs and published rows (M6); the published
> npm package and GitHub Action (M7).

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
| `apps/web` | Next.js demo site — `/`, `/demo`, `/live` + `/api/check`, `/board`. |

---

Part of the [Agent James](https://agentjames.vercel.app) portfolio.
Built by James Lorenz Santos. Code MIT; brand assets excluded (see LICENSE).
