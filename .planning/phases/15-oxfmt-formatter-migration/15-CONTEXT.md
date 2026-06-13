# Phase 15: Oxfmt Formatter Migration - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Replace Prettier with Oxfmt (mirroring the shared `@solid-stats/ts-toolchain` `.oxfmtrc` preset) and land the repo-wide reformat as a single isolated, verifiably format-only commit BEFORE the linter swap (Phase 16), so format churn does not collide with lint changes.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
Choices at Claude's discretion — discuss skipped. Authoritative spec: ROADMAP goal/success criteria (FMT-01, FMT-02), `.planning/research/SUMMARY.md` + spike 002 (`.planning/spikes/002-oxfmt-format-diff/`), and the shared preset already published in `solid-stats/ts-toolchain@v0.1.0` at `oxfmt/base.oxfmtrc.json`.

</decisions>

<code_context>
## Existing Code Insights

Current: `format` script = `prettier --check .`; NO `format:check` script yet; `prettier ^3.8.3` devDependency. `verify` chains `pnpm run format` (among others). ESLint/tsc/Vitest stay as-is this phase — ONLY the formatter swaps (linter swap is Phase 16, build is Phase 17).

Locked facts (do not re-litigate):
- **Spike 002:** at `printWidth: 80`, oxfmt 0.54.0 output is **zero-diff vs the current Prettier output** — the reformat commit should be empty or trivially small. The churn risk only appears at oxfmt's wider default width; hold `printWidth: 80`.
- **Oxfmt has NO `extends`** (RESEARCH, GitHub #16394) — the fetcher cannot `extends` the shared preset; it carries its own `.oxfmtrc.json` whose content MIRRORS the shared `solid-stats/ts-toolchain@v0.1.0` `oxfmt/base.oxfmtrc.json`: `{ "printWidth": 80, "useTabs": false, "semi": true, "singleQuote": false, "trailingComma": "all" }`. Keep it byte-aligned with the shared preset (the shared repo is the canonical source even though it can't be machine-extended).
- Pinned version: **oxfmt 0.54.0**.

</code_context>

<specifics>
## Specific Ideas

- **FMT-01:** remove `prettier` (devDependency + any `.prettierrc`/config); add `oxfmt@0.54.0`; write `.oxfmtrc.json` mirroring the shared preset; set `format` and `format:check` scripts to run oxfmt against the preset (e.g. `format` = `oxfmt --write .` or `oxfmt .`, `format:check` = `oxfmt --check .` — confirm exact 0.54 flags in research). Update `verify` to call the oxfmt `format:check` step. Migrate `.prettierignore` content to the oxfmt ignore mechanism if oxfmt honors a different ignore file.
- **FMT-02:** the repo-wide reformat MUST be a SINGLE, verifiably format-only commit (separate from the config/script/dep-swap commit) — so a reviewer can confirm it touches only whitespace/formatting, not logic. Given spike-002 zero-diff at printWidth 80, this commit is expected to be empty or near-empty; if empty, document that explicitly (still a clean isolated step). Do NOT bundle the reformat with the tooling-swap commit.
- **Gate:** `pnpm verify` green after the swap; coverage 100% unchanged (formatting doesn't change coverage); the measured file set not reduced. No `src/` logic change.

**Hard invariant:** formatter-only. Do NOT touch ESLint (Phase 16), tsc build (Phase 17), lefthook/CI (Phase 18), or `src/` logic.

</specifics>

<deferred>
## Deferred Ideas

- ESLint→Oxlint + import-plugin drop + depcruise/knip → Phase 16. tsdown → Phase 17. lefthook + CI verify rewrite → Phase 18.
- The pre-existing `commands/discover.ts` direct storeRaw/stageRaw call (fence #2 backlog from Phase 14) → Phase 16 depcruise, NOT here.

</deferred>
