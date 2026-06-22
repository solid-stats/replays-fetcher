---
phase: 26-test-quality-pass-correctness-hygiene
plan: 04
subsystem: run-orchestration-tests
tags: [test-quality, determinism, TEST-04, TEST-05, TEST-01, vitest]
requires:
  - "26-01 (W-02 typed-error swap keeping the three guard v8-ignores)"
provides:
  - "Deterministic out-of-order ordering tests in src/run/ingest-page.test.ts and src/run/run-once.test.ts (no wall-clock setTimeout)"
  - "Confirmed v8-ignore inventory: 24 sites, no net-new suppression across the phase, W-02 guards intact"
affects:
  - "src/run/ingest-page.test.ts"
  - "src/run/run-once.test.ts"
tech-stack:
  added: []
  patterns:
    - "Deferred-signal completion ordering (A awaits B's store) replacing timer races"
    - "Microtask yield (await Promise.resolve()) for in-flight concurrency observation"
key-files:
  created: []
  modified:
    - "src/run/ingest-page.test.ts"
    - "src/run/run-once.test.ts"
decisions:
  - "TEST-01 produced no code change: checksum/sourceFilename/object_key literals are already builder/const-backed (rule-of-three not met for the 2-occurrence bucket/byteSize/objectKey) — the plan's '5+ inline' premise was a pre-research estimate dropped on live re-verification per the phase anti-false-positive rule"
  - "TEST-05 is an audit: 24 v8-ignore sites = pre-phase baseline, no new ignore, all survivors reason-tagged — no source edit needed"
  - "Out-of-order determinism uses manual Deferred (form a) over fake timers (form b): strictest determinism, removes the wall-clock entirely; oracle re-verified strong (bumping concurrency to 3 fails the serialization assertion as expected)"
metrics:
  duration: "~25m"
  completed: "2026-06-22"
  tasks_completed: 3
  files_modified: 2
  commits: 1
status: complete
---

# Phase 26 Plan 04: Test-Quality Pass — ingest-page / run-once Correctness Hygiene Summary

TEST-04 removed every real wall-clock out-of-order sleep from `src/run/ingest-page.test.ts` and `src/run/run-once.test.ts`, replacing the `setTimeout` timer races with a manual `Deferred` completion signal and a microtask yield, with the asserted ordering/serialization behavior preserved (oracle re-verified strong); TEST-01 and TEST-05 were verification-only and produced no code change because the literals were already builder-backed and the v8-ignore inventory was already at baseline.

## Skills Read (in full)

- `.agents/skills/solidstats-fetcher-ts-tests/SKILL.md`
- `.agents/skills/solidstats-shared-testing-standards/SKILL.md`
- `.agents/skills/solidstats-shared-ts-standards/SKILL.md`
- `.agents/skills/solidstats-shared-backend-ts-standards/references/correctness-and-quality.md`
- `.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md`

## What Was Done

### Task 1 — TEST-04: deterministic out-of-order ordering (committed `9c5ff50`)

Four real wall-clock `setTimeout` sites were the only timer-based nondeterminism in the two suites:

| File | Test | Old mechanism | New mechanism |
|------|------|---------------|---------------|
| `ingest-page.test.ts` | re-orders fulfilled values despite out-of-order completion | `setTimeout(resolve, 10)` on candidate A so B finishes first | A `await`s a `Deferred` resolved by B's store — explicit signal, no timer |
| `ingest-page.test.ts` | serializes dispatch when concurrency is 1 | `setTimeout(resolve, 10)` to hold work in-flight | `await Promise.resolve()` microtask yield while `running` is incremented |
| `run-once.test.ts` | tallies evidence in candidate-index order despite out-of-order completion | `setTimeout(resolve, 10)` on candidate A | same `Deferred` signal pattern |
| `run-once.test.ts` | serializes dispatch when concurrency is 1 | `setTimeout(resolve, 1)` | `await Promise.resolve()` microtask yield, `limiter.maxInFlight()` read after |

