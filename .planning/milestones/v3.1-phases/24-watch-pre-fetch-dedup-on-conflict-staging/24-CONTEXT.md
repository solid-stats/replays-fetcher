# Phase 24: Watch Pre-Fetch Dedup + ON CONFLICT Staging - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning
**Source:** Assumptions mode — orchestrator-gathered cross-app evidence (server-2 read directly)

<domain>
## Phase Boundary

First INTENTIONAL behavior change of the v3.1 milestone (Phases 19–23 were behavior-preserving).
Two bundled changes sharing one root cause (redundant byte-downloads of already-known replays):

1. **DEDUP-01 — watch pre-fetch dedup.** Before downloading replay bytes in the watch loop, check
   whether a staging row already exists for `(source_system, source_replay_id)`; if so, skip the
   fetch. Collapses a no-new-replay cycle from ~21 s + ~2.7 req/s to a single listing fetch.
2. **DEDUP-02 — non-throwing benign staging insert.** Replace the current insert-and-catch-23505
   benign path with `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING`, so the benign exact
   re-stage no longer relies on throwing/catching a unique-violation.
3. **DEDUP-03 — cross-app server-2 conflict semantics.** RESOLVED below (read from server-2 source).

In scope: `src/staging/postgres-staging-repository.ts`, the watch loop pre-fetch path
(`src/run/*` / `src/commands/watch.ts` → `watch-loop.ts`), the run-summary counter set, and the
golden **watch** oracle (updated, not loosened). NOT in scope: the discovery game-date capture
(Phase 25), any server-2 mutation, any schema/DDL ship from this repo.
</domain>

<decisions>
## Implementation Decisions

### DEDUP-03 — server-2 cross-app contract (LOCKED, verified against source)
Read directly from `~/Projects/SolidGames/server-2`:
- `ingest_staging_records` (migration `0001_v1_domain_schema.sql:103-117`) carries **two** unique
  constraints: `unique (source_system, source_replay_id)` AND `unique (checksum, object_key)`.
- The server-2 ingest/poller promotes staging rows and routes conflicting duplicates to manual
  review via `markStagingConflicted` (`src/modules/ingest/service.ts`); the conflict pair is
  "SAME (source_system, source_replay_id), DIFFERENT bytes" (golden `invariants.golden.test.ts`).
- **Therefore the fetcher's `ON CONFLICT` target MUST be the BENIGN `(checksum, object_key)`
  constraint ONLY.** A same-`source_replay_id`/different-checksum insert then still raises 23505 on
  the `(source_system, source_replay_id)` constraint — which the fetcher must keep catching and
  routing through `classifyExistingStaging` → `status: "conflict"` so server-2 can surface it for
  manual review. The conflict path must NOT be swallowed (preserves the §B manual-review invariant).
- No server-2 question is open: the schema and poller expectations are unambiguous in source.

### DEDUP-01 — pre-fetch dedup (LOCKED)
- Query before byte-fetch: `SELECT 1 FROM ingest_staging_records WHERE source_system=$1 AND
  source_replay_id=$2` (columns confirmed present in both repos).
- **Layer on top of, never replace, the byte-checksum dedup backstop** — the existing
  `classifyExistingStaging` object-identity path stays as the safety net.
- **Absent / empty / ambiguous `source_replay_id` ALWAYS falls through to fetch** — never skip on a
  missing or untrustworthy id. This is the data-loss guard.
- Run summary gets a **distinct `skipped-by-source-id` counter**, separate from the existing
  duplicate (`dup`) counter, so the skip is observable and auditable.
