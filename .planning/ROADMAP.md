# Roadmap: replays-fetcher

## Milestones

- [x] **v1.0 Initial Ingest Service** — Phases 1-6, shipped 2026-05-10. Full archive: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- [x] **v2.0 Full-Corpus Ingest Resilience** — Phases 7-12, shipped 2026-06-12. Full archive: [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)
- [ ] **v3.0 Track C Toolchain Convergence (pilot)** — Phases 13-18, started 2026-06-13. Migrate the fetcher onto Oxlint + Oxfmt + tsdown + Vitest via a shared `@solid-stats/ts-toolchain` git repo, plus lefthook hooks. Behavior-preserving; `verify` green at 100% coverage. Pilot before `server-2` and `web`.

## Phases

<details>
<summary>✅ v1.0 Initial Ingest Service (Phases 1-6) — SHIPPED 2026-05-10</summary>

- [x] Phase 1: Project Foundation and Integration Contract (1/1 plans) — completed 2026-05-09
- [x] Phase 2: Source Discovery and Dry Run (4/4 plans) — completed 2026-05-09
- [x] Phase 3: Raw Replay Storage (4/4 plans) — completed 2026-05-09
- [x] Phase 4: Staging and Promotion Handoff (4/4 plans) — completed 2026-05-09
- [x] Phase 5: Scheduled Operations and Validation (4/4 plans) — completed 2026-05-09
- [x] Phase 6: Close v1 audit gaps: connectivity checks and discovered timestamp staging evidence (6/6 plans) — completed 2026-05-10

</details>

<details>
<summary>✅ v2.0 Full-Corpus Ingest Resilience (Phases 7-12) — SHIPPED 2026-06-12</summary>

- [x] Phase 7: v2 Foundations (3/3 plans) — completed 2026-06-07
- [x] Phase 8: Source Failure Diagnostics and Retry (4/4 plans) — completed 2026-06-08
- [x] Phase 9: Checkpoint and Resume (5/5 plans) — completed 2026-06-09
- [x] Phase 10: Dynamic Source Range and Rate Limiting (5/5 plans) — completed 2026-06-11
- [x] Phase 11: Progress Events and Compact Evidence (5/5 plans) — completed 2026-06-12
- [x] Phase 12: Source Contract Guards (2/2 plans) — completed 2026-06-12

</details>

### ▶ v3.0 Track C Toolchain Convergence (Phases 13-18) — IN PROGRESS

Behavior-preserving toolchain migration. The `verify` gate must stay green at 100% coverage at every phase boundary.

- [x] **Phase 13: Shared `@solid-stats/ts-toolchain` Bootstrap** — CFG-01, CFG-02, CFG-03, CFG-04 (completed 2026-06-13)
  - Goal: Stand up the shared config git repo `git@github.com:solid-stats/ts-toolchain.git` (tsconfig/oxlint/oxfmt/vitest presets + `lefthook.yml`) with self-validating CI, and wire the fetcher to consume it as a tag/commit-pinned pnpm git-dependency (`github:solid-stats/ts-toolchain#<tag>`), proven end-to-end by `tsconfig.json` extending the shared base.
  - Success criteria:
    1. `@solid-stats/ts-toolchain` repo exists with the five presets + `lefthook.yml`.
    2. Its own CI lints/formats/typechecks the preset files before a consumable tag is cut.
    3. Fetcher `package.json` carries the git-dep pinned by tag/commit; `pnpm-lock.yaml` is reproducible (frozen-lockfile install works in CI + Docker).
    4. Fetcher `tsconfig.json` extends the shared base; `pnpm verify` stays green.
  - Plans: 3 plans (waves 1→2→3)
    - [x] 13-01-PLAN.md — Author + push shared `solid-stats/ts-toolchain` master: 5 presets + lefthook.yml + config-only package.json (exports) + self-validating CI (CFG-01, CFG-02)
    - [x] 13-02-PLAN.md — Confirm green shared-repo CI, then cut + push annotated consumable tag `v0.1.0` on the green SHA (CFG-02 gate)
    - [x] 13-03-PLAN.md — Add tag-pinned git-dep to fetcher, regenerate frozen lockfile, switch `tsconfig.json` to extends shared base, prove `pnpm verify` green (CFG-03, CFG-04)

