# Phase 16: Oxlint Migration & Import Hygiene - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Replace ESLint with Oxlint (porting rule **options**, extending the shared `@solid-stats/ts-toolchain` oxlint preset), drop `eslint-plugin-import(-x)` entirely, and wire dependency-cruiser + knip to cover the dropped import-hygiene gap — all in one coupled swap. The largest, most coupled v3.0 phase.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
Choices at Claude's discretion — discuss skipped. Authoritative spec: ROADMAP goal/success criteria (LNT-01..04, IMP-01..02), `.planning/research/SUMMARY.md`, and the two spike-proven recipes: `.planning/spikes/001-oxlint-preset-port/` (oxlint port) and `.planning/spikes/004-depcruise-knip-import-gap/` (import-gap coverage). The shared oxlint preset is published at `solid-stats/ts-toolchain@v0.1.0` `oxlint/base.oxlintrc.json` (17.8 KB).

</decisions>

<code_context>
## Existing Code Insights

Current lint stack to REPLACE: `lint` = `eslint .`; eslint.config.js (114 lines, flat config); devDeps `eslint ^10.3`, `@eslint/js ^10`, `typescript-eslint ^8.59`, `eslint-plugin-unicorn ^64`, `eslint-plugin-import-x ^4.16`, `eslint-import-resolver-typescript ^4.4`. `verify` chains `... && pnpm run lint && pnpm run typecheck && ...`.

This phase swaps the LINTER + import hygiene ONLY. Oxfmt (Phase 15) is done; tsdown (Phase 17) and lefthook/CI (Phase 18) are NOT in scope. `tsc --noEmit` (typecheck) and Vitest stay. No `src/` logic change; `pnpm verify` green at 100% coverage.

Spike-locked decisions (do NOT re-litigate — empirically proven):
- **Spike 001 (oxlint port):** port each rule's **OPTIONS, not just severities** (severity-only port produced 1336 false positives). Drop `js.configs.all`. `unicorn/no-null` OFF; `no-await-in-loop` OFF (backend sequential-retry pattern). Plugins `["typescript","unicorn","import","oxc"]`, `typescript/` rule prefix. Oxlint **1.69.0**. Artifacts: `oxlintrc.candidate.json`, `oxlintrc.supported.json`, `dropped.tsv` (rules with no oxlint equivalent — each must be explicitly accepted for LNT-02).
- **oxlint `extends` cannot use a bare package specifier** (Phase 13 research, GitHub #15538) — the fetcher `.oxlintrc.json` extends the RELATIVE path `./node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json`, then layers repo-local overrides.
- **Spike 004 (import gap):** dropping `eslint-plugin-import(-x)` loses no-unresolved (→ `tsc` covers it), no-cycle + boundaries (→ **dependency-cruiser**), and unused/dep hygiene (→ **knip**). dependency-cruiser MUST be generated with `--init` — a hand-authored config produced 220 false `not-to-unresolvable` errors on this NodeNext repo. `import/order` is the one genuine orphan (decide: `simple-import-sort` residual vs. accept loss). Artifacts: `knip.jsonc`, `depcruise-*.txt`.
- **Type-aware oxlint (oxlint-tsgolint):** validated on this repo (no crashes, ~+160 ms, heavy strictTypeChecked rules fire) but stays a SEPARATE NON-BLOCKING step OUTSIDE `verify` until each repo re-validates — keep it non-blocking here.

</code_context>

<specifics>
## Specific Ideas

- **LNT-01:** remove eslint + all eslint-* plugins/resolvers; `pnpm lint` runs `oxlint` green; `.oxlintrc.json` extends the shared preset (relative node_modules path), options ported (from `oxlintrc.candidate.json`/`supported.json`), no `js.configs.all`, `unicorn/no-null` + `no-await-in-loop` off. Delete `eslint.config.js`. oxlint pinned 1.69.0.
- **LNT-02:** produce a before/after rule-delta doc (from spike `dropped.tsv` + the candidate/supported diff); EVERY dropped rule explicitly accepted with rationale (or compensated by tsc/depcruise/knip/tsgolint). This is an artifact, committed.
- **LNT-03:** wire type-aware oxlint (oxlint-tsgolint) as a SEPARATE non-blocking script (e.g. `lint:types`), re-validate it runs clean on this repo, but keep it OUT of the blocking `verify` chain.
- **LNT-04:** (the coupled swap is complete + green).
- **IMP-01/IMP-02:** drop `eslint-plugin-import-x` + `eslint-import-resolver-typescript`; wire `dependency-cruiser` (config via `depcruise --init`, no-cycle + boundaries) and `knip` (config from spike `knip.jsonc`, unused files/exports/deps) into `verify`; PROVE a planted import cycle is caught by depcruise (then remove the planted cycle). Decide the `import/order` orphan (recommend `simple-import-sort` if low-cost, else accept loss + document).
- **Gate:** `pnpm verify` (now oxfmt → oxlint → tsc → unit → integration → coverage → depcruise → knip → build, ordering at plan discretion) green under `sg docker`; coverage 100%, file set not reduced. The pre-existing `commands/discover.ts` direct storeRaw/stageRaw call (fence #2 backlog from Phase 14) is the boundary depcruise should encode or explicitly allow — resolve or document here.

**Hard invariant:** linter/import-hygiene swap only. No `src/` logic change; no tsc-emit/tsdown (Phase 17); no lefthook/CI (Phase 18). 100% coverage preserved.

</specifics>

<deferred>
## Deferred Ideas

- tsdown build + Docker smoke → Phase 17. lefthook hooks + full CI verify rewrite → Phase 18.
- `import/order` heavy reordering churn, if any, should stay minimal/isolated (it's adjacent to the Phase-15 format-only commit discipline).

</deferred>
