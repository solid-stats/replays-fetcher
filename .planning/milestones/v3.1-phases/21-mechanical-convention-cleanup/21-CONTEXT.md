# Phase 21: Mechanical Convention Cleanup - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss; autonomous run)

<domain>
## Phase Boundary

The near-100%-precision mechanical lane of the convention audit is fully applied and locked in —
every `interface` that should be `type` is converted and import order is normalized, both
enforced so they cannot regress.

Requirements: MECH-01, MECH-02.

Success Criteria (what must be TRUE):
1. ~137 `interface→type` conversions applied and enforced by oxlint
   `consistent-type-definitions: ["error","type"]` so a new `interface` fails `verify`.
2. ~17 import-order sites normalized and enforced by `oxfmt sortImports`.
3. Conversions land as isolated, diff-reviewable mechanical commits with zero logic change;
   redundant suppressions removed.
4. `tsc` stays green and the golden oracle + 100% V8 coverage are unaffected.
</domain>

<decisions>
## Implementation Decisions

### Resolved (autonomous) — cross-app enforcement scope
- **MECH-02 enforcement lands LOCALLY in this repo's config, NOT in the shared
  `@solid-stats/ts-toolchain` preset.** Evidence: the toolchain is consumed as an EXTERNAL pinned
  git dependency (`@solid-stats/ts-toolchain github:solid-stats/ts-toolchain#v0.1.3`), installed
  into `node_modules` — there is no local checkout of it in this repo. Editing the shared preset
  would require checking out that separate repo, tagging a new version, and bumping the pin here,
  with blast radius on `server-2` and `web` (which inherit it). That is a cross-app change out of
  proportion to this repo's compliance milestone.
- The roadmap's "configured in the shared preset so server-2/web inherit it" wording is an
  ASPIRATION; doing it locally first is the safe incremental step. **Shared-preset propagation is
  deliberately deferred as a separate cross-app task** (additive, non-blocking for this repo's
  MECH-01/MECH-02). Record it as a cross-app follow-up; do NOT silently edit the external repo.
- Concretely: add `"typescript/consistent-type-definitions": ["error","type"]` to this repo's
  `.oxlintrc.json` `rules`, and enable/confirm `oxfmt` import sorting via this repo's local oxfmt
  config (the plan/research must pin the exact local oxfmt mechanism — `format` is `oxfmt --write .`).

### Claude's Discretion (per roadmap implementation note)
- **Spike `oxlint --fix` FIRST.** Only if it cannot convert all ~137 sites with `tsc` green, add
  `ts-morph` as a dev-only one-shot dep, run the codemod, commit, then `pnpm remove ts-morph`.
  Prefer the no-new-dep path.
- ONLY the mechanical lane is in scope — `interface→type` + import-order. NO semantic audit
  findings (those are Phase 26). Do not let the bulk conversion pull in logic changes (Pitfall 5).
- Convert prod AND test interfaces (156 total: 137 prod + 19 test) unless a site genuinely needs
  `interface` semantics (declaration merging / `extends` chains that `type` can't express) — the
  spike must surface any such site and exempt it explicitly, not silently skip.

### Pre-pinned evidence (grep, 2026-06-20)
- 156 `interface` decls in `src/` (137 prod + 19 test).
- `.oxlintrc.json` extends `@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json`; local rules
  currently override `no-await-in-loop`, `require-await`, `no-magic-numbers` only —
  `consistent-type-definitions` is NOT set locally.
- Toolchain pin: `@solid-stats/ts-toolchain#v0.1.3`; oxlint 1.69.0; oxfmt 0.54.0.
</decisions>

<code_context>
## Existing Code Insights

Phase 19 created the `src/types/` leaf — converting interfaces there to `type` creates no upward
imports (safe for the bulk conversion). This phase is sequenced BEFORE the god-file splits
(Phase 22) to keep the bulk conversion out of large structural diffs. Behavior-preservation gate:
golden oracle + 100% V8 coverage + depcruise + knip green; `tsc` green.
</code_context>

<specifics>
## Specific Ideas

- Near-100%-precision mechanical lane: the conversions are diff-reviewable pure moves. The risk is
  a site where `interface` was load-bearing (declaration merging, `extends`) — the spike must catch it.
- Enforcement is the lock-in: after conversion, a new `interface` must FAIL `verify` (oxlint error),
  and unsorted imports must FAIL `format:check`.
- Watch `src/commands/shared.ts` — it is AT the 300-line `max-lines` limit (Phase 20); the
  interface→type conversion there must not push it over (type/interface line counts are equal, so
  it is a wash, but confirm).
</specifics>

<deferred>
## Deferred Ideas

- **Cross-app follow-up (NOT this phase):** propagate `consistent-type-definitions` + `oxfmt`
  import-sort into the shared `@solid-stats/ts-toolchain` preset (new tag + pin bump) so `server-2`
  and `web` inherit them. Requires the external toolchain repo; coordinate cross-app.
</deferred>
