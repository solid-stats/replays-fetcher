# Phase 12: Source Contract Guards - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Regressions in source parsing — including the critical "bytes from JSON endpoint, not HTML detail page" invariant — fail a unit test or a fast operator check before they silently corrupt a full run.

**Requirements:** GUARD-01, GUARD-02, GUARD-03, GUARD-04

**Depends on:** Phase 8 (DIAG classification is reused in `contract-check` to distinguish "contract broken" from "source transiently unreachable"; the classifier must exist before this phase wires it into the new command)

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss phase was skipped per user setting. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — discuss phase skipped. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discuss phase skipped.

</deferred>
