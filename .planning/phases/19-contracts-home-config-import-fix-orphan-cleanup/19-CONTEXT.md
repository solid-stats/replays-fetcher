# Phase 19: Contracts Home + Config Import Fix + Orphan Cleanup - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss; autonomous run)

<domain>
## Phase Boundary

Cross-band data contracts live in one leaf module at the bottom of the dependency graph,
no band imports a type upward, and the orphan module is gone — a pure type-move with zero
runtime change.

Requirements: ARCH-01, ARCH-02, ARCH-03.

Success Criteria (what must be TRUE):
1. `ReplayCandidate`, `RawReplayStorageEvidence`, `RunSummary`/`CompactRunSummary`, and
   `IngestStagingPayload` are all defined in a single cross-cutting contracts module that
   imports nothing upward; builders stay in their owning bands (only the types moved).
2. `config.ts` no longer imports `SourceTransport` from `discovery/`; `config.ts` depends on
   nothing upward.
3. `no-leak.ts` is resolved (wired or removed) and `pnpm run knip` reports zero orphan modules.
4. The Docker golden run-once oracle and 100% V8 coverage stay green — no runtime behavior changed.
</domain>

<decisions>
## Implementation Decisions

### Resolved pre-plan decision (autonomous)
- **Contracts home naming → `src/types/`** (NOT `contracts/`). Already settled and committed
  upstream (`51666b4 docs: resolve v3.1 contracts-home naming -> src/types/ (ARCH-01)`); the
  `src/types/` directory already exists in the tree. The depcruise preset + conventions skill
  encode `src/types/` as the leaf contracts band. No re-litigation.

### Claude's Discretion
Remaining implementation choices are at Claude's discretion — discuss skipped per
workflow.skip_discuss. Guided by the ROADMAP phase goal, success criteria, the
solidstats-fetcher-ts-conventions five-band architecture, and the behavior-preservation gate.

- `no-leak.ts` orphan: prefer **removal** if it is genuinely unreferenced dead code (knip
  orphan); only wire it if the plan research shows it was meant to be on a live path. Decide
  during plan-phase from live evidence (file:line + knip output), not assumption.
- Type moves are mechanical and reviewable as pure moves; builders/factories stay in their
  owning bands — only `type`/DTO declarations relocate to `src/types/`.
</decisions>

<code_context>
## Existing Code Insights

Codebase map is current (`.planning/codebase/` refreshed today for v3.1). `src/types/` already
exists. Plan-phase research will pin the exact current locations of the four DTOs, the
`config.ts → discovery/` upward import, and the `no-leak.ts` orphan via grep/knip against the
live tree.
</code_context>

<specifics>
## Specific Ideas

- Pure type-move: zero runtime change. Behavior-preservation gate = golden run-once oracle
  (`src/run/golden-e2e.integration.test.ts`) + 100% V8 coverage + depcruise + knip, all green.
- This is the prerequisite for every later v3.1 phase — it removes the only currently-existing
  upward import, so the leaf contracts band must be correct before Phase 21's bulk
  `interface→type` conversion (which must create no new upward imports).
</specifics>

<deferred>
## Deferred Ideas

None — discuss skipped.
</deferred>
