# Roadmap: replays-fetcher

## Overview

This roadmap builds `replays-fetcher` as a narrow TypeScript scheduled ingest service. It starts with repository and contract foundation, then proves source discovery in dry-run mode, adds S3 raw object storage, adds staging/outbox integration for `server-2`, and finally hardens scheduled operation and tests.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work.
- Decimal phases (2.1, 2.2): Urgent insertions if needed.

- [x] **Phase 1: Project Foundation and Integration Contract** - Establish TypeScript workspace, config validation, docs, and explicit cross-app boundaries.
- [x] **Phase 2: Source Discovery and Dry Run** - Discover replay candidates from the external source without mutating S3 or staging state.
- [x] **Phase 3: Raw Replay Storage** - Fetch replay bytes, compute checksums, and write idempotent S3 raw objects.
- [ ] **Phase 4: Staging and Promotion Handoff** - Write staging/outbox records compatible with `server-2` promotion and conflict handling.
- [ ] **Phase 5: Scheduled Operations and Validation** - Add run-once scheduling behavior, observability, failure taxonomy, and integration tests.

## Phase Details

### Phase 1: Project Foundation and Integration Contract

**Goal:** Developers have a strict TypeScript project foundation and documented ingest/backend/parser ownership contract.
**Mode:** mvp

**Depends on:** Nothing.

**Requirements:** DOC-01, DOC-02, DOC-03, DOC-04, INT-01, INT-02, INT-03, INT-04, RUN-01, RUN-04, RUN-05

**Success Criteria:**
1. Repository has a current README, AGENTS instructions, GSD planning docs, and clean AI+GSD workflow guidance.
2. `.planning/config.json` matches `replay-parser-2` exactly, and docs state that the two configs must stay synchronized.
3. TypeScript project skeleton exists with strict compiler settings, lint/format/test commands, and no source-specific assumptions yet.
4. Config validation fails fast for missing source, S3, and staging database settings.
5. Integration contract docs state that fetcher writes S3 raw objects and staging/outbox rows only.
6. Adjacent app notes identify required `server-2` staging promotion responsibilities and forbidden direct business-table writes.

**Plans:** 1/1 complete

### Phase 2: Source Discovery and Dry Run

**Goal:** Operators can inspect replay candidates from the external source without mutating storage or database state.
**Mode:** mvp

**Depends on:** Phase 1

**Requirements:** RUN-03, SRC-01, SRC-02, SRC-03, SRC-04, SRC-05, TEST-05

**Success Criteria:**
1. Fetcher can read the configured external replay source and produce normalized replay candidates with source URL and external ID when available.
2. Dry-run mode prints or writes a structured candidate report without writing S3 or staging records.
3. Repeated dry-run discovery over the same fixture/source yields stable candidate identity.
4. Missing, malformed, duplicate, and changed source metadata produce structured diagnostics.
5. Source adapter behavior is covered by fixtures or mocked responses.

**Plans:** 4/4 complete

### Phase 3: Raw Replay Storage

**Goal:** Fetcher can store raw replay files in S3-compatible storage with checksum-backed idempotency.
**Mode:** mvp

**Depends on:** Phase 2

**Requirements:** STOR-01, STOR-02, STOR-03, STOR-04, STOR-05, TEST-02

**Success Criteria:**
1. Fetcher downloads replay bytes for discovered candidates and writes them under the `raw/` prefix.
2. Every stored replay has SHA-256 checksum, byte size, object key, and fetch timestamp evidence.
3. Object writes are idempotent for repeated runs over the same replay bytes.
4. Storage failures are structured and do not create promoted business state.
5. S3-compatible storage behavior is tested with local or mocked storage.

**Plans:** 4/4 complete

Plans:
- [x] 03-01-PLAN.md — Define checksum, object-key, and raw storage evidence contracts.
- [x] 03-02-PLAN.md — Implement fake-tested S3-compatible idempotent raw object adapter.
- [x] 03-03-PLAN.md — Fetch replay bytes and orchestrate candidate-to-storage evidence.
- [x] 03-04-PLAN.md — Expose raw storage through CLI, docs, and boundary guards.

### Phase 4: Staging and Promotion Handoff

**Goal:** `server-2` can poll fetcher staging rows and safely promote new raw replay objects into replay and parse-job lifecycle.
**Mode:** mvp

**Depends on:** Phase 3

**Requirements:** STAGE-01, STAGE-02, STAGE-03, STAGE-04, STAGE-05, TEST-03, TEST-04

**Success Criteria:**
1. Fetcher writes staging/outbox records with source identity, source URL, object key, checksum, byte size, discovered/fetched timestamps, and status evidence.
2. Staging writes are idempotent for checksum plus source identity.
3. Fetcher preserves ambiguous duplicate evidence for `server-2` manual review instead of auto-merging.
4. Tests prove fetcher does not write forbidden `server-2` business tables.
5. Cross-app contract notes define what `server-2` must poll/promote before parse jobs are created.

**Plans:** TBD

### Phase 5: Scheduled Operations and Validation

**Goal:** Operators can run the fetcher as a scheduled v1 ingest job with clear run summaries, diagnostics, and test coverage.
**Mode:** mvp

**Depends on:** Phase 4

**Requirements:** RUN-02, OPS-01, OPS-02, OPS-03, OPS-04, TEST-01

**Success Criteria:**
1. `run-once` executes one full discovery -> fetch -> S3 -> staging cycle and exits with meaningful status.
2. Every run emits structured counts for discovered, fetched, skipped, staged, duplicate, conflict, and failed items.
3. Logs include run ID, source identity, checksum/object key where available, and failure category without secrets.
4. Failures distinguish source unavailable, fetch failed, checksum/storage failed, staging failed, and config invalid.
5. Unit tests cover idempotency, checksums, key generation, staging payloads, dry-run behavior, and failure classification.

**Plans:** TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Project Foundation and Integration Contract | 1/1 | Complete | 2026-05-09 |
| 2. Source Discovery and Dry Run | 4/4 | Complete | 2026-05-09 |
| 3. Raw Replay Storage | 4/4 | Complete | 2026-05-09 |
| 4. Staging and Promotion Handoff | 0/TBD | Not started | - |
| 5. Scheduled Operations and Validation | 0/TBD | Not started | - |

---
*Roadmap created: 2026-05-09*
