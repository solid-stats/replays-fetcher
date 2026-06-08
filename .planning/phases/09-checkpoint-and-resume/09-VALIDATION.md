---
phase: 9
slug: checkpoint-and-resume
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-09
---

# Phase 9 — Validation Strategy

> Headline risks: the S3 conditional-write/412 CAS path (integration-tested against MinIO) and corrupt-checkpoint degrade-not-abort. The `run_id` jsonb key is RESOLVED (cross-app verified against server-2 — no existing reader; fetcher sets the convention) and is proven by a real-Postgres integration test, not a manual gate.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (V8 coverage) |
| **Config file** | existing repo Vitest config; colocated `*.test.ts`; integration via `*.integration.test.ts` glob |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm run verify` |
| **Estimated runtime** | quick ~tens of seconds; `verify` several minutes (MinIO + Postgres Testcontainers + coverage + build) |

---

## Sampling Rate

- **After every task commit:** `pnpm test`
- **After every plan wave:** `pnpm run test:integration` then `pnpm run verify`
- **Before completion:** full `pnpm run verify` green
- **Max feedback latency:** ~60 s for `pnpm test`

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|--------|
| 9-01-01 | 01 | 1 | RESUME-01 | checkpoint state shape + Zod schema; identifiers-only (no bytes/secrets/HTML) | unit | `pnpm exec vitest run src/checkpoint/checkpoint.test.ts` | ⬜ pending |
| 9-01-02 | 01 | 1 | RESUME-03 | resume cursor = lastCompletedPage+1; missing/corrupt → page-1 (Zod safeParse, never abort); deterministic source-slug | unit | `pnpm exec vitest run src/checkpoint/checkpoint.test.ts` | ⬜ pending |
| 9-02-01 | 02 | 1 | RESUME-04 | `run_id` (snake_case jsonb key, scoped camelcase-disable) stamped into promotionEvidence (no schema/column change) | unit | `pnpm exec vitest run src/staging/payload.test.ts` | ⬜ pending |
| 9-02-02 | 02 | 1 | RESUME-04 | `promotion_evidence->>'run_id'` persisted via insertStaging (real Postgres, Testcontainers) | integration | `pnpm run test:integration` (`src/staging/postgres-staging-repository.integration.test.ts`) | ⬜ pending |
| 9-03-01 | 03 | 1 | RESUME-05 | status taxonomy complete/partial/failed/resumable from page outcomes | unit | `pnpm exec vitest run src/run/summary.test.ts` | ⬜ pending |
| 9-03-02 | 03 | 1 | RESUME-05 | partial/resumable → exit 2 + `--resume` next-step; complete → exit 0; summary contract additive | unit | `pnpm exec vitest run src/run/summary.test.ts src/cli.test.ts` | ⬜ pending |
| 9-04-01 | 04 | 2 | RESUME-01 | S3 checkpoint store: GetObject + conditional PutObject (sender seam) | unit | `pnpm exec vitest run src/checkpoint/s3-checkpoint-store.test.ts` | ⬜ pending |
| 9-04-02 | 04 | 2 | RESUME-02 | 412 → re-read → merge max(lastCompletedPage) → bounded retry; transient S3 err → log+continue | unit | `pnpm exec vitest run src/checkpoint/s3-checkpoint-store.test.ts` | ⬜ pending |
| 9-04-03 | 04 | 2 | RESUME-02 | conditional create (IfNoneMatch:*) + CAS (IfMatch) + real 412 against MinIO | integration | `pnpm run test:integration` | ⬜ pending |
| 9-05-01 | 05 | 3 | RESUME-01, RESUME-03 | run-once reads checkpoint at start (resume), writes after each completed page, never mid-page; complete + --resume → clean page-1 (Q2 RESOLVED) | unit | `pnpm exec vitest run src/run/run-once.test.ts` | ⬜ pending |
| 9-05-02 | 05 | 3 | RESUME-04 | run identity threaded into the `promotion_evidence.run_id` jsonb key end-to-end | unit | `pnpm exec vitest run src/run/run-once.test.ts` | ⬜ pending |
| 9-05-03 | 05 | 3 | RESUME-05 | final status + `--resume` next-step + exit code wired through CLI | unit | `pnpm exec vitest run src/cli.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- New colocated test files for `src/checkpoint/` are created within their own plans (09-01, 09-04). Integration tests mirror the existing MinIO/Postgres Testcontainers harness (the `run_id` jsonb assertion extends the existing `src/staging/postgres-staging-repository.integration.test.ts`). No framework install; no new dependencies.

---

## Manual-Only Verifications

> None. The previously-listed cross-app `run_id` key verification is RESOLVED: the orchestrator directly inspected server-2 (`src/modules/ingest/repository/repository.ts:184,699,707`, `routes.ts:83`) and confirmed server-2 has NO existing reader of any run id in `promotion_evidence` (it merges `promotionEvidence` as an opaque JsonObject). The fetcher therefore establishes the convention with the key `run_id` (per REQUIREMENTS RESUME-04 + CONTEXT), and a future server-2 correlation will read `promotion_evidence->>'run_id'`. Persistence is proven automatically by integration test 9-02-02 — no human gate required.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter
- [x] Row 9-02-02 maps to a real test (`src/staging/postgres-staging-repository.integration.test.ts` `promotion_evidence->>'run_id'` assertion)

**Approval:** approved 2026-06-09
