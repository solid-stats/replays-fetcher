# Feature Research

**Domain:** Toolchain migration — internal developer tooling (no ingest behavior change)
**Researched:** 2026-06-13
**Confidence:** HIGH

The "features" of v3.0 Track C are migration deliverables, not ingest product features. Ingest behavior is frozen. All decisions are locked in `.planning/spikes/MANIFEST.md` (spikes 001–004 VALIDATED) and REQUIREMENTS.md. This file maps deliverables to the template structure for roadmap consumption.

## Feature Landscape

### Table Stakes (Must Land for v3.0 to Be Done)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Bootstrap `@solid-stats/ts-toolchain` git repo | Fetcher cannot consume shared presets until the repo exists; blocks all other deliverables that reference presets | MEDIUM | `git@github.com:solid-stats/ts-toolchain.git`; holds tsconfig/oxlint/oxfmt/vitest presets + `lefthook.yml`; self-validating CI required before a consumable tag is cut |
| Repository cleanup | Dead code and stale suppression comments corrupt the Oxlint signal — genuine findings cannot be separated from pre-existing noise | LOW | CLN-01/02/03: remove dead code, stale TODO/FIXME, redundant `eslint-disable`; tighten ignores |
| Convention-skill refactor | Unresolved convention violations become false-positive noise in the Oxlint sweep | MEDIUM | CLN-04: pass `solidstats-fetcher-ts-*` code-review skill; ingest-boundary gate stays intact |
| Oxlint migration | Replaces ESLint as the sole linter; primary Track C work item | MEDIUM-HIGH | LNT-01/02/03: ESLint removed; vocalclub rule **options** ported (not just severities — severity-only produced 1336 false positives in spike 001); `eslint-plugin-import` dropped; `no-await-in-loop` off; before/after rule-delta documented |
| Type-aware Oxlint re-validation | tsgolint alpha must be validated on this repo before it can inform future blocking decisions | LOW | LNT-04: non-blocking in `verify` until validates clean; result informs `server-2` rollout |
| Oxfmt migration | Replaces Prettier as the formatter | LOW | FMT-01/02: Prettier removed; `.oxfmtrc.json` from preset; one isolated reformat commit (style delta validated as acceptable in spike 002) |
| tsdown build | Replaces `tsc --outDir` emit with a single-entry ESM bundle | MEDIUM | BLD-01/02: tsdown bundle; `tsc --noEmit` stays for typecheck; Docker smoke-run of bundled CLI `check` command (validated in spike 003) |
| dependency-cruiser + knip import gates | Covers the gap left by dropping `eslint-plugin-import` (validated in spike 004) | MEDIUM | IMP-01/02: depcruise covers no-cycle + boundary rules; knip covers unused-modules + dep hygiene; both wired into `verify` |
| lefthook pre-commit / pre-push hooks | Developer-local mirror of CI `verify`; prevents broken commits/pushes | LOW | HOK-01/02/03: pre-commit = Oxfmt+Oxlint staged; pre-push = tsc+Vitest; config sourced from `@solid-stats/ts-toolchain`; `--no-verify` bypass retained |
| CI `verify` rewrite + 100% coverage held | End-to-end green on the new command surface from a clean checkout | MEDIUM | VRF-01/02/03: `pnpm verify` runs oxfmt → oxlint → tsc → unit → integration → coverage → tsdown → depcruise → knip; V8 coverage at 100% unchanged |

### Differentiators (Nice-to-Have, Defer if Time-Short)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| CI drift guard for `.oxlintrc.json` | Catches preset drift before it becomes a silent delta between repos | LOW | DFT-01: diffs repo's `.oxlintrc.json` against `@solid-stats/ts-toolchain` baseline in CI |
| `import/order` residual (`simple-import-sort`) | Keeps import ordering enforced if depcruise/knip leave that coverage gap | LOW | DFT-02: only add if the gap is confirmed at plan-phase; may not be needed |

### Anti-Features (Explicitly NOT in Scope)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Vite / full Vite+ runtime or PM management | VoidZero branding includes Vite; teams may assume it | Vite is a frontend bundler entry point; the CLI is a backend scheduled job | Use tsdown (Rolldown-backed) for the bundle; Vitest for tests — the VoidZero subset appropriate for backends |
| Porting `@stylistic` ESLint rules to Oxlint | Style rules provide familiar lint-as-formatter coverage | Oxfmt handles all formatting; porting `@stylistic` duplicates responsibility and couples the two tools | Accept `@stylistic` loss; Oxfmt is the sole formatting authority |
| Keeping `eslint-plugin-import` / `import-x` as an ESLint residual | Provides import ordering and boundary enforcement | Spike 004 proved tsc + dependency-cruiser + knip covers the gap; keeping any ESLint residual undermines the migration goal | dependency-cruiser for boundaries/cycles; knip for unused deps; `simple-import-sort` only if ordering gap confirmed |
| Any ingest behavior, staging schema, S3 key, source-identity, or cross-service contract change | Tempting to "fix while we're in there" | This is a toolchain-only milestone; behavior mutations risk breaking `server-2` compatibility and require adjacent app evidence | Freeze behavior; file a separate GSD plan for any discovered ingest improvements |
| Migrating `server-2` or `web` in this milestone | Momentum after the pilot is established | Those repos follow the rollout order; piloting with two repos simultaneously defeats the pilot's purpose | Fetcher pilot first; `server-2` → `web` per `RELEASE-PLAN.md` Phase 0 Track 1 |
| Monorepo / workspace restructuring | Shared config looks like a natural monorepo trigger | Polyrepo + git-dep was decided; restructuring is a separate high-effort project with no track C requirement | Stay polyrepo; `@solid-stats/ts-toolchain` as a pnpm git-dep |
| Enabling alpha type-aware (tsgolint) as a blocking CI gate | Completeness | tsgolint is alpha; blocking on unvalidated alpha tooling breaks CI reliability | Re-validate per repo; keep non-blocking until clean on both fetcher and `server-2` |