- Added a small `createDeferred()` test-infra helper to each file (lint-clean: captures the resolver in an array, no placeholder function or uninitialized `let`).
- Removed the now-unused `OUT_OF_ORDER_DELAY_MS` const from both files.
- `watch-loop.test.ts` left untouched (already deterministic via its injected `sleep` seam — Pitfall 3).
- No production code touched.

**Oracle re-verification** (mutation-style): temporarily raising the serialization tests to concurrency 3 makes both assertions fail with `expected 3 to be 1`, proving the microtask-yield form still detects a concurrency regression. The out-of-order tests still assert the exact same byte-stable `["replay-a.ocap", "replay-b.ocap"]` staging order.

### Task 2 — TEST-01: rule-of-three literal dedup (no code change)

Live re-verification against current source: the `checksum` value is already a shared module-level const; `sourceFilename` is always builder-parameterized (`filename` arg / `candidate.identity.filename` / spread override), never a repeated raw literal; `bucket: "solid-stats-replays"`, `byteSize: Number("1234")`, and `objectKey: raw/sha256/...` each appear exactly **2 times** (inside the `rawStored` and `rawSkipped` builders only — `rawFetchFailed` carries none). The builders (`rawStored`/`rawSkipped`/`rawFetchFailed`/`replayCandidate`/`discoveryReport`) are already heavily reused (23/3/3/63 calls in run-once).

Rule-of-three is **not met** for any candidate literal, and the plan explicitly states "a literal that appears only once or twice stays inline (DRY is rule-of-three, not rule-of-one)." Extracting a 2-occurrence literal would violate that. The plan's premise of "5+ inline" repeated literals was a pre-research estimate that did not hold on live inspection — dropped, not committed, per the phase's NON-NEGOTIABLE anti-false-positive rule.

### Task 3 — TEST-05: v8-ignore reachability sweep (no code change)

| Check | Result |
|-------|--------|
| Total `v8 ignore` sites in `src/` | **24** — equal to the pre-phase baseline (RESEARCH inventory); no net-new suppression added by any plan in this phase |
| W-02 guard ignores (`watch.ts`, `run-once.ts`, `discover.ts`) | All three present, each with a `--` reason; intact after 26-01's typed-error swap (branch still structurally unreachable) |
| Bare `/* v8 ignore next */` without `--` reason | None — every inline ignore is reason-tagged; the two `v8 ignore start/stop` blocks (`cli.ts`, `summary.ts`) carry the reason on their `start` marker |
| Branch opened-as-reachable by the Task 1 refactor needing a new test | None — coverage held at 100% with zero new ignore |

## Verification

| Gate | Result |
|------|--------|
| `pnpm test -- src/run/ingest-page.test.ts src/run/run-once.test.ts` (x2, determinism) | 54 passed, 54 passed — no flakiness |
| `pnpm run test:coverage` | 100% statements/branches/functions/lines (1862/823/346/1835), exit 0 |
| `pnpm run lint` | green |
| `pnpm run verify` (prettier + eslint + tsc + test + coverage) | exit 0 |
| `pnpm run test:integration` (golden run-once oracle) | exit 0, byte-stable |
| `git diff --name-only e4178d2..HEAD` | only the two test files; no production code, no `watch-loop.test.ts` |

## Deviations from Plan

**Tasks 2 and 3 produced no code change** — both were verification-and-audit tasks whose targets were already satisfied on live re-verification (literals already builder-backed; v8-ignore inventory already at baseline). This is the expected outcome the plan anticipated ("substantial shrink achieved = almost no test-on-branch work, as RESEARCH predicted") and the correct disposition under the phase anti-false-positive rule, not a skipped task. No auto-fixes (Rules 1-3) were triggered; no architectural decisions (Rule 4) arose. No authentication gates.

## Commits

- `9c5ff50` — test(26-04): replace wall-clock out-of-order sleeps with deterministic ordering (TEST-04)

## Self-Check: PASSED

- `src/run/ingest-page.test.ts` — FOUND (modified, no setTimeout timers remain)
- `src/run/run-once.test.ts` — FOUND (modified, no setTimeout timers remain)
- Commit `9c5ff50` — FOUND in git log
- v8-ignore total 24 == baseline — CONFIRMED
- watch-loop.test.ts unchanged — CONFIRMED
