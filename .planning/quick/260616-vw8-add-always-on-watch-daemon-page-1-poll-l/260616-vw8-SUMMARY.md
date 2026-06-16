---
phase: 260616-vw8
plan: 01
subsystem: ingest-runtime
status: complete
tags: [watch-daemon, pacing, resilience, heartbeat, graceful-shutdown]
requires: [run-once pacing primitives (source/pacing.createPacer), ingestPage DRY core]
provides: [always-on paced page-1 watch daemon, atomic heartbeat, production-owned signal cleanup]
affects: [src/run/watch-loop.ts, src/commands/watch.ts, src/commands/shared.ts, src/config.ts]
key-files:
  created:
    - src/run/watch-loop.ts
    - src/run/watch-loop.test.ts
    - src/run/ingest-page.ts
    - src/run/ingest-page.test.ts
    - src/commands/watch.ts
  modified:
    - src/commands/shared.ts
    - src/config.ts
    - src/cli.ts
    - src/cli.test.ts
    - src/config.test.ts
    - src/run/run-once.ts
    - src/run/summary.ts
    - src/types/run-summary.ts
    - src/storage/replay-byte-client.test.ts
decisions:
  - "Source pacing at interval=0 is enforced by a per-loop createPacer floor (same primitive run-once uses) awaited before each cycle's discovery, PLUS requestSpacingMs threaded into discovery as requestDelayMs so within-cycle list/detail/byte requests self-pace — §A.4 resilience applied by orchestration, not a comment-only claim."
  - "Heartbeat is written atomically (temp path + POSIX rename) so the k8s exec liveness probe never observes a torn/partial file."
  - "Signal-handler cleanup is production-owned (dispose() in a finally) rather than leaning on the test harness's removeAllListeners."
metrics:
  duration: ~30m
  completed: 2026-06-16
---

# Phase 260616-vw8 Plan 01: Always-On Watch Daemon — Code-Review Fixes Summary

Fixed a MANDATORY unthrottled-request-flood bug plus four nits from the convention-bound review of the already-implemented watch daemon: applied real source pacing at `interval=0`, made the heartbeat write atomic, made signal-handler cleanup production-owned, collapsed a double `now()` read, and corrected now-false comments — all while keeping `pnpm verify` green at 100% reachable-source coverage.

## What changed

### Fix 1 (🟠 MANDATORY) — apply source spacing at interval=0 (no flood)

The watch loop previously declared `requestSpacingMs` but never applied it: `runCycle`/`buildDiscoverInput` passed no `requestDelayMs` and built no pacer, so at the default `intervalMs=0` a successful cycle had only `sleep(0)` between cycles and full-speed fetches within — a continuous full-rate request stream at the source.

**Mechanism used** (chosen to mirror run-once's `buildRunRuntime` + `pacer.awaitFloor()` discipline, §A.4):

1. Built a single `createPacer({ spacingMs: requestSpacingMs })` once per loop (so the inter-request floor PERSISTS across cycles) and `await pacer.awaitFloor()` **before each cycle's discovery** — exactly run-once's per-list-page floor applied to the watcher's per-cycle boundary. This bounds the cycle rate to ~the request-spacing rate at `interval=0`.
2. Threaded `requestDelayMs: input.requestSpacingMs` into `buildDiscoverInput` so the within-cycle list→detail (and byte) source requests inside `discoverReplays` also self-pace on the OUTER inter-request floor (never compounded with retry backoff).
3. Added an injectable `createPacer?` seam to `WatchLoopInput` (mirrors run-once's `createPacer?`) so the floor is observable in tests.

Result: at `interval=0` the cycle rate self-bounds to the request-spacing rate (no flood), still yields the event loop via `sleep(0)` (no hot-spin), and still stops promptly on a shutdown signal.

**Regression-lock test** (`src/run/watch-loop.test.ts`):
`"runWatchLoop at interval=0 applies the source request-spacing floor before EVERY cycle's discovery (no flood)"` — injects the **real** `createPacer` wired to a fake clock (`now` pinned at 0, `sleep` records its requested duration into `pacerSleepDurations`). It asserts that across 4 cycles the floor sleeps `[500, 500, 500]` (first cycle no floor, every subsequent cycle the full spacing), and that each consecutive discovery dispatch is spaced `>= requestSpacingMs`. Two supporting tests lock the `requestDelayMs` threading and the floor-before-discovery call order.

### Fix 2 (🟡) — correct now-false comments

Updated the comments in `src/run/watch-loop.ts` (`runWatchLoop` doc + inter-cycle yield) and `src/config.ts` (watch knobs) that claimed interval=0 "self-paces on the source throttle". They now describe the actually-wired mechanism (per-cycle `createPacer` floor + `requestDelayMs` threading) and no longer promise a throttle the code lacks.

### Fix 3 (🟡) — production-owned signal-handler cleanup

`createShutdownSeam` (`src/commands/watch.ts`) now returns a `dispose()` that calls `process.removeListener` for BOTH the SIGTERM and SIGINT handlers (the unfired counterpart included), and the watch action invokes `dispose()` in a `finally` after the loop resolves. Production no longer leans on the test harness's `removeAllListeners`. Locked by `"buildCli watch removes BOTH signal handlers after the loop resolves (no leaked listener)"`.

### Fix 4 (🟡) — atomic heartbeat write

Added `writeHeartbeatAtomic` in `src/commands/shared.ts`: write to a sibling `${path}.<uuid>.tmp` then `rename` (atomic on POSIX), wired as the default `writeHeartbeat` seam. The k8s exec liveness probe can no longer observe a torn/empty heartbeat and misread the daemon as wedged.

### Fix 5 (🔵) — single now() per cycle start

`runCycle` now reads `input.now()` once into `cycleStart` and derives both the run-summary `startedAt` and the runId-seed timestamp from it.

## Deviations from Plan

None beyond the review fixes themselves — no architectural changes (Rule 4) were needed; all fixes were inline bug/correctness work (Rules 1–2). The vendored `solidstats-fetcher-ts-conventions/SKILL.md` listed in the PLAN's `files_modified` was left reverted to its locked version per the task constraint (skills are read-only; the watch-runtime conventions note lives in `plans/replays-fetcher/DECISIONS.md`).

## Verification

`pnpm verify` is GREEN (exit code 0): `format:check` + `lint` + `typecheck` + `test` (495 unit tests, 39 files) + `test:integration` (testcontainers PostgreSQL + MinIO) + `test:coverage` (**100%** statements/branches/functions/lines — 1875/1875, 795/795, 362/362, 1843/1843) + `build` + `depcruise` (0 errors; the 10 pre-existing `no-commands-to-storage-direct`/`no-orphans` warnings are the documented band-split migration backlog, unrelated to this change) + `knip`.

## Self-Check: PASSED

- `src/run/watch-loop.ts` — FOUND (pacer wired, comments corrected, single now())
- `src/commands/watch.ts` — FOUND (dispose() in finally)
- `src/commands/shared.ts` — FOUND (writeHeartbeatAtomic)
- `src/config.ts` — FOUND (corrected comment)
- `src/run/watch-loop.test.ts` — FOUND (spacing-floor lock + threading + order tests)
- `src/cli.test.ts` — FOUND (no-leaked-listener test)
- Commit `0d120b4` — FOUND on `feat/watch-daemon`
