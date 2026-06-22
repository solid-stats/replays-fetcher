# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 - Initial Ingest Service

**Shipped:** 2026-05-10
**Phases:** 6 | **Plans:** 23 | **Sessions:** multiple GSD phase and quick-task sessions

### What Was Built

- Strict TypeScript CLI foundation with config validation, linting, formatting, typecheck, tests, and documented AI plus GSD workflow.
- Source discovery and dry-run reporting with direct/SSH source transport, structured diagnostics, source identity, pacing, and read-only guards.
- S3-compatible raw replay storage with SHA-256 identity, deterministic `raw/sha256/<sha256>.ocap` keys, HEAD-before-PUT idempotency, and conflict evidence.
- PostgreSQL staging handoff to `server-2` through `ingest_staging_records` only, including source identity, object key, checksum, byte size, fetched time, and source-discovered evidence.
- Scheduled `run-once` orchestration, structured run summaries, failure categories, exit codes, redaction checks, and Docker-backed MinIO/PostgreSQL integration validation.

### What Worked

- Narrow service boundaries prevented parser artifacts, RabbitMQ publishing, canonical replay rows, parse jobs, identity, moderation, stats, and public API concerns from leaking into the fetcher.
- Colocated tests and strict coverage kept each vertical slice reviewable while the implementation grew from dry-run discovery to scheduled staging.
- Phase 6 closure work converted audit findings into concrete checks: real connectivity probes, discovered timestamp preservation, Docker-backed integration tests, and Nyquist validation artifacts.

### What Was Inefficient

- Some early SUMMARY.md files did not include consistent `requirements-completed` frontmatter, which made the milestone audit rely on traceability and verification tables instead of fully mechanical summary extraction.
- Node engine mismatch on the local machine produced repeated expected warnings because the project targets Node.js 25 while local verification ran under Node.js v22.
- Phase 02 validation/UAT metadata needed cleanup after the main work was complete before milestone archival could proceed cleanly.

### Patterns Established

- Fetcher identity is checksum plus external source identity, with conflicts preserved for `server-2` manual review.
- Raw replay object keys are deterministic: `raw/sha256/<sha256>.ocap`.
- Source-discovered timestamps are promotion evidence only; replay timestamp remains unset until a trusted parser/backend source owns it.
- `pnpm run verify` is the release gate and includes format, lint, typecheck, unit tests, integration tests, coverage, and build.

### Key Lessons

1. Keep cross-project ownership explicit in docs, tests, and code names whenever a local service touches shared product state.
2. Audit metadata is part of the product workflow; summary, validation, and UAT frontmatter need the same care as runtime code.
3. Fake adapters are useful for slice speed, but milestone readiness needs live-compatible integration coverage for storage and staging boundaries.

### Cost Observations

- Model mix: not measured for this milestone.
- Sessions: multiple phase execution sessions plus two quick cleanup tasks.
- Notable: The extra Phase 6 closure phase paid down audit risk without widening the fetcher beyond its accepted boundary.

---

## Milestone: v2.0 — Full-Corpus Ingest Resilience

**Shipped:** 2026-06-12
**Phases:** 6 (7-12) | **Plans:** 24

### What Was Built

A resilient full-corpus ingest run: typed `AppError` + redacting pino substrate (P7); shared transient/permanent/rate-limited failure classifier with bounded full-jitter retry (P8); S3 rolling checkpoints with conditional CAS that resume at the first incomplete page and stamp `run_id` into `promotion_evidence` (P9); runtime range discovery with `p-limit` concurrency, an AIMD throttle controller, and a paced floor (P10); per-page pino NDJSON progress events, a compact stdout summary, and an opt-in durable S3 evidence artifact (P11); deterministic source-contract guards plus a no-write `contract-check` CLI reusing the DIAG classifier (P12).

### What Worked

- Standalone P7 foundations (AppError + logger) before any feature phase meant DIAG/RESUME/PROG/GUARD all built on a stable substrate with no rework.
- A single `classifyFailure` implementation reused by retry, stop-on-empty (RANGE-06), and contract-check (GUARD-03) — verified by the integration checker as having no divergent copies.
- 100% V8 coverage + Docker integration as a hard gate kept each phase honest; the final milestone audit was cheap because every phase left mechanically-extractable VERIFICATION/SUMMARY/VALIDATION artifacts.

### What Was Inefficient

