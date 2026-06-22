# Review — Phase 26 (Test-Quality Pass + Correctness Hygiene)

**Scope:** 13 files changed vs `00da3b6` (W-02 typed `InvariantViolationError` across 3 composition guards; `config.ts` `as SourceTransport` cast → Zod-validated `z.enum(SOURCE_TRANSPORTS)`; `run-once-summary.ts` §AA `{ err }` traceback in evidence-write swallows; test-quality refactors in `config.test.ts`, `ingest-page.test.ts`, `run-once.test.ts`, `payload.test.ts`, `postgres-staging-repository.test.ts`; new `types/source-transport.ts`). Read every changed file in full plus the touched production siblings (`app-error.ts`, `payload.ts`, `cli.ts`, `index.ts`, `commands/shared.ts`).
**Depth:** deep (3 lenses: Contract Adversary, Edge/Failure Hunter, Acceptance Auditor).
**Gates:** not run (read-only review; the suite/lint/typecheck gates were not executed in this pass — see Validation Gaps).
**Skills read in full:** `solidstats-fetcher-ts-code-review/SKILL.md`, `solidstats-shared-review-standards/SKILL.md`, `solidstats-fetcher-ts-conventions/SKILL.md`, `solidstats-shared-backend-ts-standards/SKILL.md`, `solidstats-shared-backend-ts-standards/references/correctness-and-quality.md`, `solidstats-shared-ts-standards/SKILL.md`.

## Ingest boundary
✅ (a) No parser / replay-content-decode import introduced — the change set touches errors, config, summary logging, and tests only.
✅ (b) Write scope intact — no new PG/S3 write path; no `server-2` business-table touch. The guards (`requireStagingRepository` / `stageRawEvidence`) only gate the *existing* staging path.
✅ (c) Source-evidence completeness — no new write path; `payload.ts` evidence set unchanged.
✅ (d) Idempotency — staging natural-key + `ON CONFLICT` discipline untouched (`postgres-staging-repository.test.ts` still exercises 23505 classification).

No gate failure. Proceeding to the severity buckets.

## Blockers 🔴
_none_

## High 🟠
_none_

## Medium 🟡

1. `src/staging/payload.test.ts:158-166`, `:179-181` [tests] — **`if (result.stageable)`-guarded oracle can silently no-op.** The ABSENT-`replayTimestamp` `test.each` matrix and the standalone out-of-range test wrap their only assertion in `if (result.stageable) { expect(result.payload).not.toHaveProperty("replayTimestamp"); }`. Every input is built from `createStoredEvidence(...)`/`withoutListingDate(...)` with `status: "stored"`, so `stageable` is always `true` today and the guard is dead-true — but if a future change ever flipped `toIngestStagingPayload` to return `stageable: false` for one of these inputs, the test would assert *nothing* and still pass (no `else`, no failure path), masking the regression. The refactor carried this pre-existing pattern forward and now applies it to a 3-row matrix, widening the blind spot. The `result.stageable` flag is a discriminated-union narrower, not test data — assert it. Fix: assert stageability before the property check so the negative case can't vanish:
   ```ts
   const result = toIngestStagingPayload(withoutListingDate({ sourceFilename: filename }));
   expect(result.stageable).toBe(true);          // narrow the union, fail loudly if it flips
   if (!result.stageable) throw new Error("unreachable");
   expect(result.payload).not.toHaveProperty("replayTimestamp");
   ```
   (or assert against the full `toStrictEqual` shape the PRESENT matrix already uses). `[std: testing → oracle strength; review-standards §F]`

## Low 🔵

2. `src/staging/postgres-staging-repository.test.ts:243-247` [tests] — **`toMatchObject(match ?? {})` is an empty assertion when a case supplies neither `expected` nor `match`.** The classification runner falls back to `toMatchObject(match ?? {})`; `toMatchObject({})` passes against any object. All six current rows supply one or the other, so today it is fine, but the `?? {}` default makes a future malformed row (both fields omitted) a green-but-vacuous test. Fix: make the fallback explicit — `expect(match).toBeDefined()` before `toMatchObject(match)`, or drop the `?? {}` so TS/`undefined` surfaces the gap. `[std: testing → oracle strength]`

