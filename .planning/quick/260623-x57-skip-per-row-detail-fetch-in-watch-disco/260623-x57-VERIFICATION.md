---
phase: quick-260623-x57
verified: 2026-06-24T00:35:00Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase quick-260623-x57: Skip per-row detail fetch in watch discovery — Verification Report

**Phase Goal:** Skip per-row detail fetch in watch discovery for replays whose trustworthy externalId already exists in staging (move dedup gate ahead of detail fetch), surfaced via a distinct `skippedPreDetail` run-summary count. Collapse the watch cycle from ~(all page-1 rows × spacing) to ~(new replays × spacing) + one list read.
**Verified:** 2026-06-24T00:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Watch path skips detail fetch BEFORE fetching for an already-staged trustworthy externalId (no `fetchText`, no spacing slot) | ✓ VERIFIED | `discover-dedup.ts:182-233`: row loop awaits `shouldSkipPreDetail(...)` AFTER the malformed-row (no-URL) guard and BEFORE `discoverRowCandidate` (which is the only call into `fetchText`). On skip → `skippedPreDetail += 1`, `continue`-equivalent `else` branch never runs, no candidate, no diagnostic. `discover.ts` paced client increments `requestCount` only inside `fetchText` (l.55-59), so a skipped row consumes no spacing slot. |
| 2 | An absent/empty/whitespace externalId STILL fetches (cannot-miss guard preserved) | ✓ VERIFIED | `discover-dedup.ts:32-33` local `isTrustworthyId = id !== undefined && id.trim().length > 0` matches the cannot-miss guard at `ingest-page.ts:109-110` exactly, with cross-ref comment l.27-31. `shouldSkipPreDetail` (l.40-48) requires `isTrustworthyId(externalId)` true → untrustworthy id falls through to the `else` detail-fetch branch. |
| 3 | A trustworthy externalId NOT yet staged STILL fetches | ✓ VERIFIED | `shouldSkipPreDetail` (l.45-48) requires `await existsBySourceIdentity(...)` to resolve true; not-staged → false → falls through to `discoverRowCandidate` detail fetch. |
| 4 | run-once and discover --dry-run pass no predicate (byte-for-byte unchanged, no DB coupling) | ✓ VERIFIED | `grep existsBySourceIdentity src/run/run-once-page.ts src/commands/discover.ts` → empty. `discover.ts:99-104` spreads the predicate/sourceSystem only when `!== undefined`, so omitting them yields the identical `discoverPageCandidates` input shape. `run-once-page.ts:52` `buildDiscoverInput` carries no predicate; `appendDiscoveryReport` (l.41-48) hardcodes `skippedPreDetail: 0`. |
| 5 | Distinct `skippedPreDetail` count carried discovery report → run summary; never folded into discovered/failed/malformed/skippedBySourceId | ✓ VERIFIED | New field on `DiscoveryReport.counts` (`types.ts:23`), `RunSummaryCounts` (`run-summary.ts:54`, alphabetical, doc-commented as distinct). Chain: `discover.ts:108` accumulates → `buildReport` (`discover-diagnostics.ts:16`) → `buildRunSummary` reads `input.discoveryReport.counts.skippedPreDetail` (`summary.ts:431`) → `countRun` sets it as its own key (`summary.ts:198`) separate from `skippedBySourceId` (l.197), `skipped` (l.194), `duplicate` (l.190). A skipped row pushes nothing into candidates/diagnostics (`discover-dedup.ts`), so it is never counted discovered/malformed/failed. |
| 6 | Post-fetch DEDUP-01 gate in ingestPage intact (defense-in-depth) | ✓ VERIFIED | `ingest-page.ts:193-236` unchanged: `prefetchDedup === true && existsBySourceIdentity !== undefined && isTrustworthyId(externalId) && await existsBySourceIdentity(...)` → `{ skipped: true }` → `counts.skippedBySourceId += 1`. `watch-loop.ts:185-197` still calls `ingestPage` with `prefetchDedup: true` + `existsBySourceIdentity` + `sourceSystem`. Separate from the new discovery gate. |
| 7 | verify green: 100% coverage, depcruise band-fences hold (discovery imports no run/ or staging/), knip clean | ✓ VERIFIED | `pnpm run verify` exit 0: 47 files / 599 tests pass; coverage 100% (stmts 1890/1890, branches 850/850, funcs 350/350, lines 1863/1863); build OK; depcruise "no dependency violations (153 modules, 609 deps)"; knip clean (no output). Fence spot-check `grep -rn 'from "../run/\|from "../staging/' src/discovery/` → empty. |

