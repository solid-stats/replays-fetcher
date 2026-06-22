---
phase: 24
slug: watch-pre-fetch-dedup-on-conflict-staging
reviewer: gsd-code-reviewer
depth: deep
date: 2026-06-20
verdict: APPROVE
findings:
  blockers: 0
  high: 0
  medium: 0
  low: 1
  total: 1
skill_chain_read:
  - solidstats-fetcher-ts-code-review/SKILL.md
  - solidstats-shared-review-standards/SKILL.md
  - solidstats-fetcher-ts-conventions/SKILL.md
  - solidstats-shared-backend-ts-standards/SKILL.md
  - solidstats-shared-backend-ts-standards/references/correctness-and-quality.md
  - solidstats-shared-ts-standards/SKILL.md
---

# Review — Phase 24: Watch Pre-Fetch Dedup + ON CONFLICT Staging

**Verdict: APPROVE.** Deep review of the Phase-24 changed source + tests against base `HEAD~6`,
full skill chain read (all 6 files incl. `correctness-and-quality.md`).

## Ingest boundary — PASS
No parsing; PG writes stay in `ingest_staging_records` (boundary test statically asserts no
server-2 business-table mutation); source-evidence column set + `promotion_evidence` unchanged;
idempotent benign write via `ON CONFLICT (checksum, object_key) DO NOTHING`, conflicting duplicate
still raises 23505 → `classifyExistingStaging` → `conflict` (proven against real Postgres with both
unique constraints).

## Blockers 🔴 / High 🟠 / Medium 🟡
_none_

## Low 🔵
1. **`src/run/watch-loop.ts:36`** `[tests/coverage — std: shared-ts §E]` — the `/* v8 ignore next 5 */`
   on `defaultSleep` is now inaccurate: `watch-loop.test.ts:532` ("falls back to the default (real)
   sleep seam when none is injected") omits the `sleep` dep and DOES execute `defaultSleep`, so the
   line is covered. Harmless but the ignore comment contradicts the coverage-discipline rationale.
   **Deferred to Phase 26** (test-quality + correctness hygiene) — see `deferred-items.md`. Removing
   it must be paired with a `pnpm run verify` re-run to confirm the 100% gate holds without the ignore.

## Non-Findings Checked (ruled out, with evidence)
§B swallow (ON CONFLICT target is `(checksum, object_key)` only — unit + real-PG integration);
DEDUP-01 data-loss skip predicate (`prefetchDedup` AND trustworthy trimmed `externalId` AND existing
row; cannot-miss matrix exhaustive); pre-fetch SELECT key ↔ INSERT key match (both
`(sourceSystem, externalId)`); trim asymmetry (no key drift); in-page duplicate race (backstop
intact); production wiring (real `createPostgresStagingRepository` threaded through `watch.ts`,
dedup runs in daemon); Phase-20 once-guarded teardown (no regression); run-once unchanged
(byte-for-byte; golden-e2e diff empty); counter independence (`skippedBySourceId` distinct, default 0);
§AA/async safety (deliberate pre-fetch await over the limiter, allSettled, deterministic re-sort, no
floating/swallowed); SQL injection (fully parameterized).

## Validation Gaps
- Integration/golden suites read as static oracles (Testcontainers PG+MinIO); confirmed they encode
  the flipped behavior but were not executed by the reviewer (executor + verifier ran them green).
- **Human-in-the-loop production gate (NOT a code finding):** DEDUP-01 is data-loss-capable by design;
  24-CONTEXT requires human review before shipping to a production staging target. Surface at
  milestone ship — code is correct, the operational gate is external to this diff.