- [x] **Phase 14: Repository Cleanup & Convention Compliance** — CLN-01, CLN-02, CLN-03, CLN-04 (completed 2026-06-13)
  - Goal: Bring the code to a clean, `solidstats-fetcher-ts-*`-compliant baseline on the still-ESLint toolchain, so the later Oxlint swap audits already-correct code.
  - Success criteria:
    1. Dead code, unused config, and stale scripts removed.
    2. Stale TODO/FIXME cleared or promoted to tracked work.
    3. Redundant `eslint-disable`/suppressions removed; ignore files tightened.
    4. Convention-skill review passes; ingest-boundary invariants intact; `pnpm verify` green.

- [x] **Phase 15: Oxfmt Formatter Migration** — FMT-01, FMT-02 (completed 2026-06-13)
  - Goal: Replace Prettier with Oxfmt (shared `.oxfmtrc` preset) and land the repo-wide reformat as a single isolated commit before the linter swap, so format churn does not collide with lint changes.
  - Success criteria:
    1. Prettier removed; `pnpm format`/`format:check` run oxfmt against the shared preset.
    2. The repo-wide reformat is a single, verifiably format-only commit.
    3. `pnpm verify` green.

- [x] **Phase 16: Oxlint Migration & Import Hygiene** — LNT-01, LNT-02, LNT-03, LNT-04, IMP-01, IMP-02 (completed 2026-06-14)
  - Goal: Replace ESLint with Oxlint (ported rule options), drop `eslint-plugin-import` entirely, and wire dependency-cruiser + knip to cover the dropped gap — all in one coupled swap.
  - Success criteria:
    1. ESLint + plugins removed; `pnpm lint` runs oxlint green; `.oxlintrc.json` extends the shared preset (options ported, no `js.configs.all`, `unicorn/no-null` + `no-await-in-loop` off).
    2. A before/after rule-delta is documented and every dropped rule explicitly accepted.
    3. Type-aware oxlint (oxlint-tsgolint) re-validated on this repo and kept non-blocking in `verify`.
    4. dependency-cruiser (no-cycle/boundaries) + knip (unused/dep hygiene) wired into `verify`; a planted cycle is caught.

- [x] **Phase 17: tsdown Build & Docker Smoke** — BLD-01, BLD-02 (completed 2026-06-14)
  - Goal: Replace `tsc` emit with a tsdown single-entry ESM bundle and prove the built CLI runs in a clean Docker image.
  - Plans: 1 plan (wave 1)
    - [x] 17-01-PLAN.md — BLD-01/02: swap tsc-emit→tsdown@0.22.2 (build script + bin + delete tsconfig.build.json), update Dockerfile + Docker smoke-run of `check`, verify green at 100% coverage (Wave 1)
  - Success criteria:
    1. `pnpm build` runs tsdown (single-entry ESM, deps externalized); `tsc` emit + `tsconfig.build.json` removed; `tsc --noEmit` retained as the typecheck.
    2. The Dockerfile builds via tsdown; the bundled CLI passes a Docker smoke-run of `check`.
    3. `pnpm verify` green.

- [ ] **Phase 18: lefthook Hooks & CI Verify Convergence** — HOK-01, HOK-02, HOK-03, VRF-01, VRF-02, VRF-03
  - Goal: Wire client-side lefthook hooks from the shared preset and finalize the full new `verify` pipeline + CI on the new command surface at 100% coverage.
  - Success criteria:
    1. lefthook pre-commit (Oxfmt + Oxlint staged) + pre-push (`tsc` + Vitest) installed from `@solid-stats/ts-toolchain`, mirroring CI, bypassable with `--no-verify`.
    2. `pnpm verify` runs the full new surface (oxfmt → oxlint → tsc → unit → integration → coverage → tsdown → depcruise → knip) green from a clean checkout.
    3. V8 coverage stays 100% reachable source; the measured file set is not reduced.
    4. CI is rewritten onto the new command surface.

### Phase 13: Shared `@solid-stats/ts-toolchain` Bootstrap

