---
name: solidstats-process-review-lenses
description: >
  Run a SolidStats deep code review as three parallel adversarial lenses — Contract Adversary,
  Edge / Failure Hunter, Acceptance Auditor (solidstats-shared-review-standards §J) — fanned out as
  subagents and merged into one report. This is the trigger wrapper for the bundled review-lenses
  Workflow (BMAD plan P3); invoking this skill makes the session run that Workflow. Use it whenever a
  developer asks for a deep / thorough / multi-pass / fan-out / lens-based review, or wants a risky
  phase/PR reviewed from several adversarial angles at once — even if they don't say "lenses." For a
  trivial one-line change a single pass is enough; this skill is for milestone / risky / contract-touching
  changes. Must be invoked by the top-level session (it needs the Workflow/Agent tool — a subagent cannot run it).
  Triggers: "deep review", "review with lenses", "fan-out review", "adversarial review", "multi-pass
  review", "thorough code review", "review from several angles", "глубокое ревью", "ревью с линзами",
  "ревью с фан-аутом", "состязательное ревью", "тщательное ревью", "ревью с нескольких сторон",
  "разбери код с разных углов".
---

# SolidStats Review Lenses — deep fan-out review

This skill runs a **deep code review as the three review lenses in parallel** and merges them into one
report. It is the trigger wrapper around the bundled Workflow
[`workflows/review-lenses.workflow.js`](workflows/review-lenses.workflow.js) — the update-safe,
invocation-layer implementation of the fan-out described in
[`solidstats-shared-review-standards`](../solidstats-shared-review-standards/SKILL.md) §J (and the soft
trigger a single-pass review recommends).

**Why a wrapper.** Only the top-level session holds the `Workflow` / `Agent` tool; a subagent (including
GSD's `gsd-code-reviewer`) cannot spawn the fan-out. So this skill exists to be read by the session,
which then runs the Workflow. It edits no GSD file, so a `gsd-core` update can't break it.

## When to use

- A milestone / risky / contract-touching change you want reviewed from several adversarial angles at
  once (the lenses each attack one way, deeply, and catch each other's blind spots).
- A `code_review_depth: "deep"` phase review.

Skip it for a trivial one-line change — a single pass (the normal reviewer skill) already runs the three
lenses sequentially per §J. This wrapper buys *parallelism*, at ≈3× tokens for ≈1× wall-clock; it does
not change the findings the lenses produce.

## How to run it

1. **Confirm you are the top-level session** with the `Workflow` tool. If you are a subagent without it,
   you cannot run this — surface the recommendation (the §J line) and stop.
2. **Run from the repo being reviewed** (`server-2` / `replays-fetcher` / `replay-parser-2` / `web`) so
   `git diff` and the installed skills resolve there.
3. **Invoke the bundled Workflow.** `scriptPath` is this skill's own copy:

   ```
   Workflow({
     scriptPath: '<this-skill-dir>/workflows/review-lenses.workflow.js',
     args: { base: '<diff base, e.g. master>', stack: '<server|fetcher|parser|frontend>' },
   })
   ```

   All `args` are optional — omit them and the Workflow's Discovery stage auto-detects the diff base and
   the stack. Pass `base`/`stack` when you already know them to skip that inference; pass `repo` (absolute
   path) to review a repo other than the session cwd, and `head` to review the range `base...head`.
4. **Surface the merged report.** The Workflow returns `{ discovery, lensResults, report }`; present
   `report` — it is already in the `solidstats-shared-review-standards` §D format (continuous numbering,
   one §E verdict, deduped across lenses). The per-lens `lensResults` are the raw inputs if the developer
   wants to see which lens raised what.

## What the Workflow does (so you can explain it)

`Discovery` (once) → resolve scope §B, detect stack + reviewer skill, locate the plan §I.1, map the
change onto `.planning/codebase/` + the knowledge graph for the blast radius §I.2. `Lenses` (parallel) →
one subagent per §J lens, each running the matching `solidstats-<stack>-code-review` skill scoped to that
lens, returning structured findings + a Non-Findings-Checked audit trail. `Merge` → dedup overlapping
findings (keep the highest severity, tag which lenses found each), renumber continuously, union the
Non-Findings-Checked, emit one report with one verdict. Full detail is in the script header.

The lens subagents inside the Workflow are told **not** to re-recommend the fan-out (they are already in
it) — that recommendation is only for a single-pass deep review.
