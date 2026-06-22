# Phase 21: Mechanical Convention Cleanup - Research

**Researched:** 2026-06-20
**Domain:** TypeScript mechanical codemod — `interface→type` (MECH-01) + import-order normalization (MECH-02), oxlint/oxfmt-enforced
**Confidence:** HIGH (every load-bearing claim is from a real spike run against this repo's tree, then reverted)

## Summary

This is a near-100%-precision mechanical phase, and the spike de-risks it completely. **`oxlint --fix` with `typescript/consistent-type-definitions: ["error","type"]` converts all 156 `interface` declarations (137 prod + 19 test) to `type` in a single pass across 53 files, and `tsc -p tsconfig.json --noEmit` stays GREEN (exit 0) afterward.** No site needs `interface` semantics: there is zero declaration merging (all 11 duplicate names are in different files, not merged in-scope), zero `declare global`/`declare module` augmentation, and zero class `implements`. The 5 `extends` cases (incl. one `extends Error`) are correctly rewritten by oxlint as intersection types (`& Error`, `& S3CheckpointStore`). **ts-morph is NOT needed.**

MECH-02 is the subtler half. The import-order non-compliance exists because `sortImports` was never enabled — neither the inherited `@solid-stats/ts-toolchain` oxfmt preset nor this repo's local `.oxfmtrc.json` turns it on (oxfmt default: Disabled), so `oxfmt --check .` currently passes with no import checking at all. Enabling `sortImports: true` LOCALLY (per the CONTEXT decision) makes `oxfmt --check .` fail and the fix is mechanical — **but with defaults it reorders imports in 56 files, not the ~17 the audit predicted** (the perfectionist-style algorithm sorts by module path globally), and it moves imports *around* the file-top `eslint-disable max-lines` comments. The planner must decide between accepting the broad 56-file diff or constraining the algorithm via `partitionByComment`/`groups`.

**Primary recommendation:** Two isolated mechanical commits. (1) Add the oxlint rule + run `oxlint --fix` (156 conversions, tsc green) → `oxfmt --write .` to re-canonicalize → commit. (2) Add `sortImports: true` to local `.oxfmtrc.json` + `oxfmt --write .` → commit. No new dependency. Record shared-preset propagation as a deferred cross-app follow-up.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **MECH-02 enforcement lands LOCALLY in this repo's `.oxfmtrc.json`, NOT in the shared `@solid-stats/ts-toolchain` preset.** The toolchain is an external pinned git dep (`#v0.1.3`) with no local checkout; editing it is a cross-app change out of proportion to this milestone. Shared-preset propagation is deliberately deferred as a separate cross-app task.
- Concretely: add `"typescript/consistent-type-definitions": ["error","type"]` to this repo's `.oxlintrc.json` `rules`, and enable/confirm `oxfmt` import sorting via this repo's local oxfmt config (`format` is `oxfmt --write .`).

### Claude's Discretion
- **Spike `oxlint --fix` FIRST.** Only if it cannot convert all sites with `tsc` green, add `ts-morph` as a dev-only one-shot dep, run codemod, commit, then `pnpm remove ts-morph`. Prefer the no-new-dep path. **(Spike result: oxlint --fix succeeds fully; ts-morph NOT needed.)**
- ONLY the mechanical lane is in scope — `interface→type` + import-order. NO semantic audit findings (Phase 26). Do not let the bulk conversion pull in logic changes (Pitfall 5).
- Convert prod AND test interfaces (156 total) unless a site genuinely needs `interface` semantics. **(Spike result: NO site needs interface semantics — all 156 convert cleanly.)**

### Deferred Ideas (OUT OF SCOPE)
- **Cross-app follow-up (NOT this phase):** propagate `consistent-type-definitions` + `oxfmt` import-sort into the shared `@solid-stats/ts-toolchain` preset (new tag + pin bump) so `server-2` and `web` inherit them. Requires the external toolchain repo; coordinate cross-app.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MECH-01 | All `interface` that should be `type` converted (~138, actually 156) and enforced by oxlint `consistent-type-definitions: ["error","type"]` | SPIKE: `oxlint --fix` converts 156/156, tsc green, no exemptions — §The Spike |
| MECH-02 | Import ordering normalized (~17) and enforced by `oxfmt sortImports` (LOCAL per CONTEXT) | SPIKE: `sortImports: true` in local `.oxfmtrc.json` makes `oxfmt --check` fail; touches 56 files with defaults — §MECH-02 |

## The Spike (MECH-01) — Verified Result

> Run against the real tree, then fully reverted (`git checkout -- .`). Tree confirmed clean.

| Question | Answer |
|----------|--------|
| Does oxlint 1.69.0 support `consistent-type-definitions` + autofix? | **YES** [VERIFIED: rule present in `node_modules/oxlint/configuration_schema.json`; `--fix` applied real edits] |
| How many of 156 `interface` sites convert? | **156 / 156** (0 `interface` decls remain) [VERIFIED: spike run] |
| `tsc --noEmit` green afterward? | **YES — exit 0, zero errors** [VERIFIED: spike run] |
| What does oxlint NOT/CANNOT convert? | **Nothing — full conversion.** No site refused. [VERIFIED] |
| Files touched | 53 `.ts` files [VERIFIED] |
| `oxlint` (with rule) clean on converted tree? | **YES — no remaining errors** [VERIFIED] |

**Exact reproduction (for the plan):**
```bash
# add to .oxlintrc.json rules: "typescript/consistent-type-definitions": ["error","type"]
oxlint --fix --config .oxlintrc.json src
tsc -p tsconfig.json --noEmit   # exit 0
oxfmt --write .                 # re-canonicalize (oxlint --fix leaves non-canonical formatting in 54 files)
```

> **Important sequencing note:** after `oxlint --fix`, `oxfmt --check .` reports 54 format issues — oxlint's autofix output is not oxfmt-canonical (e.g. it emits `type X = { … } & Error` with the intersection trailing). The plan MUST run `oxfmt --write .` immediately after the conversion, before committing, or `format:check` in `verify` fails. This is benign re-formatting, not a logic change.

### Interface-semantics exemptions — NONE

Every candidate exemption class was checked and is empty:

| Exemption class | Found | Detail |
|-----------------|-------|--------|
| Declaration merging (two `interface X` in same scope) | **NONE** | 11 duplicate interface NAMES exist but each pair is in DIFFERENT files (e.g. `BuildErrorInput` in `storage/replay-byte-client.ts` + `discovery/source-client.ts`; `StagingRow` across 3 files) — separate declarations, never merged. `type` is fine. [VERIFIED: grep + per-name file listing] |
| `declare global` / `declare module` augmentation | **NONE** | grep returned zero hits in `src/`. [VERIFIED] |
| Class `implements <interface>` | **NONE** | zero `implements` clauses (the two grep hits are the word "implements" in comments). [VERIFIED] |
| `extends` chains | **5, all convertible** | All rewritten as intersections by oxlint, tsc-green: `storage/types.ts:RawReplayStorageInput`, `staging/types.ts:StageableRawReplayEvidence`, `types/raw-replay.ts:RawReplayStorageEvidence`, `run/run-once.test.ts:FakeCheckpointStore extends S3CheckpointStore`, `discovery/source-client.ts:235 CloudflareChallengeError extends Error`. [VERIFIED: spike output] |

**The one `extends Error` case** (`CloudflareChallengeError`) became `type CloudflareChallengeError = { readonly isCloudflareChallenge: true } & Error` — and `error is CloudflareChallengeError` type guards still typecheck (tsc green). This is the single site flagged in `<research_focus>` #6 as a theoretical risk; the spike confirms it is safe.

## MECH-02 — Local Import-Sort Mechanism

### Why ~17 sites are unsorted today
Import sorting is **completely off**. [VERIFIED: spike]
- The inherited `node_modules/@solid-stats/ts-toolchain/oxfmt/base.oxfmtrc.json` contains only `printWidth/useTabs/semi/singleQuote/trailingComma` — **no `sortImports`**.
- This repo has a **local `.oxfmtrc.json`** (auto-discovered; `format` runs bare `oxfmt --write .` with no `-c`) that is a verbatim copy of those same 5 keys — also **no `sortImports`**.
- oxfmt's `sortImports` default is **Disabled**, so `oxfmt --check .` currently passes (129 files) while doing zero import validation.

### What must change LOCALLY (per CONTEXT)
Add **one key** to this repo's `.oxfmtrc.json`:
```jsonc
{
  "printWidth": 80, "useTabs": false, "semi": true,
  "singleQuote": false, "trailingComma": "all",
  "sortImports": true            // <-- the only addition
}
```
Then `oxfmt --write .` normalizes, and `oxfmt --check .` (already wired into `verify` via `format:check`) FAILS on any future unsorted import. **No new script, no shared-preset edit.** [VERIFIED: `oxfmt --check .` reports failures once the key is set]

### ⚠️ Blast-radius surprise — 56 files, not ~17
With `sortImports: true` at **defaults**, `oxfmt --write .` reorders imports in **56 files** (124 insertions / 209 deletions), not the ~17 the audit predicted. [VERIFIED: isolated spike on otherwise-clean tree]

Cause: oxfmt's default algorithm (perfectionist `sort-imports` style) sorts the WHOLE import block by module specifier — e.g. it moves `../discovery/types.js` above `./types.js` everywhere. The audit's "~17" likely counted only egregiously-out-of-order blocks; the formatter normalizes far more.

**Two concrete planner decisions (DISCRETION):**
1. **Accept the 56-file diff** as a single mechanical commit (simplest; the diff is pure import reordering, behavior-free, tsc-green). Recommended — it is still diff-reviewable and the enforcement is the point.
2. **Constrain the algorithm** via `sortImports` object form to narrow the diff. The relevant `SortImportsConfig` knobs are: `groups`, `customGroups`, `internalPattern`, `newlinesBetween`, `order`, `ignoreCase`, `partitionByComment`, `partitionByNewline`, `sortSideEffects`. [VERIFIED: oxfmt schema] In particular **`partitionByComment`** addresses the comment-anchoring issue below.

### Comment-anchoring interaction with Phase 22
Default `sortImports` moves imports *above* a file-top `/* eslint-disable max-lines … */` comment (observed in `src/run/summary.ts` — the disable comment ended up sandwiched between two import groups). There are **14 such `max-lines` disable comments** (10 `eslint-disable` + 4 `oxlint-disable`). Phase 22 (SPLIT) removes the 4 god-file `max-lines` suppressions anyway, so the interaction is transient — but the planner should either (a) set `partitionByComment: true` so the disable comment stays a partition boundary, or (b) eyeball those 14 files in the MECH-02 commit. [VERIFIED: spike diff of summary.ts]

## ts-morph Fallback — NOT NEEDED

The oxlint spike converted **156/156 with tsc green**, so the `ts-morph` path is unnecessary. Do not add the dependency. (Documented for completeness only: the fallback would have been `pnpm add -D ts-morph` → one-shot codemod script → commit → `pnpm remove ts-morph`.) [VERIFIED: spike made fallback moot]

## Redundant Suppressions — NONE for this rule pair

- **Zero** `consistent-type-definitions` suppressions exist anywhere in `src/`. [VERIFIED: grep]
- **Zero** import-sort/import-order suppressions exist. The only `import/*` disable is `src/cli.ts:6 oxlint-disable-next-line import/no-unassigned-import` (Sentry side-effect ordering) — unrelated to MECH-02, **stays**. [VERIFIED: grep]
- Therefore Success-Criterion #3's "redundant suppressions removed" has **nothing to remove** for the type/import rules. (The 14 `max-lines` suppressions belong to Phase 22, not here.) State this explicitly in the plan so the criterion isn't read as an unmet gap.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| `interface → type` conversion | A regex sed / hand edits | `oxlint --fix` with `consistent-type-definitions` | Correctly handles `extends`→intersection, generics, `extends Error`; 156/156, tsc-green, in one pass |
| Import ordering | Manual reordering | `oxfmt sortImports` | Deterministic, enforceable in `verify`; manual edits regress |
| Codemod runner | `ts-morph` script | (nothing) | Not needed — oxlint fully covers the conversion |

## Common Pitfalls

### Pitfall 1: Committing the conversion without re-running oxfmt
**What goes wrong:** `oxlint --fix` output is not oxfmt-canonical (54 files differ); `verify`'s `format:check` fails.
**How to avoid:** Always `oxfmt --write .` after the conversion, before committing.
**Warning sign:** `format:check` red while `lint`/`typecheck` green.

### Pitfall 2: Expecting "~17" import-sort sites
**What goes wrong:** Reviewer alarmed by a 56-file MECH-02 diff.
**Why:** The formatter normalizes the whole import block; the audit's 17 undercounted.
**How to avoid:** Note in the commit body that the broad diff is pure reordering (tsc-green, no logic change). Optionally narrow via `partitionByComment`/`groups`.

### Pitfall 3: Conflating MECH-01 and MECH-02 into one commit
**What goes wrong:** A ~109-file diff that is no longer cleanly diff-reviewable as "mechanical."
**How to avoid:** Two commits — conversion first, import-sort second. Each individually verifiable.

### Pitfall 4: `shared.ts` crossing the max-lines limit
**What goes wrong:** Conversion bumps `src/commands/shared.ts` past its 300-line `max-lines`.
**Why it does NOT happen:** `interface X {` and `type X = {` are the same line count; spike confirms `shared.ts` stays exactly **300 lines** and oxlint clean. [VERIFIED]

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| `interface` for object shapes | `type` (consistent-type-definitions) | Project convention §A; intersections replace `extends` |
| Prettier import plugins | oxfmt native `sortImports` (perfectionist algorithm) | Single formatter, no plugin; off by default — must opt in |

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — pure source-text refactor, no DB/S3/key touched | none |
| Live service config | None | none |
| OS-registered state | None | none |
| Secrets/env vars | None | none |
| Build artifacts | `dist/` is rebuilt by `verify`'s `build` step; no stale-name artifact (this is type-vs-interface, names unchanged) | none — `verify` rebuilds |

**Nothing found in any runtime category** — verified: the conversion changes only the `interface`/`type` keyword and import order; no identifier, file name, object key, env var, or schema changes.

## Validation Architecture

> `workflow.nyquist_validation` not disabled — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (V8 coverage, 100% thresholds inherited from `@solid-stats/ts-toolchain/vitest/base`) |
| Config file | `vitest.config.ts` (overlays include/exclude on the shared base) |
| Quick run command | `pnpm test` (`vitest run`, unit only) |
| Full suite command | `pnpm verify` (format:check → lint → typecheck → test → test:coverage → build → depcruise → knip) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MECH-01 | conversion is logic-free; golden oracle unaffected | regression (existing) | `pnpm test` + `pnpm run test:coverage` | ✅ existing golden + unit suite |
| MECH-01 | new `interface` fails verify | enforcement | `oxlint --config .oxlintrc.json src` (errors on `interface`) | ✅ via `lint` in `verify` |
| MECH-01 | types still compile | typecheck | `pnpm run typecheck` | ✅ |
| MECH-02 | unsorted import fails verify | enforcement | `oxfmt --check .` | ✅ via `format:check` in `verify` |
| MECH-02 | reordering is behavior-free | regression (existing) | `pnpm test` | ✅ |

### Sampling Rate
- **Per task commit:** `pnpm run typecheck && pnpm run lint && pnpm run format:check`
- **Per wave merge:** `pnpm test`
- **Phase gate:** full `pnpm verify` green (incl. coverage + golden oracle + depcruise + knip) before `/gsd-verify-work`.

### Wave 0 Gaps
- None — this is a behavior-preserving refactor on a fully-tested CLI. The existing golden e2e oracle + 100% V8 coverage + depcruise + knip are the oracle; no new tests are needed. The ONLY new "test" is the enforcement itself (the two added rules), validated by the spike (a `type X = …` passes, a future `interface X` fails `lint`).

## Behavior-Preservation Gate — Confirmed Unaffected

| Gate | Affected? | Evidence |
|------|-----------|----------|
| `tsc` | No | spike: exit 0 |
| Golden oracle + 100% V8 coverage | No | conversion changes only keyword/import order; no runtime identifier or value changes |
| depcruise | No | no module added/removed/moved; `.fixtures`/band layout unchanged |
| knip | No | no export added/removed (interface→type keeps the same exported name) |
| The one flagged risk (`extends Error` merged-interface semantics) | No | `CloudflareChallengeError = {…} & Error` typechecks; `instanceof Error` guard logic untouched (it's a runtime check, not the type) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Constraining `sortImports` via `partitionByComment`/`groups` will narrow the 56-file diff as intended | MECH-02 | LOW — the default (accept 56-file diff) is fully verified and recommended; the object-form is optional polish, not yet spike-tested |

**All other claims VERIFIED via spike** — the conversion count, tsc result, exemption analysis, suppression inventory, and the local oxfmt mechanism were each run against the real tree and reverted.

## Open Questions

1. **Accept 56-file import-sort diff vs. constrain the algorithm?**
   - What we know: defaults work, tsc-green, enforceable; diff is pure reordering.
   - What's unclear: whether the team prefers a minimal diff (object-form config) over the broad-but-simple default.
   - Recommendation: **accept the default 56-file diff** in a single isolated commit; it is the lowest-complexity path and the enforcement is identical. Only reach for `partitionByComment: true` if the `max-lines`-comment reshuffle is objected to in review.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| oxlint | MECH-01 conversion + enforcement | ✓ | 1.69.0 | — |
| oxfmt | MECH-02 sort + enforcement | ✓ | 0.54.0 | — |
| tsc (typescript) | gate | ✓ | 6.0.3 | — |
| `consistent-type-definitions` rule | MECH-01 | ✓ | in oxlint 1.69.0 schema | — |
| `sortImports` (oxfmt) | MECH-02 | ✓ | in oxfmt 0.54.0 schema | — |
| ts-morph | (fallback only) | ✗ | — | **Not needed** — oxlint spike succeeded |

**No missing dependencies.** No new package is installed by this phase.

## Package Legitimacy Audit

This phase installs **no external packages** (ts-morph fallback ruled out). Audit not applicable.

## Sources

### Primary (HIGH confidence — verified this session against the real tree)
- Spike run: `oxlint --fix` with `consistent-type-definitions` → 156/156 converted, `tsc --noEmit` exit 0 (reverted)
- Spike run: `oxfmt --check`/`--write` with `sortImports: true` → 56 files, isolated on clean tree (reverted)
- `node_modules/oxlint/configuration_schema.json` — rule existence
- `node_modules/oxfmt/configuration_schema.json` — `sortImports` + `SortImportsConfig` fields
- `node_modules/@solid-stats/ts-toolchain/oxfmt/base.oxfmtrc.json` — preset has no sortImports
- Local `.oxfmtrc.json`, `.oxlintrc.json`, `package.json`, `vitest.config.ts` — repo config
- grep audits: interface counts, duplicate names, `extends`, `declare global/module`, `implements`, disable comments

## Metadata

**Confidence breakdown:**
- MECH-01 (conversion): HIGH — full spike, 156/156, tsc green, exemptions exhaustively ruled out
- MECH-02 (import-sort): HIGH on mechanism/blast-radius (spiked); MEDIUM on the optional narrowing-config (A1, not spiked)
- Pitfalls / behavior-preservation: HIGH — each derived from an observed spike artifact

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (stable; would only change if oxlint/oxfmt versions bump)