## Feature Dependencies

```
@solid-stats/ts-toolchain bootstrap (1)
    └──must exist before──> Oxfmt migration (5, consumes preset)
    └──must exist before──> Oxlint migration (4, consumes preset)
    └──must exist before──> lefthook hooks (8, config sourced from preset)

Repository cleanup (2)
    └──precedes──> Convention-skill refactor (3)
         └──together produce clean baseline before──> Oxlint migration (4)

Oxfmt migration (5) — isolated reformat commit
    └──before──> Oxlint migration (4)
         └──together with──> dependency-cruiser + knip (7)
              └──before──> tsdown build (6)
                   └──before──> lefthook hooks (8)
                        └──before──> CI verify rewrite (9)
```

### Dependency Notes

- **Bootstrap (1) before everything else:** The fetcher cannot reference `@solid-stats/ts-toolchain` preset paths until the repo and a consumable tag exist. All config references fail resolution until then.
- **Cleanup (2) + refactor (3) before Oxlint (4):** Oxlint will report findings on the pre-migration code. If dead code, suppressions, and convention violations are not cleared first, genuine migration findings are indistinguishable from pre-existing noise.
- **Oxfmt (5) as one isolated commit before Oxlint (4):** A format-only commit makes the Oxlint delta readable. If reformat and rule changes mix, the diff is unauditable.
- **depcruise + knip (7) alongside Oxlint (4):** These fill the import-plugin gap. They should be wired into `verify` in the same phase so the gate is complete when ESLint is removed.
- **tsdown (6) after linting/format stable:** Build smoke requires a settled codebase; Docker smoke validates the final artifact.
- **lefthook (8) last among migration steps:** Hooks reference the full command surface (oxfmt, oxlint, tsc, vitest); all must exist before hooks can be installed and tested.
- **CI verify rewrite (9) final:** The pipeline is the integration test of all prior steps; it must run green end-to-end from a clean checkout.

## MVP Definition

### Launch With (v3.0 — all table stakes)

- [ ] `@solid-stats/ts-toolchain` repo bootstrapped and consumable as pnpm git-dep — pilot cannot proceed without it
- [ ] Repository cleanup complete — ensures Oxlint signal is clean
- [ ] Convention-skill refactor done — ingest-boundary gate clean
- [ ] Oxlint migration complete with rule-delta documented — primary Track C deliverable
- [ ] Oxfmt migration as one isolated commit — Prettier fully removed
- [ ] tsdown build with Docker smoke-run — `tsc` emit removed
- [ ] dependency-cruiser + knip wired into `verify` — import-plugin gap covered
- [ ] lefthook hooks installed from preset — developer-local gate in place
- [ ] `pnpm verify` green at 100% V8 coverage on new command surface — milestone acceptance criterion

### Add After Validation (v3.0.x)

- [ ] CI drift guard for `.oxlintrc.json` — DFT-01, add once `server-2` begins migration to measure real drift
- [ ] `import/order` residual if gap confirmed — DFT-02, decide only after knip/depcruise gap assessment

### Future Consideration (v3.1+ / `server-2` / `web`)

- [ ] Roll out `@solid-stats/ts-toolchain` to `server-2` — next in rollout order per RELEASE-PLAN Phase 0 Track 1
- [ ] Roll out to `web` — third in rollout order
- [ ] Promote tsgolint type-aware to blocking once validated clean on fetcher + `server-2`

## Feature Prioritization Matrix

| Feature | Dev Value | Implementation Cost | Priority |
|---------|-----------|---------------------|----------|
| Bootstrap `@solid-stats/ts-toolchain` | HIGH — unblocks everything | MEDIUM | P1 |
| Repository cleanup | HIGH — noise reduction | LOW | P1 |
| Convention-skill refactor | HIGH — clean baseline | MEDIUM | P1 |
| Oxlint migration | HIGH — primary Track C item | MEDIUM-HIGH | P1 |
| Oxfmt migration | HIGH — Prettier removed | LOW | P1 |
| tsdown build + Docker smoke | HIGH — `tsc` emit removed | MEDIUM | P1 |
| dependency-cruiser + knip gates | HIGH — import gap covered | MEDIUM | P1 |
| lefthook hooks | MEDIUM — local gate convenience | LOW | P1 |
| CI verify rewrite + 100% coverage | HIGH — milestone acceptance criterion | MEDIUM | P1 |
| Type-aware re-validation (non-blocking) | MEDIUM — informs `server-2` decision | LOW | P1 |
| CI drift guard | LOW — useful at scale | LOW | P2 |
| `import/order` residual | LOW — only if gap confirmed | LOW | P2 |

**Priority key:**
- P1: Must have for v3.0 closure
- P2: Add after validation, before `server-2` rollout
- P3: Nice to have, future consideration

## Sources

- `.planning/spikes/MANIFEST.md` — locked spike requirements (options-not-severities, import-plugin drop, no-await-in-loop off, type-aware per-repo)
- `.planning/REQUIREMENTS.md` — CFG/CLN/LNT/FMT/BLD/IMP/HOK/VRF requirement IDs and traceability
- `.planning/PROJECT.md` — v3.0 target features, key decisions, and rollout order
- `plans/product/TS-TOOLCHAIN-CONVERGENCE.md` (referenced in MANIFEST; not present in repo — decisions absorbed into REQUIREMENTS.md and PROJECT.md)

---
*Feature research for: v3.0 Track C Toolchain Convergence (replays-fetcher pilot)*
*Researched: 2026-06-13*