- Only the **watch** loop gets the pre-fetch check in this phase (the headline operational win is
  the always-on daemon's idle cycle). `run-once` parity is the planner's call but is NOT required by
  the requirement text — keep scope to the watch loop unless the planner finds run-once trivially
  shares the path.

### DEDUP-02 — non-throwing benign insert (LOCKED)
- `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id`. When the benign conflict
  fires, `RETURNING` yields **zero rows** → treat as the benign already-staged case (do NOT throw,
  do NOT mis-classify as a write failure). Fetch/return the existing staging id where the current
  contract expects one (`status: "already_staged"`), matching today's behavior for that case.
- The `(source_system, source_replay_id)` violation is intentionally NOT in the `ON CONFLICT` target
  → it still throws 23505 → caught → `classifyExistingStaging` → `conflict`. Unchanged.
- `IngestStagingResult` status surface stays the same (`staged | already_staged | conflict | failed`)
  — this is an internal refactor of HOW the benign case is detected, not a contract change.

### Claude's Discretion
- Exact run-summary field name (`skipped-by-source-id` is the research label; match the existing
  counter naming convention in the summary type).
- Whether the pre-fetch check is a new repository method (e.g. `existsBySourceIdentity`) reusing
  `findBySourceIdentity`, or a dedicated lean `SELECT 1`. Prefer reuse if it does not pull extra
  columns into a hot-path query.
- Test structure (the verification gates below are mandatory; their shape is the planner's).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Fetcher (this repo)
- `src/staging/postgres-staging-repository.ts` — current `stage()` (insert→catch 23505→
  `classifyExistingStaging`), `findBySourceIdentity`, `findByObjectIdentity`, `matchesPayload`.
- `src/staging/types.ts`, `src/types/staging.ts` — `IngestStagingPayload` / `IngestStagingResult`.
- `src/staging/staging-schema.fixtures.ts` — the test schema mirroring the two unique constraints.
- The watch loop pre-fetch site (`src/commands/watch.ts` → `watch-loop.ts`) and the run summary type.
- `src/run/golden-e2e.integration.test.ts` + the golden **watch** oracle — must be UPDATED to encode
  the new skip behavior and the `skipped-by-source-id` counter (updated, not loosened).

### server-2 (cross-app, read-only evidence)
- `~/Projects/SolidGames/server-2/src/infra/db/migrations/0001_v1_domain_schema.sql:103-120` — the
  two unique constraints + status index.
- `~/Projects/SolidGames/server-2/src/modules/ingest/service.ts` — `markStagingConflicted` /
  `markStagingPromoted` (the conflict-routing the fetcher must keep feeding).
- `~/Projects/SolidGames/server-2/src/test/golden/invariants.golden.test.ts:128-151` — the
  conflict-pair invariant.
</canonical_refs>

<specifics>
## Specific Ideas

- "Cannot miss a new record" property test: over a parameterized matrix of id states
  (present-known / present-unknown / empty / absent / whitespace), EVERY unknown-or-untrustworthy id
  must result in a fetch — only a present-AND-known id may skip. This is the data-loss gate.
- Conflict-classification integration test (testcontainers PostgreSQL): benign exact re-stage stays
  quiet (no conflict row, no throw); same-source-id/different-checksum still surfaces as `conflict`.
- `vi.useFakeTimers()` for any watch-loop timing in unit tests (no real sleeps).
</specifics>

<deferred>
## Deferred Ideas

- `run-once` pre-fetch dedup parity — only if the planner finds it shares the watch path trivially;
  not required by DEDUP-01..03.
- Any change to the `dup`/checksum backstop semantics — out of scope; backstop stays as-is.
</deferred>

<risk_summary>
## Risk Summary

- **DATA-LOSS-CAPABLE (DEDUP-01):** a wrong/absent-id skip silently drops a genuinely-new replay,
  invisible in logs. Mitigated by: absent/empty/ambiguous → always fetch; checksum backstop kept;
  the "cannot miss" property test; the distinct `skipped-by-source-id` counter. **Human-in-the-loop
  review is REQUIRED before this ships to a production staging target** — surface at milestone ship,
  do not auto-close.
- **§B swallow (DEDUP-02):** `ON CONFLICT DO NOTHING` on the wrong constraint would swallow the
  conflicting-duplicate manual-review path. Mitigated by targeting ONLY `(checksum, object_key)` and
  keeping the 23505-catch→classify path for the `(source_system, source_replay_id)` violation.
- **Oracle drift:** the golden watch oracle must be UPDATED to the new expected counts, never
  loosened to pass.
</risk_summary>

---

*Phase: 24-watch-pre-fetch-dedup-on-conflict-staging*
*Context gathered: 2026-06-20 via assumptions mode (orchestrator cross-app evidence)*
