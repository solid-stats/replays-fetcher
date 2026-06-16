---
phase: 260616-ucj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/types/run-summary.ts
  - src/run/summary.ts
  - src/run/run-once.ts
  - src/run/summary.test.ts
  - src/run/run-once.test.ts
autonomous: true
requirements: [SG-PARITY-FOLLOWUP-1]
must_haves:
  truths:
    - "A clamping source that repeats its last all-duplicate page terminates via stop-on-all-duplicate and reports status \"complete\" (not unbounded)."
    - "A run bounded by the maxPages safety cap over a longer corpus reports status \"truncated\" (not \"complete\")."
    - "A genuine empty-page end still reports status \"complete\"."
    - "A page with at least one NEW candidate never triggers the all-duplicate stop."
    - "A run that ends on a !ok page still resolves via the existing resumable/partial/failed branches (unchanged)."
  artifacts:
    - path: "src/types/run-summary.ts"
      provides: "RunStatus union extended with \"truncated\""
      contains: "truncated"
    - path: "src/run/summary.ts"
      provides: "deriveRunStatus returns \"truncated\" when the loop hit the cap"
      contains: "truncated"
    - path: "src/run/run-once.ts"
      provides: "stop-on-all-duplicate break + reachedMaxPages threading into deriveRunStatus"
  key_links:
    - from: "src/run/run-once.ts"
      to: "src/run/summary.ts"
      via: "assembleResult passes reachedMaxPages into deriveRunStatus"
      pattern: "reachedMaxPages"
    - from: "src/run/run-once.ts (completeOkPage)"
      to: "src/run/run-once.ts (runPageLoop stop decision)"
      via: "per-page MutablePageCounts threaded up so zero-new (stored===0 && staged===0) can stop the loop"
      pattern: "stored === 0"
---

