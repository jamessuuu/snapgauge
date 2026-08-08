# The board

`boards/<YYYY-MM-DD>.json` is a committed, dated snapshot of what a weekly
[GitHub Actions job](../.github/workflows/board.yml) observed on the
**unauthenticated, read-only surface** of a small list of public MCP
servers (SPEC §8): era (modern-only / dual / legacy), advertised
`supportedVersions`, the T-group framing assertions, cache-hint presence,
`x-mcp-header` validity, and the D-group checks reachable **without**
`tools/call`. The git history of this directory is the durable, un-fakeable
asset — a screenshot can be edited, a commit log cannot.

## The roster is empty on purpose

`roster.json` currently ships as `{ "targets": {} }`. **Which public servers
belong on the board is James's call** (`docs/SPEC.md` §11 Q1 — "the specific
8–12 public servers need James's go/no-go before the first publish"), not
something this build decides unilaterally. Until a target is added here, the
weekly job is a deliberate **no-op**: it reads the roster, sees nothing to
check, and exits cleanly without writing or committing anything
(`scripts/run-board.mjs`). No third-party server is probed by this build.

## Adding a target

Each entry in `roster.json["targets"]` is keyed by a short name (becomes
`row.server` and the CLI target name below) and validated against
`RosterTargetSchema` (`packages/snapgauge/src/core/board/schema.ts`):

```jsonc
{
  "targets": {
    "acme": {
      "url": "https://mcp.acme.example/mcp",   // https:// only — required
      "protocolVersion": "2026-07-28",          // optional, defaults to modern-full's
      "notes": "why this server is on the board" // optional, free text
    }
  }
}
```

The schema is **structurally** narrower than a full `snapgauge.config.json`
target: there is no `headers` field (the board never carries a credential —
"unauthenticated read-only surface only" is enforced by the type, not merely
by convention) and no `probes` field (the board never calls `tools/call` on
a third-party server — SPEC §1/§8 — so there is nothing to declare a probe
against). A target carrying either is rejected by `RosterSchema` before it
is ever probed.

## Reproducing a row

Every row records the exact CLI command a third party can run to check the
same thing:

```
snapgauge compat <name> --config boards/roster.json
```

Because a roster entry has no `probes`, this reproduces a run that also
issues zero `tools/call` requests — **with one narrow exception**: the
CLI's `compat` command runs the full T-group assertion catalog, which
includes `transport.meta_missing_not_32602` (one deliberate `tools/call`
missing `_meta`, to verify the server rejects it). The board itself
excludes that one assertion (`BOARD_TRANSPORT_ASSERTIONS` in
`packages/snapgauge/src/node/board-runner.ts`), for the identical reason
`apps/web`'s hosted `/live` check excludes it (see `SECURITY.md`). A manual
reproduction with the command above is therefore slightly MORE thorough
than what the board itself checked, not less — documented here so the
discrepancy is never a surprise.

## The disclosure policy (binding, SPEC §8)

> For any MUST-level violation, an upstream issue is filed first and the
> row records `reportedAt`; publication follows ≥7 days later
> (`publishedAt`). Findings are stated as neutral observations... never as
> scores, grades, or security claims.

This is enforced in code
(`packages/snapgauge/src/core/board/disclosure.ts`), not only in this
paragraph: `buildBoardRow` computes `mustViolationCount` from a run's T/D/X
findings, and a row whose `publishable` field is not `true` has its
`era`, `supportedVersions`, `assertions`, and `findings` withheld entirely —
not merely emptied — until `publishedAt` is at least 7 days after
`reportedAt`. The row still records that a check happened and how many
MUST-level items are outstanding; it never records the specifics early.

The workflow:

1. The weekly job finds a MUST-level violation on a target. The row commits
   with `mustViolationCount > 0`, `publishable: false`, and no finding
   detail.
2. Whoever maintains the board files an issue against the target server
   naming the violation, and adds `"reportedAt"` to that target's entry in
   `roster.json` (the date the issue was filed).
3. On or after `reportedAt + 7 days`, add `"publishedAt"` to the same
   entry. The next weekly run (or a manual `workflow_dispatch`) then
   produces a row with `publishable: true` and the full finding detail.

## Scope note: `compat.ttl_overpromise`

The D-group rule catalog (`packages/snapgauge/src/core/compat/engine.ts`)
names one check the board's per-run engine deliberately does not evaluate
yet: `compat.ttl_overpromise` — "the surface changed between two recorded
runs closer together than the `ttlMs` the server told clients to cache
for." That check is inherently a MULTI-run comparison (it needs the
board's own time series, not a single check), and with the roster empty
there is no real history to design or verify it against yet. Every other
D-group check named in SPEC §8 (era, advertised-version honesty,
per-connection stability) is single-run and IS implemented
(`checkBoardTarget`, `packages/snapgauge/src/node/board-runner.ts`).
Revisit `compat.ttl_overpromise` once the roster has real, dated history to
compare — building it against zero data now would be guessing at a shape.

## Auth-gated servers

A target that answers with HTTP 401/403 is recorded as
`status: "auth_required"` — never guessed as failing or passing the checks
it could not run. Same for a target that is simply unreachable
(`status: "unreachable"`, with the observed reason in `statusDetail`, never
a fabricated one).
