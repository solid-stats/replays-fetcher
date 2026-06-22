# Phase 26: Test-Quality Pass + Correctness Hygiene - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

The pre-existing test-quality backlog is closed and the live-verified correctness
findings are fixed — raising test rigor and code correctness with zero false-positive
churn and no loss of coverage or behavior.

Requirements in scope: CORR-01, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05.

This is the residual hygiene sweep that lands after every prior v3.1 phase (19–25) is
complete. Behavior-preserving: golden oracle + 100% V8 coverage held; no new `v8 ignore`
suppressions; depcruise + knip green.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss phase was skipped per
user setting (workflow.skip_discuss=true). Use the ROADMAP phase goal, success criteria,
the carried-forward findings below, and codebase conventions to guide decisions.

The governing anti-false-positive rule (NON-NEGOTIABLE): the convention audit's semantic
tier is ~50% false-positive (Haiku-verified). Every correctness-hygiene finding MUST be
re-verified live (file:line) against current source before it becomes a commit. Only the
mechanical lane (already applied in Phase 21) is bulk-safe. Expect the category to shrink
substantially from its raw 335-finding count. No audit false-positive is committed as a
change.

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research. The phase touches the test
suite (Vitest, 556 tests, 100% V8 coverage) and a small number of source correctness
sites re-verified live.

</code_context>

<specifics>
## Specific Ideas

### Carried-forward correctness findings (from Phase 20 deferred-items.md → route to CORR-01)

- **W-02** — `src/commands/watch.ts` `requireStagingRepository` throws a raw
  `new Error("Expected staging repository for watch")` instead of a typed `AppError`
  subclass, bypassing the CLI error boundary. It sits on a `/* v8 ignore next 3 */`
  unreachable defensive guard. Phase 26 action: convert to the project typed error
  (e.g. `ConfigValidationError`) or a TypeScript assertion if provably unreachable.
  Re-verify live (file:line) before committing — the line numbers in the deferred note
  predate the Phase 22 god-file splits and may have moved.

- **I-01** — `src/commands/watch.ts` runs `flushLogger` inside the `try`; a rejection
  runs `dispose()` in `finally` then propagates uncaught. Consistent with `run-once` and
  test-covered. Doc-only: document the intent to prevent a future silent-swallow
  regression. Low priority; bundle into the sweep.

### Test-quality backlog (TEST-01..05, success criteria)

- AAA arrange/assert duplicated literals → named constants or typed builders;
  multi-behavior tests split to one behavior per test (RITE).
- Dedup / conflict / date-parse matrices → `test.each` parameterized tables.
- Watch-loop timing paths → `vi.useFakeTimers()`; no real sleeps remain in tests.
- Untested reachable branches → closed by new tests; no new `v8 ignore` suppressions.

</specifics>

<deferred>
## Deferred Ideas

None — discuss phase skipped. Any finding that turns out to be a false positive on live
re-verification is dropped (not committed), per the anti-false-positive rule above.

</deferred>