- Phase 11 was marked complete with its `pnpm run verify` deferred to CI, which silently accumulated lint/format/coverage debt in `src/run/*` + `pnpm-lock.yaml`. That debt only surfaced at v2.0 close (when full verify ran with Docker) and had to be cleared then.
- Background subagents were repeatedly mis-judged as "frozen" via an output-file-mtime watchdog and killed mid-work; in fact they were alive and spending tokens (mtime only advances on tool calls). The harness completion notification is the reliable liveness signal — corrected in global memory.

### Patterns Established

- `contract-check`-style no-write operator probes that reuse the failure classifier to separate "contract broken" (actionable, exit 2) from "transiently unreachable" (retryable signal).
- AIMD throttling over page-count windows (MD on rate-limited window, AI on clean window) that adjusts concurrency + pacing floor only, never adding backoff that compounds with `withRetry`.

### Key Lessons

1. Run the full `pnpm run verify` (Docker present) at phase close, not just unit tests — deferring it to CI hides debt that compounds and blocks milestone close.
2. Don't infer subagent liveness from output-file mtime; wait for the completion notification.
3. Surface pre-existing cross-phase debt as an explicit user decision rather than silently fixing files outside the current phase's scope.

### Cost Observations

- Model mix: Opus orchestrator + Sonnet subagents (researcher/planner/executor/verifier/reviewer/integration), Haiku plan-checker.
- Notable: salvaging frozen-looking executors mid-work (commits already on master, finish tests/lint/SUMMARY inline) avoided full re-runs.

---

## Milestone: v3.0 — Track C Toolchain Convergence (pilot)

**Shipped:** 2026-06-14
**Phases:** 6 (13-18) | **Plans:** 16

### What Was Built
Migrated the fetcher off ESLint/Prettier/tsc onto the VoidZero stack (Oxlint + Oxfmt + tsdown + Vitest) plus lefthook, all sourced from a new shared `@solid-stats/ts-toolchain` git-dep preset. Stood up the shared repo with self-validating CI and tag-pinned consumption (`#v0.1.0`→`v0.1.1`→`v0.1.2`); cleaned the repo to convention compliance (incl. splitting the 822-line `cli.ts`); swapped formatter, linter (dropping `eslint-plugin-import` for dependency-cruiser + knip), and build (`dist/cli.mjs` ESM bundle + Docker smoke); wired lefthook hooks from the preset; finalized the new `verify` surface + CI at 100% coverage. Zero `src/` business-logic change across the whole milestone.

### What Worked
- Phase ordering isolated churn: format-only commit (P15) before the linter swap (P16) before the build swap (P17) kept every diff reviewable.
- The "patch shared repo → CI green → tag → re-pin" loop (established P13/P16) made cross-repo preset fixes routine.
- The milestone audit's integration check earned its keep — it caught a real CFG-04 gap (vitest preset un-consumable) that all six phase verifications missed because no phase actually `import`ed the vitest preset until the audit reasoned about it.

### What Was Inefficient
- The vitest preset shipped raw `.ts` from P13 and nobody consumed it until the v3.0 audit, so an un-importable preset sat latent for five phases. A "first consumer actually imports each preset" check at P13 would have caught it immediately.
- Bundling `git commit && git push` in one bash call meant a pre-execution push-gate denial silently dropped the commit too; had to reconstruct. Separate commit from push when a push may be gated.
- A `git reset --hard HEAD~1` on a throwaway clone, run against an unexpected HEAD, wiped uncommitted preset edits — only recoverable because untracked files survived. Verify HEAD before destructive resets.