**Goal**: Stand up the shared config git repo `git@github.com:solid-stats/ts-toolchain.git` (tsconfig/oxlint/oxfmt/vitest presets + `lefthook.yml`) with self-validating CI, and wire the fetcher to consume it as a tag/commit-pinned pnpm git-dependency (`github:solid-stats/ts-toolchain#<tag>`), proven end-to-end by `tsconfig.json` extending the shared base.
**Depends on**: Nothing (first v3.0 phase; builds on the v2 codebase and current ESLint/Prettier/tsc toolchain)
**Requirements**: CFG-01, CFG-02, CFG-03, CFG-04
**Success Criteria** (what must be TRUE):

  1. `@solid-stats/ts-toolchain` repo exists with the five presets + `lefthook.yml`.
  2. Its own CI lints/formats/typechecks the preset files before a consumable tag is cut.
  3. Fetcher `package.json` carries the git-dep pinned by tag/commit; `pnpm-lock.yaml` is reproducible (frozen-lockfile install works in CI + Docker).
  4. Fetcher `tsconfig.json` extends the shared base; `pnpm verify` stays green.

---

### Phase 14: Repository Cleanup & Convention Compliance

**Goal**: Bring the code to a clean, `solidstats-fetcher-ts-*`-compliant baseline on the still-ESLint toolchain, so the later Oxlint swap audits already-correct code.
**Depends on**: Phase 13 (shared toolchain wired; cleanup runs inside the converged-config repo while still on ESLint)
**Requirements**: CLN-01, CLN-02, CLN-03, CLN-04
**Success Criteria** (what must be TRUE):

  1. Dead code, unused config, and stale scripts removed.
  2. Stale TODO/FIXME cleared or promoted to tracked work.
  3. Redundant `eslint-disable`/suppressions removed; ignore files tightened.
  4. Convention-skill review passes; ingest-boundary invariants intact; `pnpm verify` green.

**Plans:** 4/4 plans complete

Plans:

- [x] 14-01-PLAN.md — CLN-01/02/03: remove deprecated pnpm field, confirm 0 TODO/FIXME, justify 9 no-await-in-loop suppressions (Wave 1)
- [x] 14-02-PLAN.md — CLN-04a/b: ConfigError → ConfigValidationError extends AppError; add .max() bounds to 11 config fields (Wave 2)
- [x] 14-03-PLAN.md — CLN-04c: move RunSummary contract to src/types/, fix evidence→run boundary fence (Wave 3)
- [x] 14-04-PLAN.md — CLN-04d: split the 822-line cli.ts god-file into src/commands/ (HIGH risk, isolated last wave) (Wave 4)

---

### Phase 15: Oxfmt Formatter Migration

**Goal**: Replace Prettier with Oxfmt (shared `.oxfmtrc` preset) and land the repo-wide reformat as a single isolated commit before the linter swap, so format churn does not collide with lint changes.
**Depends on**: Phase 13 (shared `.oxfmtrc` preset), Phase 14 (clean baseline before the repo-wide reformat)
**Requirements**: FMT-01, FMT-02
**Plans**: 1 plan
**Success Criteria** (what must be TRUE):

  1. Prettier removed; `pnpm format`/`format:check` run oxfmt against the shared preset.
  2. The repo-wide reformat is a single, verifiably format-only commit.
  3. `pnpm verify` green.

Plans:

- [x] 15-01-PLAN.md — Swap prettier→oxfmt 0.54.0 (deps + .oxfmtrc.json + .prettierignore + scripts/verify), then isolated repo-wide reformat (FMT-01, FMT-02)

---

### Phase 16: Oxlint Migration & Import Hygiene

**Goal**: Replace ESLint with Oxlint (ported rule options), drop `eslint-plugin-import` entirely, and wire dependency-cruiser + knip to cover the dropped gap — all in one coupled swap.
**Depends on**: Phase 15 (format churn already landed as an isolated commit before the linter swap)
**Requirements**: LNT-01, LNT-02, LNT-03, LNT-04, IMP-01, IMP-02
**Success Criteria** (what must be TRUE):

  1. ESLint + plugins removed; `pnpm lint` runs oxlint green; `.oxlintrc.json` extends the shared preset (options ported, no `js.configs.all`, `unicorn/no-null` + `no-await-in-loop` off).
  2. A before/after rule-delta is documented and every dropped rule explicitly accepted.
  3. Type-aware oxlint (oxlint-tsgolint) re-validated on this repo and kept non-blocking in `verify`.
  4. dependency-cruiser (no-cycle/boundaries) + knip (unused/dep hygiene) wired into `verify`; a planted cycle is caught.

**Plans:** 6/6 plans complete

