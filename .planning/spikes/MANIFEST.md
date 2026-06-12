# Spike Manifest

## Idea

Track C (TS Toolchain Convergence) de-risking spike: prove the VoidZero/Vite+ toolchain
on `replays-fetcher` before it reaches the migration critical path. Three questions from
[TS-TOOLCHAIN-CONVERGENCE](../../../plans/product/TS-TOOLCHAIN-CONVERGENCE.md): port
vocalclub's curated rules to an Oxlint preset and measure coverage + type-aware stability
(OQ-1b/OQ-1c); inspect the real Oxfmt reformat diff before committing 3 repos to it; and
validate a tsdown build + Docker smoke-run of the built CLI (OQ-2).

## Requirements

Design decisions that emerged and are non-negotiable for the real `@solidstats/config` build:

- The preset **must port each rule's options**, not just severities — severity-only porting
  produced 1336 false-positive findings on a currently-green repo (spike 001).
- `eslint-plugin-import` is **dropped entirely**, not kept as an ESLint residual (spike 004): `tsc`
  covers `no-unresolved`, **dependency-cruiser** (`--init` config) covers `no-cycle`+boundaries,
  **knip** covers `no-unused-modules`+dependency hygiene. Only `import/order` may need a tiny
  `simple-import-sort`/Biome residual — decide at plan-phase. `good-fence` not needed (depcruise superset).
- `no-await-in-loop` stays **off** in backends (sequential I/O) as a per-repo override.
- Type-aware (tsgolint alpha) must be **re-validated per repo** (`server-2` next) before cutover.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | oxlint-preset-port | standard | vocalclub rules → Oxlint preset; coverage (OQ-1b) + type-aware CI-readiness (OQ-1c) on real src | ✅ VALIDATED | oxlint, tsgolint, type-aware, oq-1b, oq-1c |
| 002 | oxfmt-format-diff | standard | Oxfmt vs current Prettier on real files — style delta acceptable before reformatting 3 repos | ✅ VALIDATED | oxfmt, formatting |
| 003 | tsdown-docker-smoke | standard | tsdown build of CLI; deps externalized + bundle executes in clean Docker image (OQ-2 fully closed) | ✅ VALIDATED | tsdown, docker, build, oq-2 |
| 004 | depcruise-knip-import-gap | standard | Oxlint import-rule gap covered by tsc + dependency-cruiser + knip (no ESLint residual); only import/order remains | ✅ VALIDATED | dependency-cruiser, knip, import, oq-1b |