3. `src/errors/invariant-violation-error.ts:36-40` [docs] — **Doc comment describes a type-branching boundary the CLI does not implement.** The comment states "The CLI error boundary maps a non-operational `AppError` to exit 1 … NOT exit 2". The actual top-level boundary (`cli.ts:44-51`) is a bare `catch` that maps *any* escaped throw to exit 1 — it never inspects `instanceof AppError` or `isOperational` (the per-command exit-2 mapping for `ConfigValidationError` lives upstream in `commands/shared.ts`, not the boundary). The *outcome* (exit 1) is correct, and `isOperational: false` is the right semantic marker, but the comment over-claims a mechanism that isn't there, which will mislead the next reader who goes looking for the branch. Tighten the comment to "an uncaught throw from a command handler exits 1 via the top-level boundary (`cli.ts`); `isOperational: false` marks it a programmer bug for reporting, not exit-code selection." `[std: comments → explain why, accurately]`

## Non-Findings Checked

- **Contract Adversary — `SourceTransport` union not weakened.** `types/source-transport.ts` derives `SOURCE_TRANSPORTS` as `[...] as const satisfies readonly SourceTransport[]`, and `config.ts:92` feeds the same tuple to `z.enum`. The type, the runtime validator, and the values are now single-sourced; a member added to the type but not the tuple fails to compile, and the old `value as SourceTransport` blind cast is gone — `sourceTransportOrUndefined` returns `string | undefined`, so an unknown transport (`"ftp"`) reaches `z.enum` and is rejected with a `ConfigValidationError` naming `sourceTransport` (`config.test.ts:259-278`). Tampering path closed; the empty-string → default-`direct` branch is preserved and tested.
- **§AA — evidence-write swallows now diagnosable, no secret/byte leak.** Both `writeEvidence` catches (`run-once-summary.ts:170-176`, `:188-194`) now pass `{ err: error }` (stack serialized) alongside an `evidence_write_failed` discriminator and `runId` — identifiers only; `summary` is not logged, no bytes/URL/secret interpolated, the message is static. The swallow-and-continue is the documented log-and-continue policy (mirrors `writeFinalCheckpoint`), not a silent degrade.
- **§AA — `InvariantViolationError.details` is identifiers-only.** `toDetailsRecord` flattens to `{ guard, command? }` (both literal identifiers), drops the absent optional, uses bracket assignment (no `as`). `invariant-violation-error.test.ts:48-58` asserts the serialized details match no `body|secret|password|token|<html`.
- **Typed-error correctness.** `InvariantViolationError extends AppError<"invariant_violation">` with a narrow literal code, `isOperational: false`, and an explicit `this.name` (the base sets `"AppError"`; subclass override verified by test). The three guards now throw the typed error instead of a raw `Error` — W-02 satisfied at all three call sites (`discover.ts:101`, `run-once.ts:54`, `watch.ts:16`).
- **Edge/Failure Hunter — deterministic ordering replaced wall-clock sleeps without losing regression detection.** `ingest-page.test.ts` / `run-once.test.ts` out-of-order tests use a `createDeferred` signal (A awaits B's resolve) instead of `setTimeout`, and the concurrency-1 test yields across `Promise.resolve()` — both still prove the candidate-index re-ordering and the shared-limiter serialization (the load-bearing oracles `stageCallOrder` vs `staging.map(stagingId)` and `maxInFlight === 1` are intact).
- **No new `v8 ignore`.** The four `v8 ignore` comments in the changed files (`discover.ts:99`, `run-once.ts:52`, `watch.ts:14`, `run-once-summary.ts:55`) are all pre-existing context lines — the diff adds none.
- **Acceptance Auditor — config `test.each` matrices preserve boundary coverage.** The concurrency / request-spacing / watch-interval boundary + reject tables assert both the accepted boundary values and the out-of-range/`"abc"` rejections naming the offending field; the redaction tests still prove secrets (`DATABASE_URL`, `sourceSshCommand`, S3 keys) never serialize.

## Validation Gaps

- Suite, coverage (100% gate), lint, and `tsc --noEmit` were **not** run in this review — verify `pnpm verify` is green before merge. The 100% reachable-source coverage gate is the mechanical backstop for the `if (result.stageable)` dead branch in finding 1; confirm v8 reports the guarded `expect` line as covered (it will, since `stageable` is always true) — coverage will NOT catch the weak oracle, which is why finding 1 stands.
- Blast radius into `server-2`: the staging/payload contract is unchanged in this phase, so no downstream consumer re-check is required.

## Verdict
REQUEST CHANGES — one 🟡 (finding 1, test-oracle weakness that can mask a future `stageable` regression) should be fixed before merge; findings 2-3 are nice-to-have. No blockers; the W-02 typed-error, the `SourceTransport` Zod validation, and the §AA traceback changes are all correct and the ingest boundary is intact.

---
_Deep change — recommend the parallel lens fan-out: run the `solidstats-process-review-lenses` skill (base `00da3b6`, stack `fetcher`); it fans the lenses out via Workflow and merges them into one report._
