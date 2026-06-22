# Phase 24: Watch Pre-Fetch Dedup + ON CONFLICT Staging - Research

**Researched:** 2026-06-20
**Domain:** PostgreSQL upsert semantics (ON CONFLICT), ingest-pipeline pre-fetch dedup, data-loss-safe skip logic, golden-oracle update
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**DEDUP-03 — server-2 cross-app contract (LOCKED, verified against source):**
- `ingest_staging_records` carries TWO unique constraints: `unique (source_system, source_replay_id)` AND `unique (checksum, object_key)` (migration `0001_v1_domain_schema.sql:103-117`).
- server-2's ingest poller routes conflicting duplicates to manual review via `markStagingConflicted`; the conflict pair is "SAME (source_system, source_replay_id), DIFFERENT bytes."
- **The fetcher's `ON CONFLICT` target MUST be the BENIGN `(checksum, object_key)` constraint ONLY.** A same-`source_replay_id`/different-checksum insert must still raise 23505 on `(source_system, source_replay_id)` → caught → `classifyExistingStaging` → `status: "conflict"`. The conflict path must NOT be swallowed.

**DEDUP-01 — pre-fetch dedup (LOCKED):**
- Query before byte-fetch: `SELECT 1 FROM ingest_staging_records WHERE source_system=$1 AND source_replay_id=$2`.
- Layer ON TOP of, never replace, the byte-checksum dedup backstop — the existing `classifyExistingStaging` object-identity path stays the safety net.
- **Absent / empty / ambiguous `source_replay_id` ALWAYS falls through to fetch.** Never skip on a missing or untrustworthy id. This is the data-loss guard.
- Run summary gets a DISTINCT `skipped-by-source-id` counter, separate from the existing `duplicate` counter.
- Only the WATCH loop gets the pre-fetch check in this phase. `run-once` parity is the planner's call but NOT required by the requirement text.

**DEDUP-02 — non-throwing benign insert (LOCKED):**
- `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id`. On benign conflict, `RETURNING` yields ZERO rows → treat as the benign already-staged case (do NOT throw, do NOT mis-classify as a write failure). Fetch/return the existing staging id (`status: "already_staged"`), matching today's behavior.
- The `(source_system, source_replay_id)` violation is NOT in the `ON CONFLICT` target → still throws 23505 → caught → `classifyExistingStaging` → `conflict`. Unchanged.
- `IngestStagingResult` status surface stays the same (`staged | already_staged | conflict | failed`). Internal refactor of HOW the benign case is detected, not a contract change.

