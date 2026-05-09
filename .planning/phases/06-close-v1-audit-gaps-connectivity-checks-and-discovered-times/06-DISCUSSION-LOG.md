# Phase 6: Close v1 audit gaps: connectivity checks and discovered timestamp staging evidence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times
**Areas discussed:** audit scope, connectivity contract, discovered timestamp propagation, structured logging, integration validation, Nyquist backfill

---

## Audit Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Audit blockers | Discuss only RUN-04 connectivity and discovered timestamp propagation. | |
| Blockers + logging | Add OPS-02 decision: final summary as log or separate logger. | |
| All audit items | Also discuss live MinIO/PostgreSQL validation and Nyquist gaps. | ✓ |

**User's choice:** All audit items.
**Notes:** Phase 6 scope includes the two blocking audit gaps plus OPS-02 logging decision, Testcontainers integration debt, and Nyquist backfill.

---

## Connectivity Contract

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Source connectivity | Fetch source page | Use existing source client to confirm source responds without full candidate normalization. | ✓ |
| Source connectivity | Full dry-run parse | Reuse discovery dry-run and require a report without source-level errors. | |
| Source connectivity | Config only | Leave source connectivity outside `check`. | |
| S3 connectivity | Read-only probe | Use safe bucket-level or metadata/list read-only operation without writes. | ✓ |
| S3 connectivity | Write-delete probe | Create and delete a probe object. | |
| S3 connectivity | Adapter init only | Only construct the client. | |
| PostgreSQL connectivity | Read-only query | Run `select 1` and verify `ingest_staging_records` is accessible. | ✓ |
| PostgreSQL connectivity | Insert rollback probe | Probe insert inside rollback transaction. | |
| PostgreSQL connectivity | Pool connect only | Only connect to the database. | |

**User's choice:** Read-only checks for all three systems.
**Notes:** Expected failures should be structured JSON and exit `2`.

---

## Discovered Timestamp Propagation

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Timestamp source | Source metadata first | Use `candidate.metadata.discoveredAt` when present; do not invent fallback. | ✓ |
| Timestamp source | Fallback to fetchedAt | Use fetch timestamp when source metadata is absent. | |
| Timestamp source | Run startedAt fallback | Use run/discovery start time when source metadata is absent. | |
| DB replay_timestamp | Only trusted replay time | Keep nullable; do not write discoveredAt if it is not replay time. | ✓ |
| DB replay_timestamp | Use discoveredAt | Store source discovered timestamp in `replay_timestamp`. | |
| DB replay_timestamp | Use fetchedAt | Store fetch timestamp in `replay_timestamp`. | |
| Evidence shape | promotionEvidence only | Add `discoveredAt` to JSON evidence; keep `replay_timestamp` reserved. | ✓ |
| Evidence shape | promotionEvidence + type | Add discoveredAt plus timestamp kind/source marker. | |
| Evidence shape | New column | Require schema change for a dedicated discovered timestamp column. | |

**User's choice:** Preserve source-provided `discoveredAt` in `promotionEvidence` only.
**Notes:** No replay parsing and no `replay_timestamp` overloading.

---

## Structured Logging and OPS-02

| Option | Description | Selected |
|--------|-------------|----------|
| Summary is log | Treat final JSON summary on stdout as structured log surface and test secret redaction. | ✓ |
| Add logger | Add separate structured logger for per-item/run events. | |
| Defer logging | Leave OPS-02 as tech debt. | |

**User's choice:** Summary is log.
**Notes:** Do not add separate logger unless implementation proves summary output cannot satisfy OPS-02.

---

## Integration Validation

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Docker policy | Skip with notice | Skip integration tests when Docker is unavailable and keep verify green. | |
| Docker policy | Hard fail | `pnpm run verify` fails without Docker. | ✓ |
| Docker policy | Separate command | Keep integration tests outside `verify`. | |
| Containers scope | PostgreSQL only | Cover staging DB with Testcontainers only. | |
| Containers scope | PostgreSQL + MinIO | Cover PostgreSQL and S3-compatible storage with Testcontainers. | ✓ |
| Containers scope | Smoke docs only | Do not add Testcontainers code. | |

**User's choice:** Add PostgreSQL + MinIO Testcontainers and make Docker availability a hard verification requirement.
**Notes:** Keep focused unit/fake tests as well.

---

## Nyquist Backfill

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 6 only | Create validation strategy only for Phase 6. | |
| Backfill all | Retroactively create/check validation docs for phases 1, 3, 4, and 5. | ✓ |
| Defer Nyquist | Do not address Nyquist in Phase 6. | |
| Docs only | Create validation docs from existing verification evidence only. | |
| Docs + new tests | Add focused tests if validation backfill finds real gaps. | ✓ |
| Run validate phase | Use separate `$gsd-validate-phase` workflows instead. | |

**User's choice:** Backfill all missing validation docs and add tests if gaps are found.
**Notes:** Phase 2 already has `02-VALIDATION.md`; phases 1, 3, 4, and 5 are missing validation artifacts.

---

## the agent's Discretion

- Exact helper/module names for connectivity checks.
- Exact S3 read-only probe operation, as long as no object write occurs.
- Exact Testcontainers script/file organization, as long as tests remain colocated under `src/`.

## Deferred Ideas

- Separate per-item structured logger beyond final JSON summaries.
- Always-on crawler mode.
- Player-submitted replay uploads.
- Full historical production import.
