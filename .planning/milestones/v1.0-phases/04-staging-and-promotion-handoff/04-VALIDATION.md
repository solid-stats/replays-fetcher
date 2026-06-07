---
phase: 04
slug: staging-and-promotion-handoff
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-09
---

# Phase 04 - Validation Backfill

## Evidence Sources

- `04-VERIFICATION.md` confirmed server-2-compatible staging payloads, PostgreSQL repository idempotency, CLI staging wiring, and forbidden-write guards.
- Phase 6 closure added `promotionEvidence.discoveredAt` and PostgreSQL Testcontainers validation.

## Requirement Coverage

| Requirement | Evidence | Status |
|-------------|----------|--------|
| STAGE-01, STAGE-03 | staging payload tests, PostgreSQL integration row assertions, discoveredAt promotion evidence | passed |
| STAGE-02, STAGE-04 | repository unique-violation/idempotency/conflict tests | passed |
| STAGE-05, TEST-04 | forbidden business-table mutation guards | passed |
| TEST-03 | `src/staging/postgres-staging-repository.integration.test.ts` with PostgreSQL | passed |

## Commands

- `pnpm test -- src/staging/payload.test.ts src/staging/postgres-staging-repository.test.ts`
- `pnpm run test:integration`
- `pnpm run verify`

## Nyquist Sign-Off

- [x] Staging writes target only `ingest_staging_records`.
- [x] PostgreSQL integration validates insert, idempotency, `promotion_evidence.discoveredAt`, and null `replay_timestamp`.
- [x] `server-2` retains canonical replay, parse job, RabbitMQ, and duplicate conflict ownership.
