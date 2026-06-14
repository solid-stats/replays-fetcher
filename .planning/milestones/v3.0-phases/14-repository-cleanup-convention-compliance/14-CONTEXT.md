# Phase 14: Repository Cleanup & Convention Compliance - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Bring the code to a clean, `solidstats-fetcher-ts-*`-compliant baseline **on the still-ESLint toolchain**, so the later Oxlint swap (Phase 16) audits already-correct code. This is a cleanup/compliance phase, not a behavior change.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
Implementation choices are at Claude's discretion — discuss skipped per user setting. Authoritative spec: the ROADMAP phase goal/success criteria (CLN-01..CLN-04), the `solidstats-fetcher-ts-conventions` + `solidstats-shared-backend-ts-standards` + `solidstats-shared-ts-standards` skills (the compliance bar), and `.planning/research/SUMMARY.md`.

</decisions>

<code_context>
## Existing Code Insights

Cleanup phase on the EXISTING toolchain (ESLint 10 `lint`, Prettier `format`, `tsc` build, Vitest, V8 coverage 100%). Do NOT swap formatter/linter/build tools — that is Phases 15-17. Stay strictly within cleanup.

Survey at phase start:
- **TODO/FIXME/XXX/HACK in `src/`: 0** (CLN-02 likely already satisfied — verify and confirm, do not invent work).
- **`eslint-disable` occurrences in `src/`: 37** — each must be justified or removed (CLN-03). Many are likely load-bearing (documented suppressions like `no-await-in-loop` for sequential retry, `camelcase` for snake_case DB keys, `no-useless-constructor` for AppError subclasses). Remove only genuinely redundant ones; keep + keep-documented the necessary ones. Do NOT weaken real type/lint safety to drop a suppression.
- **`v8 ignore` occurrences in `src/`: 22** — coverage carve-outs; verify each still guards a genuinely unreachable/defensive branch (100% coverage gate depends on them being accurate, not over-broad).
- Phase 13 added `.claude/**` to `eslint.config.js` ignores (vendored GSD tooling) and a pre-existing `pnpm.onlyBuiltDependencies` package.json field now emits a deprecation warning ("The pnpm field in package.json is no longer read") — candidate for cleanup/relocation under CLN-01 (unused/stale config).

</code_context>

<specifics>
## Specific Ideas

- CLN-01 (dead code / unused config / stale scripts): survey `src/`, `package.json` scripts, config files, ignore files for genuinely unused/dead items. The `pnpm.onlyBuiltDependencies` deprecation is a concrete candidate (relocate to the new pnpm settings home or drop if unused).
- CLN-02 (TODO/FIXME): survey shows 0 in `src/` — confirm across the repo (config, scripts, docs) and clear/promote any stragglers.
- CLN-03 (redundant suppressions + ignore files): audit the 37 `eslint-disable` and the `v8 ignore` carve-outs; remove redundant ones, tighten `.eslintignore`/flat-config `ignores`, `.gitignore`, `.prettierignore` if loose. Each retained suppression must carry a reason.
- CLN-04 (convention-skill review + ingest boundary + verify): run the `solidstats-fetcher-ts-code-review` skill over the cleaned baseline; the ingest-boundary invariants (no parsing, S3-raw + staging/outbox writes only, idempotent re-discovery, auditable evidence) MUST remain intact; `pnpm verify` green at 100% coverage with the measured file set NOT reduced.

**Hard invariant:** behavior-preserving. No `src/` logic change beyond removing genuinely dead code. Coverage stays 100%; do not delete code merely to dodge a coverage gap.

</specifics>

<deferred>
## Deferred Ideas

- Oxfmt swap → Phase 15. Oxlint swap + import-plugin drop + depcruise/knip → Phase 16. tsdown → Phase 17. lefthook + CI → Phase 18.
- Any `eslint-disable` that only becomes removable AFTER the Oxlint port → note it for Phase 16, don't force it here.

</deferred>