<objective>
Fix two confirmed defects in the `run-once` page loop (SG parity follow-up #1):

1. **Unbounded clamp crawl.** sg.zone clamps past the last real page — it returns the
   same last (all-duplicate) page forever, never an empty page. The loop's only natural
   stop is `pageReport.candidates.length === 0` (run-once.ts ~896), which never fires
   against a clamping source; with `maxPages` unset the crawl is unbounded (observed to
   page 1070+). Add a **stop-on-all-duplicate** break: an `ok` page that yields ZERO NEW
   work is a natural end-of-corpus → status stays `complete`.
2. **Silent truncation.** When the loop stops by hitting the `maxPages` safety cap,
   `deriveRunStatus` still returns `complete`, so a capped run is indistinguishable from a
   genuine end-of-corpus. Add a `truncated` member to `RunStatus` and thread a
   `reachedMaxPages` boolean from the loop exit into `deriveRunStatus` so a capped run
   surfaces as `truncated`.

Purpose: a clamping source must terminate without a runaway crawl, and a cap-bounded run
must be honestly distinguishable from full corpus coverage in the operator-visible run
summary.

Output: extended `RunStatus` union, an updated `deriveRunStatus`, a stop-on-all-duplicate
break and `reachedMaxPages` threading in `run-once.ts`, plus the four required Vitest
scenarios — all at 100% reachable-source coverage and a green `pnpm verify`.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md
@.agents/skills/solidstats-fetcher-ts-tests/SKILL.md

# The defect surfaces and the dedup signal
@src/run/run-once.ts
@src/run/summary.ts
@src/types/run-summary.ts
@src/storage/store-raw-replay.ts
@src/staging/types.ts
@src/discovery/types.ts

# Test style to match
@src/run/run-once.test.ts
@src/run/summary.test.ts

## Investigation result — the precise zero-new signal (read before Task 2)

The task brief points at discovery diagnostics, but discovery's
`collectCandidateDiagnostics` (discover.ts) only dedups candidates WITHIN a single
discovery call. run-once drives discovery one page at a time (`maxPages: 1` per
`buildDiscoverInput`), so the DiscoveryReport has NO cross-page / cross-corpus "already
known" signal — it cannot tell a repeated clamp page from a fresh page.

The authoritative cross-corpus dedup signal lives DOWNSTREAM, at the store and staging
layers, and is ALREADY computed per page inside `completeOkPage` → `processPage` as
`MutablePageCounts`:
- `StoreRawReplayResult.status === "stored"` → a genuinely NEW object written to S3
  (S3 raw storage does HEAD-before-PUT and returns `status: "skipped"` for an object that
  already exists — `src/storage/s3-raw-storage.ts`).
- `IngestStagingResult.status === "staged"` → a NEW pending staging row
  (`already_staged` means the row already existed — `src/staging/types.ts`).

So the per-page **new-work count is `pageCounts.stored + pageCounts.staged`**. A clamp page
where every candidate is a duplicate yields `stored === 0 && staged === 0` (all `skipped` /
`already_staged`). That is the zero-new signal — do NOT invent a DiscoveryReport field.
`completeOkPage` already computes `pageCounts` but currently discards it (returns only the
ETag); Task 2 threads it up so the loop can make the stop decision.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add "truncated" to RunStatus and make deriveRunStatus honor a cap-hit flag</name>
  <files>src/types/run-summary.ts, src/run/summary.ts, src/run/summary.test.ts</files>
  <behavior>
    - deriveRunStatus({ ok: true, lastCompletedPage: N, discoveredLastPage: N, reachedMaxPages: true }) === "truncated"
    - deriveRunStatus({ ok: true, lastCompletedPage: N, discoveredLastPage: N, reachedMaxPages: false }) === "complete" (unchanged)
    - deriveRunStatus({ ok: true, lastCompletedPage: N, discoveredLastPage: N }) === "complete" (reachedMaxPages omitted ⇒ defaults to not-truncated; existing callers/tests unchanged)
    - A recoverable source failure still returns "resumable" even if reachedMaxPages were set (cap is only consulted on the ok-and-finished branch)
    - runExitCode for a "truncated" summary returns 2 (status !== "complete" ⇒ scheduler retries to fetch more); no code change needed but assert it
  </behavior>
  <action>
    In `src/types/run-summary.ts`, extend the `RunStatus` union (currently
    `"complete" | "failed" | "partial" | "resumable"`) by adding the `"truncated"` member.
    Keep the union alphabetically ordered to satisfy the lint sort rule already applied to
    sibling unions (e.g. RunFailureCategory). The `status?: RunStatus` optional fields on
    `RunSummary` and `CompactRunSummary` widen automatically — no further type edit there.

    In `src/run/summary.ts`, add `readonly reachedMaxPages?: boolean;` to the
    `DeriveRunStatusInput` interface. In `deriveRunStatus`, BEFORE the existing
    `if (input.ok && input.lastCompletedPage >= input.discoveredLastPage)` complete-check,
    add a guard: when the run is ok AND finished every discovered page AND
    `input.reachedMaxPages === true`, return `"truncated"`. Concretely, gate the truncated
    return on the SAME `ok && lastCompletedPage >= discoveredLastPage` condition the
    complete branch uses, so a cap that coincides with a clean finish surfaces as truncated
    while a !ok / recoverable stop still falls through to the resumable/partial/failed
    branches unchanged. Update the deriveRunStatus doc comment to document the new
    `truncated` member: ran fine but coverage was bounded by the maxPages cap, more may
    exist — distinct from `partial` (a non-recoverable failure that salvaged some pages).

    `runExitCode` already maps any `status !== "complete"` to exit 2, so `truncated` yields
    exit 2 with no change — confirm by reading it, do not edit. Likewise
    `resumeInvocationOption` in run-once.ts returns the resume invocation for any non-complete
    status, so a truncated run already carries `resumeInvocation` — no edit needed.

    Add unit tests to `src/run/summary.test.ts` matching the existing deriveRunStatus test
    style (direct calls, no orchestration): a truncated case (ok + reachedMaxPages true),
    the unchanged complete case (reachedMaxPages false and omitted), a recoverable-failure
    case that stays "resumable" with reachedMaxPages true, and a runExitCode("truncated")===2
    assertion.
  </action>
  <verify>
    <automated>cd /home/afgan0r/Projects/SolidGames/replays-fetcher && pnpm exec vitest run src/run/summary.test.ts && pnpm exec tsc --noEmit</automated>
  </verify>
  <done>RunStatus includes "truncated"; deriveRunStatus returns "truncated" only on an ok+finished+cap-hit run and "complete" otherwise; recoverable failures still return "resumable"; runExitCode("truncated")===2; summary.test.ts passes and typecheck is clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Stop-on-all-duplicate break + thread reachedMaxPages into deriveRunStatus</name>
  <files>src/run/run-once.ts, src/run/run-once.test.ts</files>
  <behavior>
    - Clamping source (every page after the corpus repeats the same all-duplicate page, all candidates resolve to stored:"skipped" + staged:"already_staged"): the loop stops on the first zero-new ok page, does NOT iterate to maxPages, and the result status is "complete" (natural end-of-corpus).
    - maxPages-bounded run over a corpus longer than the cap (every page has NEW work — stored:"stored" + staged:"staged"): the loop stops because page exceeded maxPages, and the result status is "truncated" with exitCode 2.
    - Genuine empty-page end (an ok page with zero candidates) still stops and reports "complete" (existing behavior preserved).
    - Mixed page (>=1 new candidate alongside duplicates — pageCounts.stored + pageCounts.staged > 0): does NOT trigger the all-duplicate stop; the loop continues to the next page.
  </behavior>
  <action>
    In `src/run/run-once.ts`:

    (a) Make the per-page new-work count available to the loop. `completeOkPage` already
    computes `pageCounts` via `processPage` but returns only the next ETag. Change
    `completeOkPage` to return both the ETag and the `MutablePageCounts` (return a small
    object, e.g. `{ etag, pageCounts }`, and update its doc comment + the single call site
    in `runPageLoop`). Do not change the checkpoint-write timing — the counts are read from
    the value `processPage` already produced.

    (b) Add the stop-on-all-duplicate break in `runPageLoop`, AFTER the `completeOkPage`
    call returns (the page is fully classified, stored, staged, and checkpointed — preserving
    RANGE-06 ordering: classify/process the page BEFORE the stop decision). The zero-new
    signal is `pageCounts.stored === 0 && pageCounts.staged === 0` (see the investigation
    note in <context>: a clamp page is all `skipped`/`already_staged`). When that holds,
    `break` — this is a NATURAL end-of-corpus, so do NOT set the cap flag (status stays
    `complete` via deriveRunStatus). Update `state.lastCompletedPage`/`state.etag` for this
    final page BEFORE breaking, exactly as the normal iteration does, so the all-duplicate
    page still counts as completed. A page with at least one new candidate
    (`stored + staged > 0`) skips the break and the loop continues — this is the
    new+duplicate-mix guard.

    (c) Thread the cap-hit flag. The existing zero-candidates break (the `ok` page with
    `pageReport.candidates.length === 0`) and the new all-duplicate break are both natural
    ends; the `!ok` break is a failure stop. Only the `for` condition exhausting
    (`page > maxPages` after a full iteration) is a cap-bounded stop. Track this: declare a
    mutable `reachedMaxPages` (default `false`) in `runPageLoop`; set it to `true` only when
    the loop exits because the `for` bound was reached while `maxPages` is finite (i.e. the
    last iteration completed an ok page and the next `page` would exceed a finite `maxPages`).
    A clean way: after the loop, set `reachedMaxPages = maxPages !== Number.POSITIVE_INFINITY
    && state.lastCompletedPage >= maxPages && state.discoveryReport.ok` — but ONLY when the
    loop was not stopped early by an empty/all-dup/!ok break. Implement by having each early
    break path leave a clear signal (e.g. an enum-like local `stopReason` of
    `"empty" | "all_duplicate" | "page_failed" | "cap"` initialized to `"cap"` and set on
    each break), then derive `reachedMaxPages = stopReason === "cap"` after the loop. Choose
    whichever of these two readings keeps the function within its existing structural limits;
    a small `stopReason` local is the clearer one and avoids re-deriving cap state.

    (d) Surface `reachedMaxPages` to status derivation. `runPageLoop` mutates `LoopState`
    in place; add a `reachedMaxPages: boolean` field to `LoopState` (and initialize it
    `false` in `buildLoopState`), set it from the loop's `stopReason`, then read it in
    `runOnce` when building the `assembleResult` context. Add `reachedMaxPages` to
    `AssembleResultInput` and pass it through to `deriveRunStatus` in `assembleResult`
    alongside the existing `ok` / `lastCompletedPage` / `discoveredLastPage` inputs. Note:
    on a cap exit `discoveryReport.ok` is true and `lastCompletedPage === discoveredLastPage`
    (deriveDiscoveredLastPage returns lastCompletedPage on an ok report), so the
    `truncated` guard added in Task 1 fires exactly on the cap-hit branch.

    Keep all edits within the `run/` orchestration band (conventions §A: the loop and the
    stop decision are orchestration; the cross-band `RunStatus` type lives in `types/`, edited
    in Task 1). No new HTTP, no replay parsing, no write-scope change, no checkpoint-timing
    change.

    Add Vitest scenarios to `src/run/run-once.test.ts` matching the existing fakes (no real
    network; `fakeCheckpointStore`, `discoveryReport()`, `rawStored()`/`rawSkipped()`,
    `createClock`, fake `stageRawReplay`/`storeRawReplay`):
    - Clamping source: `discoverReplays` returns a page of the SAME candidate(s) on every
      call (or a small repeating set); `storeRawReplay` returns `rawSkipped()` and
      `stageRawReplay` returns `{ status: "already_staged" }`. Use a generous `maxPages`
      (or leave it unset) and assert the loop calls discovery a SMALL bounded number of times
      (e.g. discovery invoked exactly once before the stop, NOT maxPages times) and the
      result is `status: "complete"` with exitCode 0. The clock fixture must supply enough
      timestamps; a repeating last value via `createClock` already handles overruns.
    - maxPages-bounded run: a corpus where every page has NEW work (`rawStored()` +
      `{ status: "staged" }`) and `maxPages` is smaller than the corpus; assert the loop runs
      exactly `maxPages` pages and the result is `status: "truncated"` with exitCode 2.
    - Genuine empty-page end: discovery returns `candidates: []` on page 2 (after a real
      page 1) ⇒ `status: "complete"` (assert the existing complete path is intact).
    - New+duplicate mix: a page whose candidates produce at least one `stored`/`staged`
      result alongside skipped/already_staged ones does NOT trigger the all-duplicate stop —
      assert discovery is called for the NEXT page.
  </action>
  <verify>
    <automated>cd /home/afgan0r/Projects/SolidGames/replays-fetcher && pnpm exec vitest run src/run/run-once.test.ts && pnpm exec tsc --noEmit</automated>
  </verify>
  <done>A clamping all-duplicate source terminates via the zero-new break with status "complete" and a small bounded discovery-call count (never unbounded); a maxPages-bounded longer corpus yields status "truncated" (exitCode 2); a genuine empty page stays "complete"; a new+duplicate-mix page never stops the loop; run-once.test.ts passes and typecheck is clean.</done>
</task>

<task type="auto">
  <name>Task 3: Full verify gate green at 100% coverage</name>
  <files>src/run/run-once.ts, src/run/summary.ts, src/run/run-once.test.ts, src/run/summary.test.ts</files>
  <action>
    Run the full project gate and resolve any failures introduced by Tasks 1-2 without
    relaxing standards:
    - `format:check` / `lint`: oxfmt + oxlint clean (no new suppressions; keep the union
      sort order and the existing `oxlint-disable` headers untouched).
    - `typecheck`: clean (the widened `RunStatus` must not break any consumer — confirm no
      exhaustive `switch (status)` exists that the new member breaks; the grep done in
      planning found only `=== "complete"` checks, which are additive-safe).
    - `test` + `test:integration` (testcontainers; Docker is available) + `test:coverage`:
      100% reachable-source V8 coverage. If the new branches (truncated guard,
      all-duplicate break, stopReason="cap" path) leave an uncovered line, ADD a test that
      exercises it rather than an inline `v8 ignore` — these branches are all reachable from
      the orchestration unit tests.
    - `build`, `depcruise`, `knip`: clean (no new band-crossing import — `RunStatus` stays
      in `types/`, consumed downward; no unused export introduced).
    Cross-app note (record in the SUMMARY): `RunStatus` is an operator-visible run-summary
    field (a structured-log object per conventions §D, not a DB/web contract), so adding the
    `truncated` member is additive and safe; no `server-2`/`web` schema change is implied.
  </action>
  <verify>
    <automated>cd /home/afgan0r/Projects/SolidGames/replays-fetcher && pnpm verify</automated>
  </verify>
  <done>`pnpm verify` exits 0: format:check, lint, typecheck, test, test:integration, test:coverage (100% reachable-source), build, depcruise, and knip all pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| external source (sg.zone) → run-once page loop | Untrusted, clamping upstream: returns the same last page forever instead of an empty page. The loop must terminate against this adversarial-by-omission behavior. |
| run summary → operator / scheduler | The `RunStatus` field drives operator interpretation and the scheduler exit code; a wrong status (silent `complete` on a capped run) is a correctness/observability failure. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ucj-01 | Denial of Service | run-once page loop vs. clamping source | mitigate | Stop-on-all-duplicate break terminates the loop at end-of-corpus even when the source never returns an empty page; removes the unbounded-crawl runaway (no reliance on the infra cap). |
| T-ucj-02 | Information disclosure (misleading) | deriveRunStatus / run summary | mitigate | `truncated` status makes a cap-bounded run honestly distinguishable from full coverage; an operator/automation can no longer read partial coverage as complete. |
| T-ucj-03 | Tampering | n/a — no package installs | accept | No new dependencies; pure logic + type change inside existing modules. No package-manager install in this plan. |
</threat_model>

<verification>
- `pnpm verify` exits 0 (format:check → lint → typecheck → test → test:integration →
  test:coverage → build → depcruise → knip), Docker available for testcontainers.
- 100% reachable-source V8 coverage preserved; no new `v8 ignore` and no new lint suppression.
- The four required scenarios assert: clamp ⇒ complete + bounded calls; cap ⇒ truncated +
  exit 2; empty page ⇒ complete; new+dup mix ⇒ no stop.
- `RunStatus` change is confined to `types/` (cross-band contract) and consumed downward;
  `depcruise` confirms no band-crossing import was introduced.
</verification>

<success_criteria>
- A clamping all-duplicate source terminates via stop-on-all-duplicate with status
  `complete` and a small bounded discovery-call count — never an unbounded crawl.
- A maxPages-bounded run over a longer corpus reports status `truncated` (exit 2), not
  `complete`.
- A genuine empty-page end still reports `complete`; a page with at least one new candidate
  never triggers the all-duplicate stop; a `!ok` page still resolves via the unchanged
  resumable/partial/failed branches.
- `pnpm verify` is green at 100% reachable-source coverage with no new suppressions.
</success_criteria>

<output>
Create `.planning/quick/260616-ucj-fix-unbounded-clamp-crawl-and-silent-cap/260616-ucj-SUMMARY.md` when done.
</output>
