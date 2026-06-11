# Changelog — solidstats-process-review-standards

## 2026-06-06 — Calibration (user-confirmed)
- §C: "blocking I/O on an async path" moved from 🔴 to 🟠 (🔴 only when it stalls a hot/shared path);
  "missing important test" severity now stated as owned by §F (single source).

## 2026-06-06 — Analysis fix (see .planning/SKILLS-ANALYSIS.md)
- §E verdict: a review with only 🔵 findings now → **APPROVE** (note the optional nits), instead of
  being forced to REQUEST CHANGES — reconciles §E with §C marking 🔵 as "optional."

## 2026-06-05 — Initial
- Adapted from `estesis-process-review-standards` (stack-agnostic review foundation).
- Retargeted name, description, and body to the SolidStats reviewers:
  `solidstats-backend-ts-code-review`, `solidstats-parser-rust-code-review`,
  `solidstats-frontend-react-code-review`.
- Kept severity buckets (🔴🟠🟡🔵), continuous-numbering output format, verdict rules,
  scope discipline, the test-file rule, and the noise filter verbatim.
- Generalized the reviewer hard-gate example from the estesis Swagger spec gate to a
  typecheck/lint gate; added Clippy to the convention-reference examples; changed sample
  `file:line` paths to `.ts`.
- Dropped the spec-scale severity mapping (no spec-review skill in the v1 set).
- Review report language set to **English** (diverges from estesis, which mandates Russian) —
  matches the SolidStats "documentation is English only" standard.
