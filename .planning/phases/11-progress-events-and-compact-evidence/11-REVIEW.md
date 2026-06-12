---
phase: 11-progress-events-and-compact-evidence
status: clean
reviewer: solidstats-backend-ts-code-review
date: 2026-06-12
verdict: APPROVE
---

# Review — Phase 11 (progress-events-and-compact-evidence)

**Scope:** diff `884860f..HEAD` — `src/source/retry.ts`, `src/run/{types,summary,run-once,no-leak}.ts`, `src/cli.ts` (+ their tests), `docs/integration-contract.md`, `README.md`, `.env.example`. Read in full.
**Gates:** typecheck ✅ · eslint (changed files) ✅ · `pnpm test` 418/418 ✅ · build ✅ · `test:integration` + `test:coverage` not run (Docker unavailable — deferred to CI).
**Method:** Produced via `solidstats-backend-ts-code-review` (ruleset: `solidstats-backend-ts-conventions`; format: `solidstats-process-review-standards`). Supersedes an earlier inline-written review.

## API contract
N/A (CLI) — `replays-fetcher` exposes no public HTTP API; Phase-1 contract gate does not apply.

## Blockers 🔴
_none_

## High 🟠
_none_

## Medium 🟡
_none_

## Low 🔵
1. `src/run/run-once.ts:323` [dry] — `candidatesPerMinute` is derived inline in `emitPageRateLine` (first/last timestamp, `MS_PER_MINUTE`, `Number.EPSILON` floor) while `pagesPerMinute` reuses the shared `derivePagesPerMinute` helper. The window math is duplicated rather than factored into a sibling `deriveCandidatesPerMinute(timestamps, discovered)`. Behavior is correct and bounded; extracting it would keep the single-rate-source intent (D-05) symmetric. Optional. `[conv: correctness-and-quality → DRY / rule of three]`

## Non-Findings Checked
- **Secret/body leakage across the three new surfaces** — events, compact stdout, evidence body all carry identifiers only; messages are static (no source/server data interpolated), `slug` is userinfo-stripped via `sanitizeSourceUrl`, and `toCompactSummary` is a strict allowlist that cannot widen to candidate/raw/staging bodies. Enforced by `no-leak.test.ts`. Correct, not a finding.
- **Evidence write never affects the run** — `writeEvidence` gates each path independently (`emitEvidence === true && evidenceStore !== undefined`; `evidenceFile !== undefined && writeEvidenceFile !== undefined`), wraps each in try/catch, logs `event:"evidence_write_failed"` at warn, and returns — exit code is untouched (PROG-03 log-and-continue, mirrors `writeFinalCheckpoint`). Correct.
- **exactOptionalPropertyTypes safety** — `toCompactSummary` and `CompactRunSummary` omit absent optionals via additive conditional spread rather than assigning `undefined`. Correct (D-07).
- **Optional-logger discipline** — all emission sites use `input.log?.info?.(...)`/`?.warn?.`/`?.error?.`, so run-once stays usable without an injected logger. Correct.
- **`src/run/no-leak.ts`** — a deliberate, documented source companion (exports the `NoLeakSurface` type, no production behavior) added solely so the existing colocation meta-test stays green; recorded in 11-05-SUMMARY. Information, not a finding.

## Validation Gaps
- `pnpm run verify`'s integration (testcontainers/MinIO) and 100% V8 coverage stages could not run locally (no Docker); they must run in CI before milestone close. No Phase-11 file showed an uncovered branch in the targeted unit runs, but the 100% gate itself is unverified here.

## Verdict
**APPROVE** — one optional 🔵 (finding 1); no mandatory changes. The phase-11 diff is additive, identifiers-only, convention-compliant, and gate-green on every locally runnable check.