**Score:** 7/7 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/discovery/discover-dedup.ts` | Pre-detail gate + duplicated isTrustworthyId guard + tally | ✓ VERIFIED | `shouldSkipPreDetail` helper + local `isTrustworthyId` with cross-ref comment; gated row loop; `skippedPreDetail` returned. `existsBySourceIdentity` present. |
| `src/discovery/discover-types.ts` | Optional `existsBySourceIdentity`+`sourceSystem`; `skippedPreDetail` on result | ✓ VERIFIED | `DiscoverExistsBySourceIdentity` inline type (l.15-18), optional fields on options (l.26,37), `skippedPreDetail` on `DiscoverPageCandidatesResult` (l.64) and `BuildReportOptions` (l.55). |
| `src/run/watch-loop.ts` | buildDiscoverInput threads predicate+sourceSystem; reads report skippedPreDetail | ✓ VERIFIED | `buildDiscoverInput` (l.134-155) sets `existsBySourceIdentity` + `sourceSystem: defaultSourceSystem` on both branches. `existsBySourceIdentity` present. skippedPreDetail flows via report → `buildRunSummary`. |
| `src/types/run-summary.ts` | Distinct skippedPreDetail on RunSummaryCounts | ✓ VERIFIED | Field at l.54, alphabetically placed, documented distinct. `skippedPreDetail` present. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| watch-loop.ts | discover.ts (discoverReplays) | buildDiscoverInput passes predicate+sourceSystem (watch only) | ✓ WIRED | `watch-loop.ts:136,141,148,153` → consumed by `discover.ts:99-104`. |
| discover.ts | discover-dedup.ts | discoverReplaysDryRun threads predicate+sourceSystem into discoverPageCandidates | ✓ WIRED | `discover.ts:92-105` conditional spread; `discover-dedup.ts:164,170` input fields. |
| discover-dedup.ts | watch-loop.ts | DiscoveryReport.counts.skippedPreDetail → run summary | ✓ WIRED | `discover-dedup.ts:240` → `discover.ts:108` accumulate → `buildReport` → `summary.ts:431` read into compact summary in `watch-loop.ts:199-208`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Full unit suite incl. discovery/summary/watch-loop/ingest-page | `pnpm run verify` | 599/599 pass, 100% coverage | ✓ PASS |
| Discovery band has no upward import | `grep -rn 'from "../run/\|from "../staging/' src/discovery/` | empty (exit 1) | ✓ PASS |
| run-once/discover never set the predicate | `grep existsBySourceIdentity src/run/run-once-page.ts src/commands/discover.ts` | empty | ✓ PASS |
| depcruise band-fences | `dependency-cruiser` (within verify) | no violations, 153 modules | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| PERF-X57-01 | 260623-x57-PLAN | Move dedup gate ahead of per-row detail fetch in watch discovery; distinct skippedPreDetail count | ✓ SATISFIED | Truths 1-7 above. |

### Anti-Patterns Found

None. No `TODO`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER` markers, no empty-return stubs, no hardcoded-empty data paths in the modified files. The `skippedPreDetail: 0` literals on the fixture/run-once paths are correct totals (those paths never skip pre-detail), not stubs. Inline `/* v8 ignore */` comments in `discover.ts:25` and `watch-loop.ts:36` are pre-existing, reason-tagged, and cover only injected-timer defaults (per the coverage-suppression policy).

### Gaps Summary

None. Every must-have is verified against the real source. The optimization is correctly watch-only (predicate injected, never imported — fences 1+6 hold), the cannot-miss guard is replicated exactly with a cross-ref comment, run-once/discover are untouched, the post-fetch DEDUP-01 gate is intact as a second line of defense, and the distinct `skippedPreDetail` count flows cleanly discovery → report → run summary without being folded into any other bucket. `pnpm run verify` is green at 100% coverage with band-fences and knip clean.

Note: the Docker integration suite (golden-watch / golden run-once oracles) was not run (no Docker in this worktree). run-once's discovery path is unchanged by construction (no predicate), so its golden oracle is unaffected; the golden-watch oracle would further confirm the watch path produces the same staged set faster, but the unit suite already exercises the pacing/skip/cannot-miss behavior deterministically. This does not block the goal.

---

_Verified: 2026-06-24T00:35:00Z_
_Verifier: Claude (gsd-verifier)_
