# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: semver.

## [Unreleased]

### Added
- M6 (the board, SPEC §8/§10): `boards/<YYYY-MM-DD>.json` + `boards/roster.json`
  Zod schemas (`packages/snapgauge/src/core/board/schema.ts`) — the roster
  is structurally narrower than a full config target (no `headers`, no
  `probes`: the board is unauthenticated read-only and never calls
  `tools/call` on a third party, enforced by the type, not merely by
  convention); `checkBoardTarget` (`src/node/board-runner.ts`) reuses the
  M4 compat engine with an empty probe spec and a filtered T-group
  assertion list (`BOARD_TRANSPORT_ASSERTIONS`, excludes
  `transport.meta_missing_not_32602` for the identical reason
  `apps/web`'s `/live` check already excludes it) to produce era,
  advertised `supportedVersions`, the T-group framing assertions,
  cache-hint presence, `x-mcp-header` validity and the D-group checks
  reachable without `tools/call` (advertised-version honesty,
  per-connection stability, the legacy-initialize era probe) — proven by a
  real-HTTP test that records every JSON-RPC method a target receives and
  asserts `tools/call` never appears. The binding disclosure policy is
  enforced in code (`core/board/disclosure.ts`): `buildBoardRow` computes
  `mustViolationCount` from a run's MUST-fail assertions + violation-class
  findings and withholds `era`/`supportedVersions`/`assertions`/`findings`
  entirely — not merely empties them — until `publishedAt` is at least 7
  days after `reportedAt`; the 7-day boundary is unit-tested on both sides.
  `.github/workflows/board.yml`: weekly cron + `workflow_dispatch`,
  guarded to the canonical repo, minimal (`contents: write`) permissions,
  a deliberate no-op while the roster is empty (`scripts/run-board.mjs`)
  that never fails the job over having nothing to check. `/board` now
  renders committed board rows through `apps/web/src/lib/board-render.ts`
  as neutral observations — a banned-word test covers both the fixed label
  vocabulary and rendered output, including the `xhdr.unsafe_integer`
  edge case (legitimate "unsafe-integer" spec vocabulary, not a security
  claim) — while the M5 empty state and the >10-day dead-man banner are
  unchanged. `compat.ttl_overpromise` (the one D-group rule that is
  inherently a multi-run comparison) is deliberately deferred: the roster
  ships empty, so there is no real board history to design or verify it
  against yet (`boards/README.md`).
- M3 (full diff taxonomy, SPEC §10): every rule id in the SPEC §5 tier
  table implemented in a metadata-carrying registry (36 rules: 13 breaking
  + the annotation.*.relaxed family at risky + 8 compatible + 4 cosmetic),
  direction-aware with recursive schema walks (nested `properties`), enum
  set semantics (introduced = narrowed, dropped = widened), x-mcp-header
  binding diffs (xhdr.added / xhdr.changed), behavior-probe error.code
  comparison, cache-hint rules on discover + toolsList, whitespace-only
  text demoted to cosmetic; docs/RULES.md generated from the registry
  (`pnpm docs:rules`) with a byte-equality drift-guard test; order rules —
  order.changed (stable reorder, risky) and order.nondeterministic (3-repeat
  instability, risky, NEVER a false breaking); snapshot formatVersion
  migration scaffold (forward-only pure functions, purity+chain-gap+stamp
  enforcement, applied on `--migrate` only — diff and check gained the
  flag); built-in volatile-key list finalized and unit-covered; ten new
  planted drift fixtures + flaky-order (seeded shuffle) + clean@v1-shuffled
  (scrambled wire key order); golden set grown to 30 cases at 100% exact
  match, plus the false-positive suite (clean→clean under every registered
  profile), the stability eval (record twice → byte-identical) and the
  determinism eval (shuffled key order → identical snapshot).
  RULESET_VERSION bumped to 2.
- M2 (transports + check, SPEC §10): `http` transport over undici with the
  one-implementation address policy (SPEC §3 Decision 4 — DNS resolve, full
  RFC1918/loopback/link-local/CGNAT/IPv6-ULA-and-mapped/metadata block list,
  resolved-IP pinning via a connect-time lookup override, redirects never
  followed; CLI default `allow-private`, `--strict-net` selects
  `public-only`); `stdio` transport (spawn, per-request timeout default 10s,
  SIGKILL teardown, no orphans — e2e-verified); behavior probes (tools/call
  per declared probe: shape capture with sha256'd text blocks by default,
  opt-in value capture with built-in volatile-key normalization; JSON-RPC
  errors captured as data, transport failures marked missing evidence per
  SPEC §6); `check` (probe live → diff vs stored → gate → exit codes,
  never writes without `--update`), `init` (probes the target, seeds probes
  from tools/list), `report` (pure reformat) and the `ci` alias; config
  loader (`snapgauge.config.json` canonical, Zod strict with unknown keys
  rejected, `${ENV}` header interpolation with literal-credential warnings,
  `.mjs`/`.ts` via dynamic import); reporters text/json/github/md; the
  T-group transport-assertion framework with appliesTo — HTTP-only
  assertions print `n/a (stdio)` WITH the reason, never silently passed —
  and the first five framing assertions; fixtures gained tools/call with
  required `_meta`, a conformant raw Streamable-HTTP framing handler, a
  real node:http adapter and a stdio bin (both e2e-exercised); error codes
  AUTH / TARGET_NOT_ALLOWED / PROBE_TIMEOUT (all exit-2 class).
- M1 (walking skeleton, SPEC §10): snapshot model v1 with strict Zod schema
  and canonical on-disk format (keys sorted, 2-space indent, LF, trailing
  newline; tool arrays body-sorted with observed order in `toolsList.order`;
  volatile-selector normalization; recordedAt excluded from every diff);
  `record`/`diff` over the in-process fixture transport with JSON-RPC + wire
  results Zod-parsed before interpretation; six diff rules spanning the four
  tiers (tool.removed, tool.input.required.added, tool.description.changed,
  tool.input.optional.added, tool.icons.changed, serverInfo.version.changed);
  exit-code taxonomy 0/1/2/4/5 (3 reserved for M4); `snapgauge record|diff`
  CLI (commander) with `--fail-on` gate and `--json`; @snapgauge/fixtures
  with clean@v1, clean@v2-identical, drift-breaking@v2, drift-cosmetic@v2;
  three golden eval cases scored by set equality (breaking drift exact set,
  identical → zero findings, cosmetic-only → listed but exit 0).
- M0: pnpm workspace (snapgauge / fixtures / web placeholder), TS strict +
  `noUncheckedIndexedAccess`, ESLint 9 flat config with the core
  no-node-builtins boundary rule (SPEC §3), Vitest 4 unit+eval projects,
  five-stage CI (typecheck → lint → unit → e2e:smoke → eval) plus build +
  pack-check guards, MIT license with brand-asset carve-out, SECURITY.md
  policy stub (SPEC §9 topics), SPEC committed.
