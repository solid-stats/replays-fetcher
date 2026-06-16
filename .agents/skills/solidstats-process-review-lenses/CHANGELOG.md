# Changelog — solidstats-process-review-lenses

## 2026-06-16 — Initial
- Trigger wrapper for the parallel review-lens fan-out (BMAD plan P3 — see
  `plans/product/BMAD-EVALUATION-AND-GSD-IMPROVEMENTS.md` Improvement 2 / D3 and ADR
  `decisions/0007-bmad-borrowed-improvements.md`). Invoking the skill makes the top-level session run
  the bundled Workflow `workflows/review-lenses.workflow.js`.
- Bundles the Workflow inside the skill's `workflows/` subdir so it ships with `npx skills add` and
  resolves in consumer repos (a repo-root `workflows/` dir would not be installed).
- The Workflow: Discovery (scope §B + stack/reviewer detection + plan §I.1 + codebase/graph map §I.2) →
  parallel lenses (Contract Adversary / Edge / Failure Hunter / Acceptance Auditor, each running the
  matching `solidstats-<stack>-code-review` scoped to its §J mandate, structured output) → merge/dedup
  into one report under `solidstats-shared-review-standards` §D/§E.
- Direct, triggerable skill (not meta): RU + EN trigger phrases on "deep / lens / fan-out / adversarial /
  thorough" review. Must be run by the top-level session (needs the Workflow/Agent tool); a subagent
  cannot spawn the fan-out — it surfaces the §J soft-trigger recommendation instead.
- This is the (b) form of the update-safe trigger: it edits no vendored GSD file, so a `gsd-core` update
  cannot break it; plain `/gsd-code-review` still degrades to sequential lens passes.
