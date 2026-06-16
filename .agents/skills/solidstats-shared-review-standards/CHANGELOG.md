# Changelog — solidstats-shared-review-standards

## 2026-06-16 — Discovery step + review lenses
- §I **Discovery — locate the plan, map the change** (new). Conditional GSD-sync pass adapted from
  `estesis-frontend-react-vc-code-review` (`references/gsd-sync.md`): I.1 self-discovery of the
  planning context (branch slug → handoff/state → file overlap, ambiguity rule = exactly one or ASK);
  I.2 **map the change onto the codebase** — the structural `.planning/codebase/` map (STRUCTURE/
  ARCHITECTURE/INTEGRATIONS/CONVENTIONS/CONCERNS/STACK/TESTING) as a first-class source, plus the
  knowledge-graph blast-radius map (review half of GSD-IMPROVEMENTS C6 — `/gsd-graphify query` /
  `GRAPH_COMMUNITIES.md`, fallback to intel/grep, else a Validation Gap); I.3 code-vs-PLAN contract
  check (`files_modified`/`must_haves`/`<success_criteria>`/`requirements` + SUMMARY / REVIEW+REVIEW-FIX
  / VERIFICATION claim reconciliation, severity-by-drift table) with neutral direction-of-truth,
  semantic-truths → Validation Gaps, read-only on `.planning/`, `[gsd-plan]`/`[gsd-claim]` tags.
- §J **Review lenses** (new). Implements Improvement 2 from
  `plans/product/BMAD-EVALUATION-AND-GSD-IMPROVEMENTS.md` (decision D3): the three named adversarial
  lenses (Contract Adversary / Edge / Failure Hunter / Acceptance Auditor), the one-format invariant
  ("many lenses, one report"), the adversarial-mandate-as-Non-Findings-Checked rule, the explicit
  rejection of the "zero findings → halt / forced finding" rule (it fights §G), and the depth-tied
  fan-out (single pass for quick; parallel-subagent lenses for deep, run at the invocation layer via the
  `solidstats-process-review-lenses` skill — never in the vendored GSD review commands). Includes a
  **durability-across-GSD-updates** note: lenses degrade to sequential passes and never depend on the
  fan-out; the fan-out is never wired by editing vendored gsd-core (re-vendored on update) — it is
  driven from the invocation layer (the session/Workflow that can spawn agents) or an upstream change
  (GSD's `config.json` `hooks` are feature toggles, not a script extension point). Adds the **soft
  trigger**: a single-pass deep review ends its report with a one-line recommendation (quoting the
  `Workflow(...)` invocation) so the fan-out reaches a spawn-capable session/human without coupling to
  any vendored GSD file; lens subagents inside the fan-out suppress it to avoid a loop. Reference
  implementation + trigger wrapper: the `solidstats-process-review-lenses` skill (bundled
  `workflows/review-lenses.workflow.js`).
- Additive only — §A–§H unchanged, so the reviewers' `§C`/`§D`/`§E`/`§F` cross-references still hold.
- Provenance: ADR `decisions/0007-bmad-borrowed-improvements.md`.

## 2026-06-06 — Calibration (user-confirmed)
- §C: "blocking I/O on an async path" moved from 🔴 to 🟠 (🔴 only when it stalls a hot/shared path);
  "missing important test" severity now stated as owned by §F (single source).

## 2026-06-06 — Analysis fix (see .planning/SKILLS-ANALYSIS.md)
- §E verdict: a review with only 🔵 findings now → **APPROVE** (note the optional nits), instead of
  being forced to REQUEST CHANGES — reconciles §E with §C marking 🔵 as "optional."

## 2026-06-05 — Initial
- Adapted from `estesis-process-review-standards` (stack-agnostic review foundation).
- Retargeted name, description, and body to the SolidStats reviewers:
  `solidstats-server-ts-code-review`, `solidstats-parser-rust-code-review`,
  `solidstats-frontend-react-code-review`.
- Kept severity buckets (🔴🟠🟡🔵), continuous-numbering output format, verdict rules,
  scope discipline, the test-file rule, and the noise filter verbatim.
- Generalized the reviewer hard-gate example from the estesis Swagger spec gate to a
  typecheck/lint gate; added Clippy to the convention-reference examples; changed sample
  `file:line` paths to `.ts`.
- Dropped the spec-scale severity mapping (no spec-review skill in the v1 set).
- Review report language set to **English** (diverges from estesis, which mandates Russian) —
  matches the SolidStats "documentation is English only" standard.
