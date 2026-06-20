# Phase 22: God-File Decomposition - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss; autonomous run)

<domain>
## Phase Boundary

The four files carrying `oxlint-disable max-lines` are split into cohesive modules strictly
within their own bands, and the suppressions are removed for good — a pure structural refactor
with no behavior change.

Requirements: SPLIT-01, SPLIT-02, SPLIT-03, SPLIT-04.

Success Criteria (what must be TRUE):
1. `src/run/run-once.ts`, `src/discovery/discover.ts`, `src/discovery/source-client.ts`, and
   `src/storage/replay-byte-client.ts` are each split WITHIN their band; no split crosses a band
   or lands in a shared `adapters/` dir.
2. All four `oxlint-disable max-lines` suppressions are removed and never re-added.
3. `pnpm run verify` (incl. depcruise + knip) is green after EACH extraction, not only at phase
   end; commits read as pure moves.
4. The Docker golden run-once oracle and 100% V8 coverage stay green after every extraction — a
   dropped branch is caught by the oracle, not just by coverage.
</domain>

<decisions>
## Implementation Decisions

### Resolved (autonomous) — parallelization
- The user enabled `parallel`. The four splits are in three bands and (likely) file-disjoint:
  `run-once.ts` (run band), `discover.ts` + `source-client.ts` (discovery band),
  `replay-byte-client.ts` (storage band). Where the planner places file-disjoint splits in the
  same wave, run their executors CONCURRENTLY in isolated worktrees (merge back per executor).
  CAUTION: `discover.ts` and `source-client.ts` share the `discovery/` band and may share imports
  (`discovery/types.ts`) — if their `files_modified` overlap, they MUST run sequentially (the
  intra-wave overlap rule forces this). The planner decides the wave/overlap structure.

### Claude's Discretion (per roadmap)
- max-lines threshold is 300 (oxlint base preset `"max-lines": "error"`; the four files glue it
  off with inline `oxlint-disable max-lines`). Each split must bring the parent file AND every new
  sibling UNDER 300 with the suppression removed.
- Splits extract COHESIVE internal helper groups into sibling modules in the SAME band dir (e.g.
  `discovery/source-client.ts` → `discovery/source-client-*.ts`). Public exports stay where callers
  import them (or re-export to avoid churn). No split lands in a shared `adapters/` dir or crosses
  a band — that would pre-violate the Phase 23 fences.
- Pure structural moves: no logic/identifier/signature change. The behavior oracle is the golden
  run-once oracle, NOT just coverage — run `verify` + the relevant oracle after EACH extraction.

### Pre-pinned evidence (2026-06-20)
- run-once.ts 1043L (3 exports), discover.ts 701L (2), source-client.ts 534L (2),
  replay-byte-client.ts 489L (4) — all carry exactly one `oxlint-disable max-lines`.
- `src/commands/shared.ts` is at 296/300 (Phase 20 carry-forward) — NOT a target, but zero
  headroom; do not let any Phase 22 move push it over.
</decisions>

<code_context>
## Existing Code Insights

Codebase map current. Phases 19–21 settled contracts (`src/types/`), client injection, and the
interface→type + import-order conventions, so the god-files are now smaller/cleaner than before
the milestone — the splits land on a stable tree. depcruise band-fences are NOT yet enforced
(Phase 23) — Phase 22 must keep every split within-band by discipline so Phase 23's lock-in is a
no-op. Research must map each god-file's internal structure (cohesive helper clusters) and import
graph before the planner designs the extraction boundaries.
</code_context>

<specifics>
## Specific Ideas

- Highest-risk file: `run-once.ts` (1043L) — the orchestration core; a dropped branch here is the
  classic "coverage stays 100% but the oracle catches it" case. Split it most carefully.
- `verify` green AFTER EACH extraction (per-extraction, not once at end) — this is the explicit
  roadmap gate. Each extraction is its own commit reading as a pure move.
- Removing the suppression is part of each split's acceptance — the file must be < 300 AND the
  `oxlint-disable max-lines` line gone.
</specifics>

<deferred>
## Deferred Ideas

None — discuss skipped.
</deferred>