- [x] 16-01-PLAN.md — oxlint swap: install oxlint@1.69.0, `.oxlintrc.json` (extends preset + ported options), lint/lint:types scripts, delete eslint.config.js
- [x] 16-02-PLAN.md — code-fix #1: func-style (`function`→`const`) across src/ (the bulk), 450 tests unchanged
- [x] 16-03-PLAN.md — code-fix #2: method-signature/member-accessibility/type-specifier/custom-error/id-length + disable-comment modernization → `pnpm lint` green
- [x] 16-04-PLAN.md — RULE-DELTA.md (32 dropped rules + dispositions) + lint:types re-validation (non-blocking)
- [x] 16-05-PLAN.md — dependency-cruiser (`--init`, no-cycle + boundary warn) + planted-cycle proof
- [x] 16-06-PLAN.md — knip (conservative) + final verify chain + full `sg docker` gate at 100% coverage

---

### Phase 17: tsdown Build & Docker Smoke

**Goal**: Replace `tsc` emit with a tsdown single-entry ESM bundle and prove the built CLI runs in a clean Docker image.
**Depends on**: Phase 16 (lint/import hygiene settled before the build tool swaps)
**Requirements**: BLD-01, BLD-02
**Success Criteria** (what must be TRUE):

  1. `pnpm build` runs tsdown (single-entry ESM, deps externalized); `tsc` emit + `tsconfig.build.json` removed; `tsc --noEmit` retained as the typecheck.
  2. The Dockerfile builds via tsdown; the bundled CLI passes a Docker smoke-run of `check`.
  3. `pnpm verify` green.

**Plans:** 1/1 plans complete

Plans:

- [ ] 17-01-PLAN.md — BLD-01/02: swap tsc-emit→tsdown@0.22.2 (build script + bin + delete tsconfig.build.json), update Dockerfile + Docker smoke-run of `check`, verify green at 100% coverage

---

### Phase 18: lefthook Hooks & CI Verify Convergence

**Goal**: Wire client-side lefthook hooks from the shared preset and finalize the full new `verify` pipeline + CI on the new command surface at 100% coverage.
**Depends on**: Phases 15, 16, 17 (finalizes the full new command surface after formatter, linter, and build tools are all swapped)
**Requirements**: HOK-01, HOK-02, HOK-03, VRF-01, VRF-02, VRF-03
**Success Criteria** (what must be TRUE):

  1. lefthook pre-commit (Oxfmt + Oxlint staged) + pre-push (`tsc` + Vitest) installed from `@solid-stats/ts-toolchain`, mirroring CI, bypassable with `--no-verify`.
  2. `pnpm verify` runs the full new surface (oxfmt → oxlint → tsc → unit → integration → coverage → tsdown → depcruise → knip) green from a clean checkout.
  3. V8 coverage stays 100% reachable source; the measured file set is not reduced.
  4. CI is rewritten onto the new command surface.

---

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-6 | v1.0 | 23/23 | Complete | 2026-05-10 |
| 7. v2 Foundations | v2.0 | 3/3 | Complete | 2026-06-07 |
| 8. Source Failure Diagnostics and Retry | v2.0 | 4/4 | Complete | 2026-06-08 |
| 9. Checkpoint and Resume | v2.0 | 5/5 | Complete | 2026-06-09 |
| 10. Dynamic Source Range and Rate Limiting | v2.0 | 5/5 | Complete | 2026-06-11 |
| 11. Progress Events and Compact Evidence | v2.0 | 5/5 | Complete | 2026-06-12 |
| 12. Source Contract Guards | v2.0 | 2/2 | Complete | 2026-06-12 |
| 13. Shared @solid-stats/ts-toolchain Bootstrap | v3.0 | 3/3 | Complete   | 2026-06-13 |
| 14. Repository Cleanup & Convention Compliance | v3.0 | 4/4 | Complete   | 2026-06-13 |
| 15. Oxfmt Formatter Migration | v3.0 | 1/1 | Complete   | 2026-06-13 |
| 16. Oxlint Migration & Import Hygiene | v3.0 | 6/6 | Complete   | 2026-06-14 |
| 17. tsdown Build & Docker Smoke | v3.0 | 1/1 | Complete   | 2026-06-14 |
| 18. lefthook Hooks & CI Verify Convergence | v3.0 | 0/? | Pending | — |

---

*v1.0 archived 2026-05-10. v2.0 archived 2026-06-12. v3.0 Track C started 2026-06-13 (Phases 13-18). Plan the first phase with `/gsd-plan-phase 13`.*
