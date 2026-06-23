# Quick Task 260623-qj5: Fix replay timestamp source — use externalId Unix epoch (true UTC) - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Task Boundary

The canonical `replayTimestamp` written to staging (→ `server-2` `replays.replay_timestamp`) is derived from the wrong source and wrong timezone. Change the primary source to the `externalId` Unix epoch (a true UTC instant the fetcher already captures), with the existing filename / listing parses demoted to ordered fallbacks. Behavior change to the staged `replayTimestamp` value; cross-app (server-2 reads the field). Fetcher must still NOT parse replay contents.
</domain>

<decisions>
## Implementation Decisions (LOCKED — settled with maintainer 2026-06-23)

### Source precedence for `replayTimestamp`
- **PRIMARY: `externalId` Unix epoch → ISO UTC.** `externalId` is `/replays/{id}` where `{id}` is a Unix epoch (seconds). Verified: 100% of the golden corpus (90/90) are numeric epochs in range. Epoch is definitionally UTC → the only unambiguous UTC instant in the system.
- **FALLBACK 1: filename** (`replayTimestampFromFilename`) — kept for non-epoch / `derived:` ids. KNOWN-WRONG TZ (file-write time in server-local ≈UTC+1), documented, not relied upon.
- **FALLBACK 2: listing game-date** (`evidence.discoveredAt` from `parseGameDateToUtcIso`) — last resort, also server-local TZ.
- Rationale: epoch supersedes both wrong-TZ wall-clock sources; fallbacks only fire for the rare id-less candidate.

### Epoch parse + guard
- Parse `externalId` as integer seconds; range-guard (e.g. 2015-01-01 .. 2035-01-01 in epoch seconds). Out-of-range / non-numeric → skip to fallback. NEVER throw.
- Convert to ISO-8601 UTC (`new Date(sec*1000).toISOString()` or equivalent, `…Z`).

### discoveredAt (audit)
- `promotion_evidence.discoveredAt` stays as-is (listing value, audit jsonb; server-2 does NOT read it). It records "as displayed by source" (server-local ≈UTC+1) — document it is NOT a UTC claim. Do not delete; do not treat as a canonical UTC source.

### Golden oracle + tests
- Flip `golden-e2e.integration.test.ts` `replay_timestamp` assertions to the epoch-derived UTC value (UPDATE, not loosen).
- Tests via `solidstats-fetcher-ts-tests`: epoch parse/range matrix (valid epoch → ISO UTC; out-of-range/non-numeric → undefined→fallback); precedence (epoch beats filename beats listing); non-epoch id fallthrough. Hold 100% V8 coverage; no new `v8 ignore`.

### Cross-app (server-2) — maintainer-owned
- The staged `replayTimestamp` VALUE changes (corrected). Same field/type → NOT a schema change. server-2/web display corrected times going forward; already-staged rows keep old values (backfill is a separate server-2 decision, out of scope here).

### Caveat (accepted)
- We INFER `externalId`-epoch = game-start UTC (coherent across samples; OCAP has no internal wall-clock). It could be upload-time. Either way it is a true UTC instant and strictly better than file-write-local-as-UTC. True game-start is unrecoverable from the data; epoch is the best proxy. Accepted by maintainer.

### Claude's Discretion
- Exact module placement of the epoch parser (`src/time/` next to `components-to-utc-iso.ts`, or in `payload.ts`) — executor's call, per fetcher conventions (band rules; depcruise fences must stay green).
</decisions>

<specifics>
## Specific Ideas

Verified evidence (one replay `1781460116`, from real captured golden fixtures = exactly what the anonymous fetcher receives):

| Source | Value | Meaning |
|--------|-------|---------|
| `externalId` epoch `1781460116` | 2026-06-14 **18:01:56 UTC** | true UTC (epoch) — game start (inferred) |
| listing "Game date" cell | 14.06.2026 **19:01** (= epoch +1h) | game start in server-local TZ (≈UTC+1) |
| download filename `2026_06_14__21_25_22` | **21:25:22** | file-write/game-end in server-local TZ |

Second sample `1781457962`: epoch→17:26:02 UTC, listing 18:26 (also +1h) — consistent.
OCAP JSON header has NO absolute wall-clock (`captureDelay`, `endFrame`, frame-based) → the replay content cannot supply game time; epoch is the only clean UTC.

Touch points:
- `src/staging/payload.ts:61` `replayTimestampFromFilename`, and `:97` `replayTimestamp = replayTimestampFromFilename(...) ?? evidence.discoveredAt` — insert epoch-primary here.
- `externalId` is on the candidate source identity (`source.externalId`); confirm it flows into the staging payload builder input.
- `src/discovery/html.ts:49` `parseGameDateToUtcIso` (fallback 2 source); `src/time/components-to-utc-iso.ts` (UTC builder to reuse).
- `src/run/golden-e2e.integration.test.ts` golden oracle (flip).
</specifics>

<canonical_refs>
## Canonical References

- `.planning/milestones/v3.1-MILESTONE-AUDIT.md` — T-25-03 origin (was a deferred ship-gate; this task supersedes it).
- `.planning/milestones/v3.1-phases/25-discovery-game-date-capture-cross-app-gated/25-VERIFICATION.md` — DISC-01/02 prior behavior + the listing/discoveredAt wiring being revised.
- `.agents/skills/solidstats-fetcher-ts-conventions` + `…/solidstats-fetcher-ts-tests` + `solidstats-shared-backend-ts-standards/references/correctness-and-quality.md` — convention/test rules the executor must honor.
- Cross-app boundary: `solidstats-shared-project-standards` §D — staging schema/replay-date semantics require server-2 accounting (value-only change here; maintainer owns server-2).
</canonical_refs>