### Patterns Established
- Shared-preset consumption forms: `extends` (tsconfig/oxlint/lefthook), byte-mirror (oxfmt — no `extends`), `mergeConfig` import (vitest — must ship `.js`+`.d.ts`, never raw `.ts`, because Node won't strip types under `node_modules`).
- lefthook from a node_modules preset needs `allowBuilds: lefthook` (pnpm gate) + a `.lefthookrc` PATH shim for git's minimal hook PATH.

### Key Lessons
- A shared config preset is only proven once a real consumer imports every export — "it's in the repo + CI green" is not the same as "consumable."
- Shared-infra master pushes are correctly gated to the user even under carte-blanche; keep the fix prepared + tested so authorization is a one-word unblock.

### Cost Observations
- Model mix: orchestrator on Opus; GSD subagents (researcher/planner/checker/executor/verifier/integration) on their configured tiers (integration-checker on Haiku).
- Notable: the Haiku integration-checker flagged the CFG-04 gap as a "BLOCKER"; the right call was to verify its claim against the live files (it was real but mis-rooted) rather than accept or dismiss it wholesale.

---

## Milestone: v3.1 — Convention Compliance & Tech-Debt Closure

**Shipped:** 2026-06-22
**Phases:** 8 (19-26) | **Plans:** 20

### What Was Built
Five-band architecture brought into compliance and enforced inside `verify`: leaf contracts home + composition-root single-client + god-file splits + eight depcruise band-fences (no-op lock-in). Two intentional behavior changes — watch pre-fetch dedup with `ON CONFLICT DO NOTHING`, and discovery game-date capture as a filename-fallback. Closed the test-quality backlog (typed builders, RITE, `test.each`, deterministic ordering) and the live-verified correctness findings (W-02 typed `InvariantViolationError`, validated `SourceTransport`, §AA traceback).

### What Worked
- **Load-bearing build order held.** Enforcing depcruise fences LAST (P23) as a no-op lock-in meant the fences never wedged `verify` mid-milestone — the tree already satisfied them.
- **Anti-false-positive discipline paid off.** Phase 26's ~50%-false-positive audit tier shrank hard on live re-verification: CORR-01 collapsed to W-02 (a 3-site class) + one cast + one §AA site; planner/executor correctly dropped premises that didn't hold (e.g. TEST-01 "5+ inline literals"). Zero false-positive churn committed.
- **Golden e2e oracle as the behavior gate** caught what coverage alone could not across every refactor phase; stayed byte-stable except the two intentional flips (P24/P25).
- **Parallel worktree executors** (P26 wave 2: 26-02/03/04 on disjoint files) merged cleanly with no post-merge conflicts.

### What Was Inefficient
- **Doc/skill premises drifted from the repo.** P26 found `solidstats-shared-ts-standards §C` wrong for this repo (oxlint enforces `max-lines:300` on `*.test.ts`, no test override) — the executor had to split rather than rely on a non-existent disable. Skill-feedback candidate.
- **Out-of-band git activity mid-close** (a parallel `fallow` enable commit + uncommitted deps) forced a pause at milestone close to avoid entangling it with the close commit/tag.

### Patterns Established
- Typed-invariant error (`InvariantViolationError`, `isOperational:false`) for unreachable composition guards instead of raw `Error`, keeping the v8-ignore.
- `as const satisfies` + `z.enum` single-sourcing for config unions (drops blind casts).

### Key Lessons
- For a behavior-preserving compliance milestone, the golden e2e oracle + depcruise + 100% coverage + knip are sufficient integration evidence — a separate integration-checker pass is redundant.
- Re-verify every semantic-audit finding live before it becomes a commit; the category shrinks substantially and false positives never land.

### Cost Observations
- Model mix: orchestrator on Opus; GSD subagents on configured tiers (researcher/planner/executor on Opus, checker/verifier on Sonnet).
- Notable: P26 ran research → plan → check → 4 executors (1 solo + 3 parallel worktrees) → code-review → fixer → verifier; parallel wave-2 executors saved wall-clock with no merge conflicts.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | multiple | 6 | Established GSD-driven TypeScript ingest service from planning through audited archival. |
| v2.0 | multiple | 6 | Made the full-corpus run resilient (retry, checkpoint/resume, dynamic range + AIMD throttle, compact progress, contract guards); enforced full Docker `verify` at close. |
| v3.0 | autonomous | 6 | Toolchain convergence onto a shared `@solid-stats/ts-toolchain` preset (Oxlint/Oxfmt/tsdown/Vitest/lefthook); behavior-preserving, zero `src/` change; audit caught a latent un-consumable preset. |

### Cumulative Quality

| Milestone | Tests | Coverage | Integration Gate |
|-----------|-------|----------|------------------|
| v1.0 | 131 unit, 2 integration | 100% V8 | MinIO and PostgreSQL Testcontainers in `pnpm run verify` |
| v2.0 | 444 unit, 4 integration | 100% V8 | MinIO and PostgreSQL Testcontainers in `pnpm run verify` |

### Top Lessons

1. Treat adjacent app boundaries as first-class requirements before implementing storage, staging, or status behavior.
2. Keep planning metadata mechanically extractable so milestone audits stay cheap and reliable.
