# Features (Deliverables) — v3.0 Track C Toolchain Convergence

**Researched:** 2026-06-13 (authored inline from locked sources)

The "features" of this milestone are migration deliverables — the toolchain changes, not ingest behavior (which is frozen). Track C names 4 work items; this pilot adds bootstrapping the shared config repo. Categories below feed requirement definition and phase ordering.

## Table stakes (must land for v3.0 to be done)

| # | Deliverable | Expected behavior | Acceptance signal | Complexity |
|---|-------------|-------------------|-------------------|------------|
| 1 | **Bootstrap `@solidstats/config` git repo** | Standalone repo holding tsconfig/oxlint/oxfmt/vitest presets + `lefthook.yml`; self-validating CI | Fetcher resolves it as a pnpm git-dep (pinned); presets consumed, not copied | Medium |
| 2 | **Repository cleanup** | Remove dead code, stale TODO/FIXME, unused config/scripts, redundant `eslint-disable`, tighten ignores | `git grep` shows no stale suppressions; verify green from clean checkout | Low |
| 3 | **Convention-skill refactor** | Source brought into `solidstats-fetcher-ts-*` compliance; findings resolved | Code-review skill passes; ingest-boundary gate clean | Medium |
| 4 | **Oxlint migration** | ESLint → Oxlint; vocalclub rule **options** ported; `import` plugin dropped; `no-await-in-loop` off; type-aware re-validated | No ESLint in deps; `.oxlintrc.json` present; before/after rule-delta documented; `pnpm lint` = Oxlint, green | Medium-High |
| 5 | **Oxfmt migration** | Prettier → Oxfmt; one isolated reformat commit | No Prettier dep; `.oxfmtrc.json`; reformat commit is format-only | Low |
| 6 | **tsdown build** | `tsc` emit → tsdown single-entry bundle; deps externalized; Docker smoke of built CLI | `pnpm build` = tsdown; bundled `cli.mjs` runs `check` in a clean Docker image | Medium |
| 7 | **dependency-cruiser + knip gates** | Cover the dropped import-plugin: `no-cycle`/boundaries (depcruise) + unused-modules/dep hygiene (knip) | Both wired into `verify`; a deliberate cycle is caught | Medium |
| 8 | **lefthook hooks** | pre-commit (Oxfmt+Oxlint staged), pre-push (tsc+Vitest); preset from `@solidstats/config`; mirrors CI verify | Hooks installed; commit blocked on unformatted/lint-failing staged files; push blocked on type/test failure | Low |
| 9 | **CI `verify` rewrite + 100% coverage held** | Pipeline moved onto the new command surface; coverage gate unchanged | `pnpm verify` green end-to-end at 100% V8 coverage from clean checkout | Medium |

## Differentiators (nice-to-have, defer if time-short)
- A CI sync-check that diffs the repo's `.oxlintrc.json` against the `@solidstats/config` baseline to catch drift.
- A possible tiny `import/order` residual (`simple-import-sort`) — only if depcruise/knip leave ordering uncovered (decide at plan-phase).

## Anti-features (explicitly NOT in scope)
- Vite / full Vite+ runtime or PM management for this CLI — backends use the VoidZero subset only.
- Porting `@stylistic` rules to Oxlint — formatting belongs to Oxfmt (accepted loss).
- Keeping `eslint-plugin-import`/`import-x` as an ESLint residual.
- Any ingest behavior, staging schema, S3 key layout, source-identity, or cross-service contract change.
- Migrating server-2 or web — this is the pilot only.
- Monorepo / workspace restructuring — polyrepo stays.
- Enabling alpha type-aware (tsgolint) as a blocking CI gate before it validates clean on this repo.

## Dependency ordering
```
cleanup (2) ─┐
refactor (3)─┴─► clean baseline
@solidstats/config bootstrap (1) ─► must exist before fetcher consumes presets
   └─► Oxfmt (5, isolated reformat) ─► Oxlint (4, audits clean+formatted code)
         └─► depcruise+knip (7) ─► tsdown (6, Docker smoke) ─► lefthook (8) ─► CI verify rewrite (9)
```
Key constraints: cleanup + refactor precede Oxlint so new findings are genuinely new; Oxfmt reformat is one isolated commit; lefthook lands after the lint/format/build/test command surface exists; `verify` stays green after every step.

## Sources
- `plans/product/RELEASE-PLAN.md` (Track C items 1–4; Phase 0 Track 1), `plans/product/TS-TOOLCHAIN-CONVERGENCE.md` (Scope, Acceptance Criteria, Config Right-Size).
- `.planning/spikes/MANIFEST.md` (locked requirements), `.planning/PROJECT.md` (v3.0 target features).
