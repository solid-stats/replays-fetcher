---
phase: 22-god-file-decomposition
plan: 02
subsystem: discovery
tags: [refactor, god-file-decomposition, split, discovery]
requires: []
provides:
  - "src/discovery/discover-candidate.ts (fixture/html candidate builders + toRawReplayUrl)"
  - "src/discovery/discover-dedup.ts (page-assembly + dedup/registry aggregation)"
  - "src/discovery/discover-diagnostics.ts (report builder + source-failure diagnostic + evidence helpers)"
  - "src/discovery/discover-types.ts (cross-sibling option/contract types)"
affects:
  - "src/discovery/discover.ts (now the discoverReplaysDryRun entry + paced-source-client wiring)"
tech-stack:
  added: []
  patterns:
    - "within-band split: all siblings live in src/discovery/, dependencies point downward only"
key-files:
  created:
    - src/discovery/discover-candidate.ts
    - src/discovery/discover-dedup.ts
    - src/discovery/discover-diagnostics.ts
    - src/discovery/discover-types.ts
  modified:
    - src/discovery/discover.ts
decisions:
  - "Lifted shared option/contract types (DiscoverReplaysDryRunOptions, ReadOptions, BuildReportOptions, DiscoverPageCandidatesResult) into a leaf discover-types.ts so no sibling imports them upward from the parent — keeps no-circular green"
  - "Reframed the candidate/dedup boundary so discover-candidate.ts holds pure builders and discover-dedup.ts holds the page-assembly + dedup aggregators (discoverPageCandidates, collectFixtureCandidates, collectCandidateDiagnostics); dedup imports builders from candidate one-directionally, avoiding a cycle and landing both files <300"
  - "Defined toRawReplayUrl in discover-candidate.ts (its only internal user is discoverRowCandidate) and re-exported it from discover.js, preserving the public import site so no caller (contract-check.ts, commands/shared.ts) is edited"
metrics:
  duration: ~12m
  completed: 2026-06-20
status: complete
---

# Phase 22 Plan 02: SPLIT-02 — decompose src/discovery/discover.ts Summary

Split the 701-line `src/discovery/discover.ts` into the parent plus four cohesive same-band siblings in `src/discovery/`, removed the `oxlint-disable max-lines` suppression, and dropped every file under the 300-line threshold — a pure structural move with zero logic, identifier, or signature change.

## What changed

Two atomic extractions, each gated on `pnpm run verify` exit 0:

1. **Task 1 (389f329)** — moved the diagnostics/report cluster into `discover-diagnostics.ts` (`buildReport`, `buildSourceFailureDiagnostic`, `buildReadOptions`, `diagnosticEvidence`, `withOptionalDiagnosticEvidence`, and the source-failure attach helpers). Lifted the shared option/contract types into `discover-types.ts` to keep `no-circular` green. Suppression retained — the parent was still >300 at this point.
2. **Task 2 (c462c26)** — moved the candidate builders into `discover-candidate.ts` and the page-assembly + dedup aggregation into `discover-dedup.ts`. The parent retains `discoverReplaysDryRun` + the paced-source-client wiring and re-exports `toRawReplayUrl`. Removed the suppression once the parent (111) and every sibling were confirmed <300 — the final extraction.

## Final line counts

| File | Lines |
|------|-------|
| src/discovery/discover.ts | 111 |
| src/discovery/discover-candidate.ts | 211 |
| src/discovery/discover-dedup.ts | 190 |
| src/discovery/discover-diagnostics.ts | 199 |
| src/discovery/discover-types.ts | 36 |

## Verification

- `pnpm run verify` exits 0 after **each** extraction commit (format, lint, typecheck, 502 tests, 100% V8 coverage on all four axes, build, depcruise, knip).
- `grep -c 'oxlint-disable max-lines' src/discovery/discover.ts` = 0.
- Every `src/discovery/discover*.ts` file is <300 lines.
- `no-circular` green; the only depcruise warnings (9) are pre-existing `src/commands/*` warnings unrelated to this split — 0 errors.
- `SourceFetchError` still imported from `./source-client.js` (the parent re-export path) — no overlap with SPLIT-03.
- `discoverReplaysDryRun` and `toRawReplayUrl` still export from `discover.js`; no caller edited (`commands/shared.ts` unchanged at 296, `contract-check.ts` untouched).
- `test:integration` (golden run-once oracle) intentionally NOT run here — the orchestrator runs it on the merged tree per the parallel-split protocol.

## Deviations from Plan

None of substance. One planner-discretion adjustment within the latitude the plan granted:

**[Planner-discretion] Candidate/dedup boundary reframed to satisfy the <300 gate without a cycle.**
- **Context:** `discover-candidate.ts` landed at 304 with the candidate cluster intact — over the 300 threshold. The plan explicitly anticipated this ("If `discover-candidate.ts` is 300 or more, relocate the dedup/registry helpers into a 3rd sibling `discover-dedup.ts`").
- **Resolution:** Rather than relocate only `collectCandidateDiagnostics`/`hasChangedMetadata` (which would have created a candidate↔dedup import cycle through `discoverPageCandidates`), I moved the page-assembly aggregators (`discoverPageCandidates`, `collectFixtureCandidates`) into `discover-dedup.ts` alongside the dedup helpers. `discover-dedup.ts` imports the pure builders (`toReplayCandidate`, `discoverRowCandidate`) from `discover-candidate.ts` one-directionally; candidate imports nothing from dedup. This keeps `no-circular` green and lands candidate at 211 and dedup at 190.
- **Also:** Added `discover-types.ts` as a leaf types module — the plan authorized this ("lift that shared options type into a small same-band discover-types.ts if it creates a circular boundary; planner discretion, keep no-circular green").

## Known Stubs

None.

## Threat Flags

None — pure compile-time-only move of pure helpers; no new trust boundary, input, auth, secret, schema, or external surface (T-22-02-NOOP, accepted).

## Self-Check: PASSED
