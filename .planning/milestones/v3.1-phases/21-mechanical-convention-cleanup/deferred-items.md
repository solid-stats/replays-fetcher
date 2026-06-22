# Phase 21 — Deferred Items

> Corrected post-execution. An earlier draft of this file (written mid-execution) claimed
> `scripts/capture-golden-fixtures.ts` was reverted and still held two `interface` declarations.
> That is STALE: commit `6da1ed1` converted them — the file now has ZERO interfaces (verified
> `grep -nE "interface " scripts/capture-golden-fixtures.ts` → none). The items below are the real
> residuals.

## Out-of-scope discoveries (logged, NOT fixed this phase)

### LINT-SCOPE — `consistent-type-definitions` is enforced for `src/` only (optional follow-up)

`pnpm run lint` is `oxlint --config .oxlintrc.json src` — it does NOT lint `scripts/`. So a NEW
`interface` added under `scripts/` would NOT fail the lint gate (format:check, which runs on `.`,
still covers formatting but not the type-definition rule). `scripts/capture-golden-fixtures.ts`
was converted by hand in 6da1ed1, but the enforcement does not police `scripts/` going forward.

- **Out of scope for Phase 21:** MECH-01 targets the codebase (`src/`) conventions; `scripts/` is
  dev-only tooling (golden-fixture capture), not production ingest code.
- **Optional follow-up:** widen the lint glob to `oxlint ... src scripts` (or add a `scripts/`
  lint step) if `scripts/` convention enforcement is wanted. Low priority.

## Quick code-review findings (deferred)

### WR-01 — `oxlint-disable max-lines` comment displaced in run-once.ts (deferred → Phase 22)

`src/run/run-once.ts:12` — the `/* oxlint-disable max-lines */` file-disable comment moved from
line 1 into the import block when `sortImports` reordered the file. Oxlint honours a file-disable
in ANY position, so suppression still works (verified: `verify` green). The comment will keep
"floating" on future sorter runs.

- **Routed to Phase 22, not fixed now:** `run-once.ts` is one of the FOUR `max-lines`-suppressed
  god-files Phase 22 splits — Phase 22 REMOVES this suppression entirely. Moving the comment back
  now is churn Phase 22 deletes, and the sorter could re-displace it before then. Resolving it as
  part of the Phase 22 split is the correct, stable fix.

### IN-01 — split JSDoc header in capture-golden-fixtures.ts (deferred → Phase 26, readability)

`scripts/capture-golden-fixtures.ts:1` — the JSDoc header is interleaved with `node:` imports
after sorting. Readability only, not a bug. Bundle with the Phase 26 hygiene sweep if worth it.

---

## ✅ Behavior-preservation confirmed (not a deferral)

Verifier confirmed zero logic change: tsc green, 502 unit tests unchanged, 100% V8 coverage,
golden run-once + watch oracles 7/7, both enforcement lock-ins proven. The 5 `extends`→intersection
conversions are correct; the Sentry side-effect import in `src/cli.ts` stays first/unsorted-across.
