# Phase 24 — Deferred Items (route into Phase 26)

## D-24-01 — stale `v8 ignore` on `watch-loop.ts` defaultSleep (🔵 from 24-REVIEW)
`src/run/watch-loop.ts:36` carries `/* v8 ignore next 5 */` on `defaultSleep`, but
`watch-loop.test.ts:532` now executes that seam (it omits the injected `sleep`). The ignore is
inaccurate. **Fix in Phase 26 (test-quality):** remove the ignore comment (or correct its rationale)
and re-run `pnpm run verify` to confirm the 100% coverage gate still holds without it. Pair with the
broader Phase-26 "no v8-ignore on reachable branches" sweep.

## Ship gate (NOT deferred dev work — milestone-ship checklist)
DEDUP-01 is data-loss-capable. 24-VERIFICATION status is `human_needed` for exactly this:
human-in-the-loop review of the pre-fetch skip predicate is REQUIRED before this ships to a
production staging target. This is a deploy-time gate, carried to the milestone ship checklist —
not a code defect and not Phase-26 work.
