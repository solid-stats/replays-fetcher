# Phase 13: Shared `@solid-stats/ts-toolchain` Bootstrap - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Stand up the shared config git repo `git@github.com:solid-stats/ts-toolchain.git` (tsconfig/oxlint/oxfmt/vitest presets + `lefthook.yml`) with self-validating CI, and wire the fetcher to consume it as a tag/commit-pinned pnpm git-dependency (`github:solid-stats/ts-toolchain#<tag>`), proven end-to-end by `tsconfig.json` extending the shared base.

Toolchain-only migration. The five-band ingest pipeline, CLI, S3/PostgreSQL boundaries, and `src/` are frozen. `pnpm verify` stays green at 100% coverage at every step. Behaviour is preserved.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
Implementation choices are at Claude's discretion — the discuss phase was skipped per user setting. The authoritative spec is the ROADMAP phase goal/success criteria plus `.planning/research/SUMMARY.md` (+ STACK/FEATURES/ARCHITECTURE/PITFALLS) and the spike outputs `.planning/spikes/001-004`. Use those plus codebase conventions to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research. Current toolchain (to be migrated in later phases, NOT this one): ESLint 10 `lint`, Prettier `format`, `tsc -p tsconfig.build.json` `build`, `tsc --noEmit` `typecheck`, Vitest 4 unit + testcontainers integration, V8 coverage 100%. `verify` chains format → lint → typecheck → test → test:integration → test:coverage → build.

Phase 13 only adds the shared-config dependency and switches `tsconfig.json` to extend the shared base; it does NOT swap formatter/linter/build tools (those are Phases 15-17).

</code_context>

<specifics>
## Specific Ideas

User-confirmed external-repo facts (load-bearing constraints, not discretionary):

- The repo `solid-stats/ts-toolchain` **already exists, is PUBLIC, and is currently EMPTY** (no branches/commits). Its **default branch is `master`**. Phase 13 must author its initial contents and push.
- Public visibility means the pnpm git-dep installs in CI/Docker **without auth** — but the pin MUST be a **tag or commit SHA**, never a branch ref (a branch silently re-resolves). A working `pnpm install --frozen-lockfile` in CI and Docker is mandatory (`pnpm-lock.yaml` reproducible).
- The shared repo ships **five presets** (tsconfig / oxlint / oxfmt / vitest) **+ `lefthook.yml`**. Backends consume the VoidZero **subset** — no full Vite+ runtime management for a CLI.
- Spike-locked versions/decisions to seed the presets: Oxlint 1.69.0 (`.oxlintrc.json`, plugins typescript/unicorn/import/oxc, port rule **options** not severities, drop `js.configs.all`, `unicorn/no-null` off, `no-await-in-loop` off), Oxfmt 0.54.0 (`.oxfmtrc.json`, `printWidth: 80` → zero-diff vs current Prettier), Vitest 4 preset, tsconfig strict base. These presets are authored here but only *consumed* for tsconfig in this phase; formatter/linter/build swaps land in Phases 15-17.
- The shared repo's own CI must lint/format/typecheck the preset files before a consumable tag is cut (self-validating).

This phase's verifiable end-to-end proof: fetcher `package.json` carries the tag-pinned git-dep, `pnpm-lock.yaml` is reproducible, fetcher `tsconfig.json` extends the shared base, and `pnpm verify` stays green.

</specifics>

<deferred>
## Deferred Ideas

- `import/order` orphan decision (simple-import-sort residual vs. accept loss) → Phase 16.
- `server-2` tsgolint re-validation → not pilot scope.
- Actual formatter/linter/build/hook tool swaps → Phases 15-18.

</deferred>