### Claude's Discretion
- Exact run-summary field name (`skipped-by-source-id` is the research label; match the existing counter naming convention in the summary type — see Pitfall 4).
- Whether the pre-fetch check is a new repository method (e.g. `existsBySourceIdentity`) reusing `findBySourceIdentity`, or a dedicated lean `SELECT 1`. Prefer reuse if it does not pull extra columns into a hot-path query.
- Test structure (the verification gates are mandatory; their shape is the planner's).

### Deferred Ideas (OUT OF SCOPE)
- `run-once` pre-fetch dedup parity — only if the planner finds it shares the watch path trivially; not required by DEDUP-01..03.
- Any change to the `dup`/checksum backstop semantics — out of scope; backstop stays as-is.
- Dedup cache / bloom filter (REQUIREMENTS Out-of-Scope: a cheap PG existence check meets the goal; a cache adds a staleness failure mode).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEDUP-01 | `watch` page-1 cycle skips a candidate whose `source_replay_id` already exists in staging BEFORE fetching bytes; absent/empty/ambiguous ids fall through to fetch; byte-checksum dedup remains the backstop. | The pre-fetch SELECT belongs in `ingest-page.ts` (the shared store→stage fan-out), keyed on `candidate.source.externalId`. The data-loss matrix (§Architecture Patterns → Pattern 2) enumerates every id state. The checksum backstop is the existing `classifyExistingStaging` object-identity path — preserved. |
| DEDUP-02 | A no-new-replay watch cycle performs only the page-1 list fetch (no redundant byte downloads), reported via a distinct `skipped-by-source-id` run-summary counter. | The skip happens before `storeRawReplay` (which is the byte download). New counter added to `RunSummaryCounts` and tallied in `summary.ts countRun`. The golden-watch oracle must be UPDATED to assert `fetchBytes` is NOT called on cycles ≥2 (see Pitfall 1). |
| DEDUP-03 | Staging dedup uses `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING` for the benign duplicate; the conflicting-duplicate (same source id, different checksum) manual-review classification is preserved. | PostgreSQL official docs confirm `RETURNING` yields zero rows on a skipped conflict (§Code Examples). `stage()` detects empty rows → resolves existing id → `already_staged`. The 23505-catch→`classifyExistingStaging` path stays for the `(source_system, source_replay_id)` violation. |
</phase_requirements>

## Summary

This phase makes the first intentional behavior change of v3.1 against a fully-tested ingest CLI. The two changes share one root cause — redundant byte-downloads of already-known replays — and touch a small, well-understood surface: `src/staging/postgres-staging-repository.ts` (the insert/conflict path), `src/run/ingest-page.ts` (the shared store→stage fan-out where the pre-fetch SELECT lands), `src/types/run-summary.ts` + `src/run/summary.ts` (the new counter), and `src/run/golden-watch.integration.test.ts` (the oracle that currently PINS re-download and must be flipped).

The dominant risk is **silent data loss** (DEDUP-01): a skip keyed on an untrustworthy `source_replay_id` would drop a genuinely-new replay invisibly. The codebase's own `toSourceReplayId` (`src/staging/payload.ts:40`) makes this tractable: `source_replay_id` is derived from `candidate.source.externalId` when present, else a `derived:<sha256(url\nfilename\nchecksum)>` form that REQUIRES the downloaded bytes (the checksum). The pre-fetch check therefore can ONLY skip when `candidate.source.externalId` is a trustworthy non-empty value — every other id state (absent, empty, whitespace, or the derived form that needs bytes) must fall through to fetch, where the existing checksum backstop (`classifyExistingStaging` object-identity path) still catches benign dups.

DEDUP-02's `ON CONFLICT ... DO NOTHING RETURNING id` is confirmed by PostgreSQL official docs to return zero rows on a skipped conflict. The current `stage()` returns `already_staged` WITH a `stagingId`, so on the empty-rows benign path the repository must resolve the existing id (a follow-up `findByObjectIdentity` SELECT) to preserve the contract — do not change `IngestStagingResult` to make `stagingId` optional for that case.

**Primary recommendation:** Put the pre-fetch existence check inside `ingest-page.ts` keyed strictly on `candidate.source.externalId` (trustworthy non-empty only); rewrite `stage()` to `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id`, detect the empty-rows benign path, resolve the existing id, and keep the 23505-catch→`classifyExistingStaging` path untouched for the `(source_system, source_replay_id)` violation. Add a distinct `skippedBySourceId` counter and FLIP the golden-watch oracle from "re-download every cycle" to "no byte fetch on cycles ≥2."

## Architectural Responsibility Map

| Capability | Primary Tier (band) | Secondary Tier | Rationale |
|------------|---------------------|----------------|-----------|
| Pre-fetch existence check (the SELECT) | Adapter (`staging/postgres-staging-repository.ts` — owns PG reads/writes) | Orchestration (`run/ingest-page.ts` calls it before the byte download) | The SQL belongs to the staging adapter (write-scope band, the only place that talks to `pg`); the *decision* to skip is orchestration's, applied in the store→stage fan-out. |
| Skip decision (id trustworthy? skip : fetch) | Orchestration (`run/ingest-page.ts`) | — | Per §A.4 of fetcher conventions, idempotency/resume decisions live in orchestration, not in the adapter or checkpoint. The fan-out is where a candidate is gated before `storeRawReplay`. |
| ON CONFLICT benign-insert mechanic | Adapter (`staging/postgres-staging-repository.ts`) | — | Pure SQL + result-shape handling; the write-scope adapter owns it. |
| `skipped-by-source-id` counter | Cross-cutting (`types/run-summary.ts` defines `RunSummaryCounts`) | Orchestration (`run/summary.ts countRun` tallies it) | The count shape is a cross-band contract (the type lives in `types/`); the builder stays in its owning band (`run/`). |
| Golden-watch oracle update | Test infra (`run/golden-watch.integration.test.ts`) | — | The behavior-change assertion; testcontainers PostgreSQL + MinIO. |

## Standard Stack

No new runtime dependencies. Everything needed is already installed and in use.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | `^8.20.0` | Raw SQL staging writes (the `ON CONFLICT` insert + the pre-fetch SELECT) | Already the staging adapter's client; raw SQL keeps the write scope auditable (AGENTS / fetcher conventions §A — no ORM). [VERIFIED: package.json] |
| `vitest` | `^4.1.5` | Unit + integration test runner | Project standard; fake timers for watch-loop timing (TEST-04). [VERIFIED: package.json] |
| `@testcontainers/postgresql` | (in devDeps) | Ephemeral PostgreSQL for the conflict-classification integration test | The fetcher tests skill mandates testcontainers PostgreSQL for staging integration tests. [VERIFIED: existing tests import it — `postgres-staging-repository.integration.test.ts:1`] |
| `@testcontainers/minio` | (in devDeps) | Ephemeral S3 for the golden-watch oracle | Already used by `golden-watch.integration.test.ts:2`. [VERIFIED: existing test] |
| `zod` | `^4.4.3` | (unchanged) config/payload validation | No new validation surface this phase. [VERIFIED: package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `INSERT ... ON CONFLICT DO NOTHING` | keep insert-and-catch-23505 for the benign case | Catch path relies on throwing/catching a unique violation as control flow → log spam (the postgres duplicate-key ERROR the requirement names) and conflates the benign case with the real conflict. DEDUP-02/03 explicitly replace it for the benign constraint only. |
| Pre-fetch `SELECT 1` lean query | reuse `findBySourceIdentity` | `findBySourceIdentity` selects 6 columns; the hot-path existence check needs only existence. Discretion item — prefer a lean `SELECT 1` (or `exists`) if reuse pulls extra columns into the per-candidate hot path. |
| In-memory dedup cache / bloom filter | — | OUT OF SCOPE per REQUIREMENTS — adds a staleness failure mode; a cheap PG existence check meets the latency goal. |

**Installation:** none (no new packages).

## Package Legitimacy Audit

> Not applicable — this phase installs no external packages. All libraries used (`pg`, `vitest`, `@testcontainers/*`, `zod`) are already present in `package.json` and exercised by existing tests.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                  WATCH command (src/commands/watch.ts)
                            │ (config validated, resources built, shutdown seam)
                            ▼
                  runWatchLoop (src/run/watch-loop.ts)
                            │ per cycle: pacer floor → discover page 1
                            ▼
            discoverReplaysDryRun ──► report.candidates[]  (each has source.externalId?)
                            │
                            ▼
              ingestPage (src/run/ingest-page.ts)  ◄── THE PRE-FETCH GATE GOES HERE
              for each candidate, over p-limit:
                 ┌─────────────────────────────────────────────┐
                 │  NEW STEP — pre-fetch existence check:        │
                 │  trustworthy externalId AND exists in staging │
                 │   ? skip  (tally skippedBySourceId, NO fetch) │
                 │   : ▼ fall through                            │
                 └─────────────────────────────────────────────┘
                            │
                            ▼
                 storeRawReplay  ── fetchBytes(url) ──► checksum ──► S3 put (HEAD→skip if exists)
                            │
                            ▼
                 stageRawReplay ──► repository.stage(payload)
                            │
                            ▼
       postgres-staging-repository.stage (src/staging/postgres-staging-repository.ts)
         INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id
            ├─ rows.length === 1  → status: "staged"
            ├─ rows.length === 0  → benign dup → resolve existing id → "already_staged"
            └─ throws 23505 (source_system, source_replay_id) → classifyExistingStaging
                  ├─ same-id + same bytes  → "already_staged"
                  ├─ same-id + diff bytes  → "conflict"  ◄── server-2 manual review (MUST NOT swallow)
                  └─ object-identity dup   → "conflict" / backstop
                            │
                            ▼
              buildRunSummary / countRun (src/run/summary.ts)
                 counts.{discovered,stored,staged,duplicate,skippedBySourceId,...}
```

### Pattern 1: ON CONFLICT DO NOTHING with empty-rows detection (DEDUP-02/03)

**What:** Replace the benign insert-and-catch with a targeted upsert that does not throw on the benign constraint, while leaving the conflict constraint to throw.

**When to use:** The `stage()` method's primary insert path.

**Example:**
```typescript
// Source: PostgreSQL official docs (sql-insert) + current postgres-staging-repository.ts
// INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id
//   - row inserted        → rows = [{ id }]            → "staged"
//   - benign (checksum,object_key) conflict → rows = [] → "already_staged" (resolve id)
//   - (source_system, source_replay_id) conflict → THROWS 23505 (not in ON CONFLICT target)
const result = await insertStagingOnConflict(client, payload); // adds: on conflict (checksum, object_key) do nothing
const [row] = result.rows;
if (row !== undefined) {
  return { payload, stagingId: row.id, status: "staged" };
}
// Benign duplicate: RETURNING gave zero rows. Resolve the existing id to keep the
// IngestStagingResult contract (already_staged carries stagingId today).
const existing = await findByObjectIdentity(client, payload); // (checksum, object_key) row
return {
  existing: existing && toExisting(existing),
  payload,
  stagingId: existing?.id,
  status: "already_staged",
};
// The 23505 catch → classifyExistingStaging path stays EXACTLY as-is for the
// (source_system, source_replay_id) violation → conflict (server-2 manual review).
```

**Note:** The current `already_staged` from `classifyExistingStaging` (same-id + matching payload) ALSO returns a `stagingId`. Keep both `already_staged` producers returning a `stagingId` so the contract is uniform.

### Pattern 2: Data-loss-safe pre-fetch skip — the "cannot miss" matrix (DEDUP-01)

**What:** Only skip when the candidate's `source.externalId` is a trustworthy non-empty value AND a staging row exists for `(sourceSystem, externalId)`. Every other id state fetches.

**When to use:** Inside `ingest-page.ts`, before `storeRawReplay` for each candidate.

**The full `source_replay_id` state matrix** (`source_replay_id` is produced by `toSourceReplayId` at `src/staging/payload.ts:40` — but at pre-fetch time the bytes/checksum are not yet available, so the check can ONLY use `candidate.source.externalId`):

| `candidate.source.externalId` state | Maps to `source_replay_id` | Pre-fetch decision | Why |
|-------------------------------------|----------------------------|--------------------|-----|
| present, known non-empty (e.g. `"1778269931"`) AND staging row exists | `externalId` verbatim | **SKIP** (tally `skippedBySourceId`) | The only safe skip: the post-fetch `source_replay_id` would be exactly this value. |
| present, known non-empty, NO staging row | `externalId` verbatim | **FETCH** | Genuinely new — must download. |
| `undefined` (absent — `html.ts:101` only sets it when the regex matched) | `derived:<sha256(...)>` (needs checksum) | **FETCH** | Post-fetch id is the derived form; pre-fetch cannot compute it → cannot match → must fetch. |
| empty string `""` | (treated as untrustworthy) | **FETCH** | Untrustworthy id; never skip. |
| whitespace-only `"   "` | (treated as untrustworthy) | **FETCH** | Untrustworthy id; trim → empty → fetch. |
| present but the eventual stored bytes differ from an existing same-id row | `externalId` verbatim | **(skip not taken — see note)** | A pre-fetch skip on a same-id/different-bytes case would HIDE a conflict. Because the skip only fires when a row already EXISTS for that id, and a true new-content-same-id case is rare, the conservative rule stands: skip only collapses the *exact already-known* replay. The checksum backstop + 23505→conflict path remain for anything that slips through to staging. |

**Decision rule (property invariant):** `skip ⟹ (externalId is a non-empty trimmed string) AND (a staging row exists for (sourceSystem, externalId))`. Contrapositive: `(externalId absent/empty/whitespace) ⟹ fetch`. This is the property-test predicate.

**Example:**
```typescript
// Source: derived from src/staging/payload.ts:40 (toSourceReplayId) + DEDUP-01 lock
const isTrustworthyId = (id: string | undefined): id is string =>
  id !== undefined && id.trim().length > 0;

// inside the per-candidate fan-out, BEFORE storeRawReplay:
const externalId = candidate.source.externalId;
if (isTrustworthyId(externalId) &&
    (await stagingRepository.existsBySourceIdentity(SOURCE_SYSTEM, externalId))) {
  // skip — no byte fetch, no S3, no staging insert. Tally skippedBySourceId.
  return { kind: "skipped-by-source-id" };
}
// else fall through to storeRawReplay (the existing path)
```

**Caveat for the planner — `sourceSystem` at pre-fetch time:** `toSourceReplayId`/`toIngestStagingPayload` default `sourceSystem` to `"sg-zone"` (`payload.ts:9`, `defaultSourceSystem`). The pre-fetch check needs the same `sourceSystem` value it will be staged under. Today that default is hard-coded in `payload.ts` and not threaded into `ingest-page.ts`. The planner must thread the same `sourceSystem` constant to the existence check so the SELECT keys match the eventual INSERT — mismatched `sourceSystem` would make the skip never fire (a correctness-but-not-data-loss bug; failing safe = fetch).

### Pattern 3: Shared `ingestPage` — the run-once parity verdict

**What:** Both `run-once` (`run-once-page-rate.ts completeOkPage → ingestPage`) and `watch` (`watch-loop.ts runCycle → ingestPage`) call the SAME `ingestPage` helper (`src/run/ingest-page.ts:132`).

**Verdict on run-once parity (the CONTEXT-deferred question):** Putting the pre-fetch gate inside `ingestPage` would AUTOMATICALLY apply it to run-once as well — the path IS trivially shared. **But DEDUP-01 LOCKS scope to the watch loop only**, and giving run-once the skip silently is itself a behavior change (run-once's all-duplicate-page stop logic and its golden e2e oracle assume bytes are fetched then deduped by checksum — `golden-e2e.integration.test.ts` does not expect a pre-fetch skip). **Recommendation: gate the pre-fetch check behind an explicit per-call flag** (e.g. `ingestPage({ ..., prefetchDedup: true })`) that ONLY the watch `runCycle` sets. This keeps the DRY core shared, keeps run-once byte-for-byte unchanged (its oracle stays green untouched), and makes the watch-only scope explicit and testable. Do NOT make the skip unconditional in `ingestPage` — that would change run-once and break/loosen its golden oracle, violating the milestone's behavior-preservation discipline for everything outside DEDUP.

**When to use:** This is the recommended structure for the planner.

### Anti-Patterns to Avoid
- **Targeting the wrong `ON CONFLICT` constraint.** `ON CONFLICT (source_system, source_replay_id) DO NOTHING` (or no target / `ON CONFLICT DO NOTHING` with both) would SWALLOW the same-id/different-bytes conflict that server-2 needs for manual review (§B invariant). Target ONLY `(checksum, object_key)`.
- **Skipping on an untrustworthy id.** Skipping when `externalId` is absent/empty/whitespace silently drops a new replay. Always fetch on any non-trustworthy id.
- **Making the skip unconditional in the shared `ingestPage`.** Changes run-once behavior and its golden oracle. Gate it watch-only.
- **Loosening the golden-watch oracle to pass.** The oracle currently asserts `fetchBytes` grows every cycle; it must be FLIPPED to assert no re-fetch on cycles ≥2, with the new `skippedBySourceId` count asserted — not deleted/relaxed.
- **Changing `IngestStagingResult` to make `stagingId` optional for `already_staged`.** The benign empty-rows path must resolve the existing id, not drop it.
- **Defensive try/catch for logging in the new path** (fetcher conventions §AA / std correctness §AA): the top-level CLI handler + run summary are the logging boundary. Do not add try/catch around the existence check just to log.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Benign-duplicate detection | Custom "select-then-insert" race-prone check, or insert-and-catch as control flow | `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id` | Atomic, race-safe at the DB; no exception-as-flow; ends the log spam. |
| Existence check | A `SELECT *` + JS truthiness | A lean `SELECT 1 ... LIMIT 1` (or `SELECT exists(...)`) | Hot-path query; do not pull 6 columns to test existence (discretion item). |
| Conflict classification | New conflict logic | Existing `classifyExistingStaging` (unchanged) | Already encodes the source-identity vs object-identity taxonomy server-2 depends on. |
| Counter wiring | A parallel ad-hoc counter object | Add a field to `RunSummaryCounts` + tally in `summary.ts countRun` | The summary is the §D operational surface; counters live in one place. |

**Key insight:** PostgreSQL's `ON CONFLICT` is the canonical idempotent-upsert primitive — the fetcher's idempotency invariant (AGENTS / conventions §A.4) is explicitly "unique natural key + `ON CONFLICT DO NOTHING`-style writes." This phase brings the benign path into line with that stated convention.

## Common Pitfalls

### Pitfall 1: Golden-watch oracle pins the OLD behavior
**What goes wrong:** `golden-watch.integration.test.ts:196` asserts `fetchBytes.mock.calls.length === stagedCycleOne * cycleCount` (bytes re-downloaded EVERY cycle) and lines 188-192 assert cycles ≥2 report `duplicate: stagedCycleOne`. After DEDUP-01, cycles ≥2 must NOT call `fetchBytes` at all — the skip happens before the download.
**Why it happens:** The oracle was written to PIN the pre-DEDUP behavior ("dedup-before-fetch is out of scope" comment at line 195).
**How to avoid:** FLIP the oracle: assert `fetchBytes` is called `stagedCycleOne` times TOTAL (cycle 1 only), and cycles ≥2 report `skippedBySourceId: stagedCycleOne` and `duplicate: 0` (no staging insert is attempted because the candidate is skipped pre-fetch). Update, do not loosen.

### Pitfall 2: `derived:` ids and the checksum dependency
**What goes wrong:** Attempting to compute `source_replay_id` at pre-fetch time to match the staging key — but the `derived:` form needs the checksum, which needs the bytes.
**Why it happens:** `toSourceReplayId` (`payload.ts:40`) only returns the verbatim `externalId`; otherwise it hashes URL+filename+checksum.
**How to avoid:** The pre-fetch check keys ONLY on `candidate.source.externalId` (trustworthy), never on the derived id. Anything without a trustworthy `externalId` fetches.

### Pitfall 3: `sourceSystem` mismatch makes the skip silently never fire
**What goes wrong:** The pre-fetch SELECT uses a different `sourceSystem` than the eventual INSERT → no match → never skips (latency win lost, but not data loss).
**Why it happens:** `sourceSystem` defaults to `"sg-zone"` inside `payload.ts`, not threaded to `ingest-page.ts`.
**How to avoid:** Thread the single `sourceSystem` constant to both the existence check and the payload builder. Add a test asserting the skip actually fires for a real same-`externalId` candidate.

### Pitfall 4: New counter must be exactOptionalPropertyTypes-safe and present in all builders
**What goes wrong:** Adding `skippedBySourceId` to `RunSummaryCounts` but forgetting `emptyCounts` (`summary.ts:68`) or the config-invalid summary → type error or wrong baseline.
**Why it happens:** `RunSummaryCounts` is a required-fields object; every counts literal must include the new field.
**How to avoid:** Add the field to the type AND to `emptyCounts` AND to `countRun`'s returned object. tsconfig is very strict (conventions). Match existing counter naming (the type uses `duplicate`, `skipped`, `staged` — camelCase scalars; `skippedBySourceId` fits).

### Pitfall 5: Distinguish the new counter from the existing `skipped` and `duplicate`
**What goes wrong:** Folding the pre-fetch skip into the existing `skipped` (which counts raw-storage `skipped` + staging `not_stageable`) or `duplicate` (which counts staging `already_staged`) — making the new behavior unobservable.
**Why it happens:** Three "didn't do new work" buckets already exist.
**How to avoid:** A DISTINCT `skippedBySourceId` counter (DEDUP-01/02 lock). The pre-fetch skip never reaches storage or staging, so it cannot be a `skipped` (raw) or `duplicate` (staging) increment — it is its own bucket tallied in `ingestPage` and surfaced via the summary.

### Pitfall 6: `ingestPage` settle ordering and the skip result shape
**What goes wrong:** The skip returns a new result shape into a fan-out (`Promise.allSettled`) that currently expects `{ index, rawResult, stagingResult }` and tallies via `tallyRawResult`/`tallyStagingResult`.
**Why it happens:** `ingest-page.ts:48-52` `SettledCandidate` is a fixed shape; the skip produces neither a `rawResult` nor a `stagingResult`.
**How to avoid:** Extend `SettledCandidate` with a skip discriminant (e.g. `{ index, skipped: true }`) and a `tallySkip` branch, OR represent a skip as a synthetic "skipped" raw result that does NOT increment stored/staged. Keep the deterministic index-ordering re-sort (`fulfilledInOrder`). The rejected-settle-is-programmer-error rethrow stays.

## Runtime State Inventory

> Not a rename/refactor phase, but it changes write behavior against shared state. Surveyed for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `ingest_staging_records` rows in PostgreSQL (server-2-owned table). The new INSERT writes identical rows; the new SELECT only reads. No data migration. | None — read + idempotent write only. |
| Live service config | server-2's ingest poller (`markStagingConflicted`/`markStagingPromoted`) consumes the `conflict`/`pending` rows the fetcher writes. The conflict-routing contract is UNCHANGED (the conflict path is preserved). | None — verified the fetcher still produces `conflict` rows for same-id/different-bytes (CONTEXT DEDUP-03, verified against server-2 source). |
| OS-registered state | None — the watch daemon is a plain Node process (k8s exec liveness via heartbeat file, no OS registration). | None. |
| Secrets/env vars | No new env vars. `sourceSystem` is a code constant (`"sg-zone"`), not env. | None. |
| Build artifacts | None — pure source + test change. | None. |

**Verified:** the only shared state is `ingest_staging_records`; the change is read + idempotent-write only, no schema/DDL ship from this repo (additive-only discipline — and this phase adds no columns).

## Code Examples

### PostgreSQL ON CONFLICT DO NOTHING + RETURNING (the load-bearing fact)
```sql
-- Source: PostgreSQL official docs, sql-insert (current)
-- "Only rows that were successfully inserted or updated will be returned."
INSERT INTO ingest_staging_records (...)
VALUES (...)
ON CONFLICT (checksum, object_key) DO NOTHING
RETURNING id;
-- Row inserted          → returns 1 row  → "staged"
-- (checksum,object_key) conflict, skipped → returns 0 rows → benign "already_staged"
-- (source_system, source_replay_id) conflict → NOT in target → raises 23505
```

### Existing conflict path that MUST be preserved (do not touch)
```typescript
// Source: src/staging/postgres-staging-repository.ts:189-198 (current)
} catch (error) {
  if (!isUniqueViolation(error)) {
    return { payload, reason: "staging_write_failed", status: "failed" };
  }
  return classifyExistingStaging(client, payload); // → conflict for same-id/diff-bytes
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Insert-and-catch-23505 for the benign duplicate | `ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id` | This phase (DEDUP-02) | Ends postgres duplicate-key ERROR log spam; benign dup no longer uses exception-as-flow. |
| Watch re-downloads bytes every idle cycle, dedups by checksum after download | Pre-fetch existence check skips known `externalId` before download | This phase (DEDUP-01) | A no-new-replay cycle collapses to one page-1 list fetch (~21s+2.7req/s → single fetch). |

**Deprecated/outdated:** nothing removed; the checksum backstop (`classifyExistingStaging` object-identity path) stays as the safety net.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `candidate.source.externalId` is the ONLY pre-fetch-available value that maps verbatim to `source_replay_id`; the `derived:` form needs the post-fetch checksum. | Pattern 2, Pitfall 2 | If a future discovery path populated `source_replay_id` from something else available pre-fetch, the matrix would need a new safe-skip case. Verified against `payload.ts:40` current source — LOW risk. |
| A2 | `sourceSystem` is the constant `"sg-zone"` (`payload.ts:9`) for the watch path; the pre-fetch SELECT must use the same value. | Pattern 2 caveat, Pitfall 3 | If `sourceSystem` becomes configurable, the constant threading must follow it. Currently hard-coded — LOW risk, but flagged for the planner to thread explicitly. |
| A3 | The golden-watch oracle's cycle-1 staged count equals the page-1 fixture corpus size and is stable. | Pitfall 1 | If the fixture corpus changes the FLIP arithmetic shifts, but the test reads `stagedCycleOne` dynamically — LOW risk. |

## Open Questions

1. **Skip result representation in the `ingestPage` fan-out**
   - What we know: the fan-out returns `{ index, rawResult, stagingResult }` and tallies both.
   - What's unclear: whether the planner models a skip as a new discriminant in `SettledCandidate` or as a synthetic skipped-raw result.
   - Recommendation: a dedicated skip discriminant + `tallySkip` — cleanest, keeps `stored`/`staged`/`failed` semantics intact and the new counter isolated.

2. **Pre-fetch check: new repository method vs inline SELECT** (CONTEXT discretion)
   - Recommendation: a lean `existsBySourceIdentity(sourceSystem, sourceReplayId): Promise<boolean>` on `PostgresStagingRepository` using `SELECT 1 ... LIMIT 1` — testable in isolation, no extra columns, keeps the SQL in the write-scope adapter band.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | 25.9.0 | — |
| Docker (testcontainers) | conflict-classification + golden-watch integration tests | assumed ✓ (existing integration tests rely on it) | — | tests `skipIf`-guard when fixtures/Docker absent (see `golden-watch` `test.skipIf`) |
| PostgreSQL (ephemeral via testcontainers) | integration tests | via Docker | postgres:17-alpine | — |
| MinIO (ephemeral via testcontainers) | golden-watch oracle | via Docker | RELEASE.2025-09-07 | — |

**Missing dependencies with no fallback:** none (Docker is the existing integration-test assumption).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.5` + V8 coverage (100% reachable-source gate) |
| Config file | (project root vitest config — existing) |
| Quick run command | `pnpm vitest run src/staging src/run/ingest-page.test.ts src/run/summary.test.ts` |
| Full suite command | `pnpm vitest run` (or the repo's `verify` script) |

### Phase Requirements → Test Map
| Req ID | Behavior (observable signal) | Test Type | Automated Command | File Exists? |
|--------|------------------------------|-----------|-------------------|--------------|
| DEDUP-01 | "cannot miss a new record" — every untrustworthy/absent/empty/whitespace `externalId` → FETCH; only present-AND-known + existing row → SKIP | unit property table (`test.each`) | `pnpm vitest run src/run/ingest-page.test.ts` | ❌ Wave 0 (new cases in existing file) |
| DEDUP-01 | Watch cycle ≥2 issues NO byte fetch for a known `externalId`; `skippedBySourceId` incremented | golden-oracle (testcontainers PG + MinIO) | `pnpm vitest run src/run/golden-watch.integration.test.ts` | ✅ exists — must be FLIPPED |
| DEDUP-02 | No-new-replay cycle → only page-1 list fetch; distinct `skippedBySourceId` counter in summary | unit (summary) + golden-oracle | `pnpm vitest run src/run/summary.test.ts src/run/golden-watch.integration.test.ts` | ✅/❌ Wave 0 (counter cases) |
| DEDUP-03 | Benign exact re-stage → quiet (no throw, no conflict row); same-id/diff-checksum → surfaces as `conflict` (NOT swallowed) | testcontainers-integration | `pnpm vitest run src/staging/postgres-staging-repository.integration.test.ts` | ✅ exists — add conflict-not-swallowed case |
| DEDUP-03 | `ON CONFLICT DO NOTHING RETURNING id` returns 0 rows on benign dup → `already_staged` with resolved id | unit + testcontainers-integration | `pnpm vitest run src/staging/postgres-staging-repository.test.ts` | ✅ exists — update for new path |

### Mandatory validation signals (per nyquist_validation directive)
- **The data-loss "cannot miss" property test** (DEDUP-01): a parameterized `test.each` over the id-state matrix in Pattern 2, asserting `skip ⟹ trustworthy id` (contrapositive: untrustworthy ⟹ fetch). This is the data-loss gate.
- **The §B conflict-not-swallowed integration test** (DEDUP-03): testcontainers PostgreSQL — same-`source_replay_id`/different-checksum insert must still produce `status: "conflict"` after the `ON CONFLICT` rewrite (proves the conflict path is not swallowed).

### Sampling Rate
- **Per task commit:** quick run (the staging + ingest-page + summary unit tests).
- **Per wave merge:** full suite incl. testcontainers integration tests.
- **Phase gate:** full suite green + 100% V8 coverage (no new `v8 ignore`) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/run/ingest-page.test.ts` — add the `test.each` data-loss matrix (TEST-03 aligned) covering present-known / present-unknown / empty / whitespace / absent `externalId`.
- [ ] `src/staging/postgres-staging-repository.integration.test.ts` — add the conflict-not-swallowed case (same-id/diff-checksum → `conflict`) and the benign empty-rows → `already_staged`-with-id case.
- [ ] `src/run/golden-watch.integration.test.ts` — FLIP the re-download assertion (cycles ≥2: zero `fetchBytes`, `skippedBySourceId` asserted).
- [ ] `src/run/summary.test.ts` — assert the new `skippedBySourceId` counter in `emptyCounts` and `countRun`.
- [ ] Fake-timers (`vi.useFakeTimers()`) for any new watch-loop timing assertion (TEST-04) — the existing golden-watch uses injected `sleep`/`createPacer` fakes (no real timers), keep that pattern.

## Security Domain

> `security_enforcement` not explicitly false; this phase touches a SQL write path.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | The new `ON CONFLICT` insert and the pre-fetch SELECT MUST use parameterized queries (`$1,$2,...`) — the existing repository already does this; do not interpolate `sourceSystem`/`externalId` into SQL text. |
| V6 Cryptography | no | No crypto change (checksum is existing sha256 in `storage/checksum.ts`). |
| V2/V3/V4 Auth/Session/Access | no | CLI ingest job, no user-facing auth surface. |

### Known Threat Patterns for the staging adapter

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via `externalId`/`sourceSystem` in the existence check | Tampering | Parameterized `pg` query (`SELECT 1 ... WHERE source_system=$1 AND source_replay_id=$2`); never string-build SQL. |
| Conflict swallowing → server-2 misses a manual-review case | Repudiation / Tampering of business state | Target `ON CONFLICT` on `(checksum, object_key)` ONLY; keep the 23505→`classifyExistingStaging`→`conflict` path (the §B invariant). |
| Silent data loss (skip a new replay) | Denial of evidence | Trustworthy-id-only skip + checksum backstop + the "cannot miss" property test + the distinct `skippedBySourceId` counter (auditable). Human-in-the-loop review REQUIRED before production-staging ship (CONTEXT risk summary). |

## Sources

### Primary (HIGH confidence)
- Current fetcher source (read this session): `src/staging/postgres-staging-repository.ts`, `src/staging/payload.ts`, `src/staging/types.ts`, `src/types/staging.ts`, `src/staging/staging-schema.fixtures.ts`, `src/run/ingest-page.ts`, `src/run/watch-loop.ts`, `src/run/run-once-page.ts`, `src/run/summary.ts`, `src/types/run-summary.ts`, `src/commands/watch.ts`, `src/discovery/discover-dedup.ts`, `src/discovery/html.ts`, `src/run/golden-watch.integration.test.ts`, `src/staging/postgres-staging-repository.integration.test.ts`.
- server-2 cross-app source (read this session, read-only): `~/Projects/SolidGames/server-2/src/infra/db/migrations/0001_v1_domain_schema.sql:103-120` (two unique constraints), `src/modules/ingest/service.ts` (`markStagingConflicted`/`markStagingPromoted`).
- `solidstats-fetcher-ts-conventions/SKILL.md` (§A bands, §A.4 idempotency = unique key + ON CONFLICT, §B invariants, §D run summary).

### Secondary (MEDIUM confidence)
- [CITED: postgresql.org/docs/current/sql-insert.html] — `ON CONFLICT DO NOTHING` + `RETURNING` returns only successfully inserted rows; a skipped conflict yields zero rows. (Confirmed via WebFetch against official docs; the research-store seam rated the provider LOW, but the claim is from the authoritative source, hence CITED/MEDIUM.)

### Tertiary (LOW confidence)
- none.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all verified against `package.json` and existing imports.
- Architecture (where the gate goes, run-once parity, conflict path): HIGH — traced directly through current source (`ingestPage` shared by both callers; conflict path preserved).
- ON CONFLICT/RETURNING mechanic: HIGH (claim) / MEDIUM (provenance tag) — confirmed against official PostgreSQL docs.
- Data-loss matrix: HIGH — derived from `toSourceReplayId` + `html.ts` externalId provenance in current source.
- Pitfalls: HIGH — each tied to a specific line in current source.

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (stable domain; PostgreSQL ON CONFLICT semantics are long-stable; source-tree references valid until the files change).

---

## Skill files read (skill-chain confirmation)

- `.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md` — read in full.
- `.agents/skills/solidstats-shared-backend-ts-standards/references/correctness-and-quality.md` — read in full (the mandatory reference for the backend standards skill: External adapters, async safety, process lifecycle, LSP, SOLID/DRY, §Z/§AA/§AB, code-quality bugs).
- `.agents/skills/solidstats-shared-project-standards/references/ci-cd-pattern.md` — NOT read (CI/CD pattern reference; not relevant to this dedup/staging code phase — no CI pipeline change in scope).
