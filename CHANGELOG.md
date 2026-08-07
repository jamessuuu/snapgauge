# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: semver.

## [Unreleased]

### Added
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
