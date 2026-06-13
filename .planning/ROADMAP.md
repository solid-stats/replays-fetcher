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

- [ ] **Phase 13: Shared `@solid-stats/ts-toolchain` Bootstrap** — CFG-01, CFG-02, CFG-03, CFG-04
  - Goal: Stand up the shared config git repo `git@github.com:solid-stats/ts-toolchain.git` (tsconfig/oxlint/oxfmt/vitest presets + `lefthook.yml`) with self-validating CI, and wire the fetcher to consume it as a tag/commit-pinned pnpm git-dependency (`github:solid-stats/ts-toolchain#<tag>`), proven end-to-end by `tsconfig.json` extending the shared base.
  - Success criteria:
    1. `@solid-stats/ts-toolchain` repo exists with the five presets + `lefthook.yml`.
    2. Its own CI lints/formats/typechecks the preset files before a consumable tag is cut.
    3. Fetcher `package.json` carries the git-dep pinned by tag/commit; `pnpm-lock.yaml` is reproducible (frozen-lockfile install works in CI + Docker).
    4. Fetcher `tsconfig.json` extends the shared base; `pnpm verify` stays green.

- [ ] **Phase 14: Repository Cleanup & Convention Compliance** — CLN-01, CLN-02, CLN-03, CLN-04
  - Goal: Bring the code to a clean, `solidstats-fetcher-ts-*`-compliant baseline on the still-ESLint toolchain, so the later Oxlint swap audits already-correct code.
  - Success criteria:
    1. Dead code, unused config, and stale scripts removed.
    2. Stale TODO/FIXME cleared or promoted to tracked work.
    3. Redundant `eslint-disable`/suppressions removed; ignore files tightened.
    4. Convention-skill review passes; ingest-boundary invariants intact; `pnpm verify` green.

- [ ] **Phase 15: Oxfmt Formatter Migration** — FMT-01, FMT-02
  - Goal: Replace Prettier with Oxfmt (shared `.oxfmtrc` preset) and land the repo-wide reformat as a single isolated commit before the linter swap, so format churn does not collide with lint changes.
  - Success criteria:
    1. Prettier removed; `pnpm format`/`format:check` run oxfmt against the shared preset.
    2. The repo-wide reformat is a single, verifiably format-only commit.
    3. `pnpm verify` green.

- [ ] **Phase 16: Oxlint Migration & Import Hygiene** — LNT-01, LNT-02, LNT-03, LNT-04, IMP-01, IMP-02
  - Goal: Replace ESLint with Oxlint (ported rule options), drop `eslint-plugin-import` entirely, and wire dependency-cruiser + knip to cover the dropped gap — all in one coupled swap.
  - Success criteria:
    1. ESLint + plugins removed; `pnpm lint` runs oxlint green; `.oxlintrc.json` extends the shared preset (options ported, no `js.configs.all`, `unicorn/no-null` + `no-await-in-loop` off).
    2. A before/after rule-delta is documented and every dropped rule explicitly accepted.
    3. Type-aware oxlint (oxlint-tsgolint) re-validated on this repo and kept non-blocking in `verify`.
    4. dependency-cruiser (no-cycle/boundaries) + knip (unused/dep hygiene) wired into `verify`; a planted cycle is caught.

- [ ] **Phase 17: tsdown Build & Docker Smoke** — BLD-01, BLD-02
  - Goal: Replace `tsc` emit with a tsdown single-entry ESM bundle and prove the built CLI runs in a clean Docker image.
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
| 13. Shared @solid-stats/ts-toolchain Bootstrap | v3.0 | 0/? | Pending | — |
| 14. Repository Cleanup & Convention Compliance | v3.0 | 0/? | Pending | — |
| 15. Oxfmt Formatter Migration | v3.0 | 0/? | Pending | — |
| 16. Oxlint Migration & Import Hygiene | v3.0 | 0/? | Pending | — |
| 17. tsdown Build & Docker Smoke | v3.0 | 0/? | Pending | — |
| 18. lefthook Hooks & CI Verify Convergence | v3.0 | 0/? | Pending | — |

---

*v1.0 archived 2026-05-10. v2.0 archived 2026-06-12. v3.0 Track C started 2026-06-13 (Phases 13-18). Plan the first phase with `/gsd-plan-phase 13`.*
