# Project Research Summary — v3.0 Track C Toolchain Convergence

**Project:** replays-fetcher
**Milestone:** v3.0 Track C Toolchain Convergence (pilot)
**Synthesized:** 2026-06-13

> Provenance: STACK / FEATURES / ARCHITECTURE / PITFALLS were produced by the GSD research subagents (working build, after the GSD reinstall). This SUMMARY was assembled by the orchestrator because the synthesizer hit the known #222 write-refusal and returned its content inline instead of writing the file — its findings are folded in below. The shared package is `@solid-stats/ts-toolchain` (`git@github.com:solid-stats/ts-toolchain.git`); the earlier name `@solidstats/config` is retired.

## Key Findings

**Toolchain-only migration.** The five-band ingest pipeline, CLI, S3/PostgreSQL boundaries, and `src/` are frozen. Behavior is preserved; `verify` stays green at 100% coverage at every step. All recommendations are empirically proven on real code by spikes 001–004.

**Locked, spike-proven stack:**
- **Oxlint 1.69.0** replaces ESLint — config `.oxlintrc.json`, plugins `["typescript","unicorn","import","oxc"]`, `typescript/` rule prefix. **Port each rule's options, not severities** (severity-only = 1336 false positives, spike 001). Drop `js.configs.all`; `unicorn/no-null` off; `no-await-in-loop` off (backend).
- **Oxfmt 0.54.0** replaces Prettier — `.oxfmtrc.json`, seed via `oxfmt --migrate=prettier`. At **`printWidth: 80` the diff against current Prettier output is zero** (spike 002) — the formatter swap is essentially free; the churn risk only appears at Oxfmt's wider default.
- **tsdown 0.22.2** replaces `tsc` emit — single entry `src/cli.ts` → one externalized **`dist/cli.mjs` (~133 kB)**, ESM, `--platform node`; all 6 runtime deps external by default (spike 003). Docker cold-start smoke is the runtime gate.
- **eslint-plugin-import dropped entirely** → `tsc` (no-unresolved) + **dependency-cruiser** (no-cycle/boundaries) + **knip** (unused/dep hygiene). **dependency-cruiser MUST use `--init` config — a hand-authored config produced 220 false `not-to-unresolvable` errors on this NodeNext repo** (spike 004). Only `import/order` is a genuine orphan (decide at plan-phase).
- **oxlint-tsgolint** (type-aware) was validated on this repo (no crashes, ~+160 ms, heavy `strictTypeChecked` rules fire) but stays a **separate non-blocking step** outside `verify` until each repo re-validates it; `server-2` re-validates before its cutover.
- **lefthook** hooks from the shared preset: pre-commit (Oxfmt + Oxlint staged), pre-push (`tsc` + Vitest); mirrors — not replaces — CI `verify`. **Vitest 4 and `tsc --noEmit` stay.**

**`@solid-stats/ts-toolchain`** is a standalone GitHub repo (`solid-stats` org) consumed as a pnpm git-dep **pinned by tag/commit SHA** (`github:solid-stats/ts-toolchain#<tag>`) — a branch ref silently re-resolves, so the pin + a working `--frozen-lockfile` install in CI and Docker are mandatory. It ships tsconfig/oxlint/oxfmt/vitest presets + `lefthook.yml`; backends consume the VoidZero **subset** (no full Vite+ runtime mgmt for a CLI). Built and hardened in this pilot, then reused by `server-2` → `web`.

## Implications for Roadmap

The 6 phases (13–18) in ROADMAP.md follow the hard dependency order; each keeps `verify` green:

1. **Phase 13 — Bootstrap `@solid-stats/ts-toolchain`** repo + tag (self-validating); gates everything.
2. **Phase 14 — Cleanup + convention-skill refactor** on the still-ESLint baseline (clean code before the new linter audits).
3. **Phase 15 — Oxfmt** migration — one isolated reformat commit (zero-diff at printWidth 80).
4. **Phase 16 — Oxlint + import hygiene** — port rule options, document rule-delta, drop import-plugin, wire depcruise (`--init`) + knip; type-aware non-blocking.
5. **Phase 17 — tsdown** build + Docker cold-start smoke + Dockerfile update.
6. **Phase 18 — lefthook** hooks + full CI `verify` rewrite at 100% coverage.

## Watch Out For (pitfall → gate)
- Silent lint-coverage loss → before/after rule-delta diff, document drops (Oxlint phase).
- depcruise hand-authored config → use `--init` only (Oxlint/gates phase).
- Alpha type-aware flaking → keep non-blocking until clean on this repo (Oxlint phase).
- tsdown runtime breakage → Docker cold-start smoke, not just a green build (tsdown phase).
- Reformat churn → isolated format-only commit; hold printWidth 80 (Oxfmt phase).
- git-dep drift → pin tag/commit SHA + `--frozen-lockfile` in CI/Docker (bootstrap/CI phase).
- `npm install` corrupts this pnpm repo → pnpm only (every phase).
- Coverage measuring fewer files → compare file-count/totals to baseline each phase.

## Open Gaps for Planning
- `@solid-stats/ts-toolchain` repo creation is external to this repo and a Phase 13 prerequisite (repo URL confirmed: `git@github.com:solid-stats/ts-toolchain.git`).
- `import/order` orphan: `simple-import-sort` residual vs. accept loss — decide in Phase 16.
- `server-2` tsgolint re-validation — not pilot scope; prerequisite before type-aware becomes blocking there.

## Sources
- `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md` (this research pass).
- `.planning/spikes/MANIFEST.md`, `.planning/spikes/CONVENTIONS.md`, spike outputs 001–004.
- `plans/product/TS-TOOLCHAIN-CONVERGENCE.md`, `plans/product/RELEASE-PLAN.md`.
