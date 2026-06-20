# Phase 21 — Deferred Items

## Out-of-scope discoveries (logged, NOT fixed this phase)

- **`scripts/capture-golden-fixtures.ts` retains two `interface` declarations**
  (lines 48 `ManifestFile`, 87 `RowCaptureInput`). These violate the
  `consistent-type-definitions` rule that Plan 21-01 enabled, but `scripts/` was
  outside 21-01's `src/**` conversion scope and outside 21-02's `src/**/*.ts`
  import-sort scope. The lefthook `lint` gate flags this file whenever it is staged.
  Discovered during 21-02 because `oxfmt --write .` touched the file's import block.
  The scripts file was reverted to HEAD (its import block was already sorted —
  `format:check` stays green without it). Fix is a one-line-per-interface
  `interface` → `type` conversion; belongs to a follow-up convention sweep that
  declares `scripts/**` in its `files_modified`.
