# Research: Pitfalls

**Project:** replays-fetcher  
**Domain:** scheduled replay ingest service  
**Researched:** 2026-05-09  
**Confidence:** MEDIUM

## Pitfall 1: Boundary Creep Into Backend State

**Risk:** The fetcher starts creating or mutating `server-2` business tables such as `replays`, `parse_jobs`, `parse_results`, identity, stats, requests, or moderation rows.

**Warning signs:**

- SQL references business tables directly.
- Fetcher creates parse job IDs or publishes RabbitMQ parse requests.
- Run summaries report canonical replay/job states instead of staging states.

**Prevention:**

- Keep Phase 1 integration contract explicit.
- Add tests or static checks proving forbidden tables are not written.
- Require explicit user approval and planning updates for any backend ownership change.

**Phase:** 1, 4

## Pitfall 2: Unsafe Deduplication

**Risk:** The fetcher auto-merges conflicts based only on checksum or only on source identity, losing lineage or duplicating stats.

**Warning signs:**

- Code treats checksum-only matches as canonical truth.
- Source ID changes overwrite prior evidence.
- Ambiguous duplicate states are collapsed in the fetcher.

**Prevention:**

- Preserve checksum plus source identity evidence.
- Let `server-2` own product-level deduplication and manual review.
- Test repeated runs and conflicting metadata fixtures.

**Phase:** 2, 4

## Pitfall 3: Non-Idempotent Scheduled Runs

**Risk:** Repeated runs create duplicate staging records or destructive object overwrites.

**Warning signs:**

- Object keys include timestamps or random values without a stable identity component.
- Staging inserts have no unique/idempotency constraint.
- Retry paths repeat side effects without detecting prior writes.

**Prevention:**

- Define stable object key layout before storage implementation.
- Use checksum/source identity constraints for staging writes.
- Make tests run the same fixture twice and compare outputs.

**Phase:** 2, 3, 4

## Pitfall 4: External Source Instability

**Risk:** HTML/API shape changes, missing metadata, timeouts, or rate limits silently corrupt staging evidence.

**Warning signs:**

- Parser accepts partial metadata without diagnostics.
- No fixture coverage for missing or malformed fields.
- Retries are unbounded or have no timeout.

**Prevention:**

- Build source discovery behind an adapter.
- Fixture malformed and changed source responses.
- Use bounded retries, request timeouts, and categorized failures.

**Phase:** 2

## Pitfall 5: Operational Opacity

**Risk:** Operators cannot tell what a scheduled run did or why it failed.

**Warning signs:**

- Logs are unstructured strings without run IDs.
- Dry-run output differs from run summary fields.
- Exit codes do not distinguish config failure from partial runtime failure.

**Prevention:**

- Define failure categories early.
- Emit structured summaries for all command modes.
- Test summary counts and exit behavior.

**Phase:** 5
