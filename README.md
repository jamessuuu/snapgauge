# snapgauge

**Contract tests for MCP servers. Record a snapshot of a server's schema and
observable behavior; fail CI when the next version moves. Deterministic,
offline-capable, zero LLM.**

> **Status: pre-release, M0–M7 landed; not yet published.** The design in
> [docs/SPEC.md](docs/SPEC.md) is approved and frozen for v1; implementation
> landed milestone by milestone (SPEC §10) and every claim below is backed by
> the receipts in the five-stage CI. `1.0.0-rc.1` is built, pack-checked
> (a real `npm install <tarball>` + `snapgauge diff` in a clean scratch
> directory — see `pnpm ci:pack-check`), and ready for `pnpm publish`; the
> actual publish and the first push of a `v*` tag are James's call, not this
> build's (`.github/workflows/release.yml` is committed, unrun).
>
> Working today, proven by the five-stage CI (typecheck → lint → unit → e2e:smoke
> → eval, plus build/pack-check/brand-drift guards) and 37 golden/compat eval
> cases (30 golden + 7 compat, SPEC §7's ≥30-case bar) at 100% exact match: the
> full snapshot + diff + compat/degradation
> engine (`record`/`check`/`diff`/`compat`/`ci`) over `http`, `stdio`, and
> `fixture` transports; the CLI; the composite [`action.yml`](action.yml)
> GitHub Action; and the demo site — `/` (static), `/demo` (the real engine,
> offline, in a Web Worker), `/live` + `POST /api/check` (an SSRF-guarded,
> rate-limited, read-only live audit of a visitor-named server), and `/board`
> (the schema, the weekly Actions job, the disclosure-policy validator, and the
> render path are all built and tested — `boards/roster.json` ships empty on
> purpose, since which public servers belong on it is James's call, SPEC §11
> Q1, so `/board` still shows the honest empty state until that's decided).

## Install

```
npx snapgauge@1 init --url https://mcp.example.com/mcp   # or --command / --fixture
npx snapgauge@1 record                                    # writes .snapgauge/<target>.snapshot.json
npx snapgauge@1 check                                      # probe live -> diff vs stored -> gate -> exit code
```

Or as a GitHub Action, against a snapshot already committed to your repo:

```yaml
- uses: jamessuuu/snapgauge@v1
  with:
    config: snapgauge.config.json   # default
    fail-on: risky                  # default (SPEC §5)
    # target: my-server             # only needed when the config has more than one
```

See [`action.yml`](action.yml) for every input/output; it runs `snapgauge check`
and turns the result into GitHub Actions annotations plus a job summary table,
reusing `snapgauge report` (the same pure reformatter the CLI itself uses) —
no second live check against your server to build the summary.

## Why

The official MCP conformance suite answers "does this server obey the spec
today". snapgauge answers a different question: **did *this* server change
against its own recorded contract — and does it still work with a client one
version back?** A tool description rewrite, a new required argument, or a
reordered `tools/list` never trips a spec check, but each one silently changes
what an agent connected to that server will do. The two are **complementary**,
not competing — run the [official conformance
suite](https://github.com/modelcontextprotocol/conformance) to check spec
compliance today; run snapgauge to catch what changed since your last release.

| | official conformance suite | snapgauge |
|---|---|---|
| Question | Does this server obey the spec, right now? | Did *this* server change vs. its own recorded contract — and how does it behave one client-version back? |
| Method | Scenario-based, wire-schema validated, run fresh every time. | Recorded snapshot diff (self-vs-self over time) + degradation profiles across client capability sets. |
| Output | Pass/fail against the 2026-07-28 revision. | Tiered findings (breaking/risky/compatible/cosmetic) with an exit code CI can gate on. |
| When it runs | Any time, against any server, no history required. | After the first `snapgauge record` — it needs a prior snapshot to compare against. |

**This is a SHARP TOOL — one job, done deterministically, not a flagship
product:** no dashboard, no accounts, no roadmap of adjacent features. It
answers exactly the drift/compatibility question above and nothing else; see
Non-goals and Limitations below for what it deliberately does not attempt.

## Non-goals

No security scanning, tool-poisoning heuristics, or trust scores. No LLM
anywhere in the product. No re-implementation of the official conformance
suite. The hosted demo never accepts a bearer token and never calls
`tools/call` on a third-party server — neither does the board (SPEC §1/§8).

## Limitations

- **Auth-gated tools.** The hosted `/live` check never accepts a bearer
  token, so it can only audit a server's unauthenticated discovery surface.
  The CLI/CI path supports auth via `${ENV}`-interpolated headers in
  `snapgauge.config.json` — the token stays in your own environment.
- **Per-tenant tool sets.** If a server returns a different `tools/list` per
  API key, snapgauge only ever sees the one it was configured to see.
- **Genuinely non-deterministic output.** Shape-capture (the default)
  absorbs most value churn, but a tool that returns a random *schema shape*
  will read as flaky drift.
- **stdio's narrower assertion set.** The T-group framing assertions
  (SPEC §5) require an HTTP layer — over `stdio` they report `n/a (stdio)`,
  with the reason printed, never silently passed.

## Exit codes

Load-bearing for CI (SPEC §5). `1` vs `3` is deliberate: different owner,
different fix — `1` is a decision for the person maintaining the *client
integration or the recorded snapshot* (is this drift intentional? update the
snapshot or fix the server); `3` means *the server itself* is not honoring
the spec's degradation contract.

| Code | Meaning | Who fixes it |
|---|---|---|
| 0 | Clean — no findings at/above the gate. | Nobody — nothing to do. |
| 1 | Drift at/above the gate (`--fail-on`, default `risky`). | The consumer: review the diff, then either `--update` the stored snapshot (drift was intentional) or fix/pin the server. |
| 2 | Probe/connection failure (unreachable, auth, timeout, malformed response). | The consumer's environment/config — check the target URL, credentials, and network reachability. |
| 3 | Compat/degradation violation — the server is wrong, not merely different. | The server's maintainer — it violates the 2026-07-28 revision's degradation contract. |
| 4 | Usage/config/snapshot-format error (incl. probe-spec mismatch: re-record). | The consumer — fix the CLI invocation or config, or re-run `snapgauge record`. |
| 5 | Internal error — a bug in snapgauge itself. | snapgauge's maintainer — please [report it](SECURITY.md#reporting). |

## Monorepo

| Package | Purpose |
|---|---|
| `snapgauge` | The published package: core engine (isomorphic, zero I/O), node transports, CLI. |
| `@snapgauge/fixtures` | Private. Pure `(request, profile) => response` fixture servers for the eval set and the offline demo. |
| `apps/web` | Next.js demo site — `/`, `/demo`, `/live` + `/api/check`, `/board`. |

Root [`action.yml`](action.yml) is the published composite GitHub Action
(`uses: jamessuuu/snapgauge@v1`), not a workspace package.

---

Part of the [Agent James](https://agentjames.vercel.app) portfolio.
Built by James Lorenz Santos. Code MIT; brand assets excluded (see LICENSE).
