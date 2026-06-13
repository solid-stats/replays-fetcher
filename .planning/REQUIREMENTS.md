# Requirements: replays-fetcher — v3.0 Track C Toolchain Convergence

**Defined:** 2026-06-13
**Core Value:** Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.
**Milestone goal:** Migrate the fetcher onto the VoidZero toolchain (Oxlint + Oxfmt + tsdown + Vitest) via a new shared `@solid-stats/ts-toolchain` git repo, plus lefthook hooks — behavior-preserving, `verify` green at 100% coverage. Pilot before `server-2` and `web`.

## v1 Requirements (this milestone)

### Shared Config (CFG)

- [x] **CFG-01**: A standalone `@solid-stats/ts-toolchain` git repo exists at `git@github.com:solid-stats/ts-toolchain.git`, holding the shared tsconfig / oxlint / oxfmt / vitest presets and a `lefthook.yml`.
- [x] **CFG-02**: The config repo self-validates in its own CI (lint/format/typecheck on the preset files) before a consumable tag is cut.
- [x] **CFG-03**: `replays-fetcher` consumes `@solid-stats/ts-toolchain` as a pnpm git-dependency (`github:solid-stats/ts-toolchain#<tag>`, or `git+ssh://git@github.com/solid-stats/ts-toolchain.git#<tag>`) pinned by tag/commit so the lockfile is reproducible.
- [x] **CFG-04**: The fetcher's config files (tsconfig, `.oxlintrc.json`, `.oxfmtrc.json`, vitest, `lefthook.yml`) reference the shared presets instead of duplicating rule content.

### Cleanup & Convention Compliance (CLN)

- [x] **CLN-01**: Dead code, unused config, and stale scripts are removed from the repository.
- [x] **CLN-02**: Stale TODO/FIXME annotations are cleared or promoted to tracked work.
- [x] **CLN-03**: Redundant `eslint-disable`/suppression comments are removed and ignore files are tightened.
- [x] **CLN-04**: Source passes `solidstats-fetcher-ts-*` convention-skill review with findings resolved; ingest-boundary invariants stay intact.

### Linting — Oxlint (LNT)

- [ ] **LNT-01**: ESLint and its plugins are removed; Oxlint is the sole linter (`pnpm lint` runs oxlint).
- [ ] **LNT-02**: The Oxlint preset ports each vocalclub rule's **options** (not just severities); `js.configs.all` is not used; `unicorn/no-null` and `no-await-in-loop` are off.
- [ ] **LNT-03**: A before/after rule-delta is documented and every dropped rule is explicitly accepted.
- [ ] **LNT-04**: Type-aware Oxlint (oxlint-tsgolint) is re-validated on this repo and kept non-blocking in `verify` until it validates clean.

### Formatting — Oxfmt (FMT)

- [ ] **FMT-01**: Prettier is removed; Oxfmt is the formatter (`pnpm format` / `format:check` run oxfmt).
- [ ] **FMT-02**: The repo-wide reformat lands as a single format-only commit.

### Build — tsdown (BLD)

- [ ] **BLD-01**: The build uses tsdown (single-entry ESM bundle); `tsc` emit and `tsconfig.build.json` are removed; `tsc --noEmit` remains the typecheck step.
- [ ] **BLD-02**: The Dockerfile builds via tsdown and the bundled CLI passes a Docker smoke-run of the `check` command.

### Import Hygiene (IMP)

- [ ] **IMP-01**: dependency-cruiser enforces no-cycle and ingest-boundary import rules inside `verify`.
- [ ] **IMP-02**: knip enforces unused-module and dependency hygiene inside `verify`.

### Git Hooks (HOK)

- [ ] **HOK-01**: lefthook pre-commit runs Oxfmt + Oxlint on staged files.
- [ ] **HOK-02**: lefthook pre-push runs `tsc` typecheck + Vitest.
- [ ] **HOK-03**: Hook config is sourced from `@solid-stats/ts-toolchain`, mirrors (does not replace) the CI `verify` gate, and is bypassable with `--no-verify`.

### Pipeline & Coverage (VRF)

- [ ] **VRF-01**: `pnpm verify` runs the new command surface (oxfmt → oxlint → tsc → unit → integration → coverage → tsdown → depcruise → knip) green from a clean checkout.
- [ ] **VRF-02**: V8 coverage stays at 100% reachable source; the measured file set is not silently reduced by the toolchain change.
- [ ] **VRF-03**: CI is rewritten onto the new command surface.

## Future Requirements (deferred)

### Drift Guard (DFT)

- **DFT-01**: A CI check diffs the repo's `.oxlintrc.json` against the `@solid-stats/ts-toolchain` baseline to catch preset drift.
- **DFT-02**: A residual `import/order` rule (`simple-import-sort`) is added only if depcruise/knip leave import ordering uncovered.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full Vite+ runtime / PM management for the CLI | Backend uses the VoidZero subset only; Vite+ is a frontend entry point |
| Porting `@stylistic` rules to Oxlint | Formatting belongs to Oxfmt; `@stylistic` loss is accepted |
| Keeping `eslint-plugin-import` / `import-x` as an ESLint residual | Dropped entirely; tsc + dependency-cruiser + knip cover the gap |
| Migrating `server-2` or `web` | This is the pilot; those follow per the rollout order |
| Monorepo / workspace restructuring | Polyrepo + git-dep is the decided structure |
| Any ingest behavior, staging schema, S3 key, source-identity, or cross-service contract change | Toolchain-only milestone; behavior is preserved |
| Enabling alpha type-aware as a blocking CI gate before it validates clean here | tsgolint is alpha; re-validate per repo first |

## Traceability

Filled during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Phase 13 | Complete |
| CFG-02 | Phase 13 | Complete |
| CFG-03 | Phase 13 | Complete |
| CFG-04 | Phase 13 | Complete |
| CLN-01 | Phase 14 | Complete |
| CLN-02 | Phase 14 | Complete |
| CLN-03 | Phase 14 | Complete |
| CLN-04 | Phase 14 | Complete |
| FMT-01 | Phase 15 | Pending |
| FMT-02 | Phase 15 | Pending |
| LNT-01 | Phase 16 | Pending |
| LNT-02 | Phase 16 | Pending |
| LNT-03 | Phase 16 | Pending |
| LNT-04 | Phase 16 | Pending |
| IMP-01 | Phase 16 | Pending |
| IMP-02 | Phase 16 | Pending |
| BLD-01 | Phase 17 | Pending |
| BLD-02 | Phase 17 | Pending |
| HOK-01 | Phase 18 | Pending |
| HOK-02 | Phase 18 | Pending |
| HOK-03 | Phase 18 | Pending |
| VRF-01 | Phase 18 | Pending |
| VRF-02 | Phase 18 | Pending |
| VRF-03 | Phase 18 | Pending |

**Coverage:**

- v1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-13*
*Last updated: 2026-06-13 after initial definition*
