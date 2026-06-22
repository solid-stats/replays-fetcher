# Phase 25: Discovery Game-Date Capture (Cross-App Gated) - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning — the "hard blocker" is RESOLVED from server-2 source (see below)
**Source:** Assumptions mode — orchestrator-gathered cross-app evidence (server-2 read directly)

<domain>
## Phase Boundary

Second (and final) intentional behavior change of v3.1. The discovery listing exposes a "Game date"
cell (`DD.MM.YYYY HH:MM`); today the fetcher does NOT parse it (golden-e2e comment, see refs).

- **DISC-01 (local, no cross-app risk):** parse the listing "Game date" cell → ISO-8601 timestamp,
  threaded into discovery candidate metadata.
- **DISC-02 (cross-app, was flagged "hard blocker"):** the parsed game-date populates the canonical
  field server-2 consumes, and the golden oracle assertion pinning the field's ABSENCE is flipped to
  assert the concrete value.

In scope: the discovery listing parser (`src/discovery/*` — where the candidate row is built from the
HTML listing), the candidate→payload thread (`src/staging/payload.ts`), and the golden e2e oracle.
NOT in scope: any server-2 mutation, any parsing of replay CONTENTS (the "Game date" is a LISTING
cell, not replay bytes — boundary-safe).
</domain>

<decisions>
## Implementation Decisions

### DISC-02 cross-app contract — RESOLVED from server-2 source (the "blocker" is retired)
Read directly from `~/Projects/SolidGames/server-2`:
- **The canonical replay-date field is `replay_timestamp` (timestamptz), NOT `promotion_evidence.discoveredAt`.**
  - server-2 stores `promotion_evidence` as OPAQUE jsonb (`promotion_evidence || $2::jsonb`) and reads
    `discoveredAt` NOWHERE (zero grep hits in server-2/src). So `discoveredAt` is pure audit metadata —
    populating it is harmless and additive, but it is NOT the canonical value web/stats consume.
  - server-2 DOES consume the staging `replayTimestamp` column (ingest route schema:
    `Type.String({format:"date-time"}) | Null`) via `resolveReplayTimestamp` (=
    `staging.replayTimestamp ?? deriveReplayTimestampFromSourceId(sourceReplayId)`) → writes
    `replays.replay_timestamp`, which is indexed (`idx_replays_rotation_timestamp`) and read by web/stats.
- **Format:** ISO-8601 / `timestamptz`. **Read-path:** staging.replay_timestamp → replays.replay_timestamp → web.
- **No open server-2 question remains** on field/format/read-path — all three are materialized in source.

### Field-mapping decision (LOCKED, grounded in the existing fetcher)
- The fetcher ALREADY populates `replay_timestamp` from the source FILENAME via
  `replayTimestampFromFilename` (`payload.ts:52`), interpreting it as **UTC** (`...T..:..:...000Z`,
  payload.ts:67). This convention is already shipped and live.
- **The listing "Game date" is a FALLBACK source for `replay_timestamp`, applied only when the
  filename pattern is absent** (filename stays primary). This mirrors server-2's own fallback chain
  (`replayTimestamp ?? deriveFromSourceId`). The listing game-date must NOT override a filename-derived
  timestamp — that would silently rewrite an existing, trusted value.
- The parsed game-date is ALSO recorded in `promotion_evidence` (as `discoveredAt`, matching the
  golden-e2e comment's framing) for audit lineage — but that is evidence, not the canonical path.

### Timezone (LOCKED to the existing precedent — with a ship-gate flag)
- Parse `DD.MM.YYYY HH:MM` as **UTC** (`.000Z`), identical to the established
  `replayTimestampFromFilename` convention. This introduces NO new TZ decision — it reuses the one
  already live for filename timestamps.
- **Ship-gate flag (residual risk):** if the sg.zone listing actually renders "Game date" in a LOCAL
  server timezone (not UTC), the UTC assumption is off by the offset and would write skewed canonical
  timestamps. The existing filename path carries the identical assumption, so this is a pre-existing
  convention, not a new risk — but a human should confirm the listing's TZ before/at production ship.
  Surface in VALIDATION Manual-Only + STATE, do not auto-close.

### Claude's Discretion
- Exact regex/parser for `DD.MM.YYYY HH:MM` (reuse the `date-fns` already in the stack if present;
  otherwise a lean explicit parse mirroring `replayTimestampFromFilename`).
- Whether the listing-date parse lives in the discovery HTML parser or in `payload.ts` alongside the
  filename fallback. Prefer: parse in discovery (→ `candidate.gameDate`/metadata), apply the fallback
  in `payload.ts` next to `replayTimestampFromFilename` so both timestamp sources sit together.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Fetcher (this repo)
- `src/staging/payload.ts` — `replayTimestampFromFilename` (UTC precedent), `basePayload`
  replayTimestamp wiring, `toPayload` promotion_evidence (incl. the `discoveredAt` branch).
- `src/discovery/discover-candidate.ts` — the candidate type already carries `discoveredAt?` /
  metadata; the listing parse threads the game-date here.
- The discovery listing HTML parser (the module that builds a candidate row from the listing) — find
  where the row cells are read; "Game date" is a sibling cell to the ones already parsed.
- `src/run/golden-e2e.integration.test.ts` (~L210-216) — the assertion
  `expect(row.promotion_evidence.discoveredAt).toBeUndefined()` + the comment "Real sg.zone discovery
  does not parse the listing game-date column." This is the oracle DISC-02 FLIPS (updated, not loosened).
- `src/types/staging.ts` — `replayTimestamp?: string` on the payload.

### server-2 (cross-app, read-only evidence)
- `~/Projects/SolidGames/server-2/src/modules/ingest/replay-timestamp.ts` — `resolveReplayTimestamp`
  (`replayTimestamp ?? deriveReplayTimestampFromSourceId`) — proves staging.replayTimestamp is the
  canonical input.
- `~/Projects/SolidGames/server-2/src/modules/ingest/routes/routes.ts:84` — the staging
  `replayTimestamp: date-time | null` contract.
- `~/Projects/SolidGames/server-2/src/infra/db/migrations/0001_v1_domain_schema.sql` (replay_timestamp
  columns + `idx_replays_rotation_timestamp`) and `0011_backfill_replay_timestamp_from_source_id.sql`
  (the source-id epoch fallback) — confirms the canonical field + the fallback philosophy.
- Confirm (grep) that server-2 reads NO `promotion_evidence.discoveredAt` — it is opaque audit jsonb.
</canonical_refs>

<specifics>
## Specific Ideas

- DISC-01 parser unit tests: valid `DD.MM.YYYY HH:MM` → correct UTC ISO; malformed/empty cell →
  undefined (fall through, never throw — §AA: log at debug if a present-but-unparseable cell appears).
- DISC-02 fallback test: filename-derived timestamp WINS when both present; listing game-date used
  ONLY when filename pattern absent; neither present → replayTimestamp stays undefined (server-2 then
  derives from sourceId).
- Golden e2e oracle flip: the fixture listing now carries a parseable "Game date"; assert the promoted
  row's `replay_timestamp` (and/or `promotion_evidence.discoveredAt` audit) carries the concrete UTC
  value instead of the old "undefined" assertion. UPDATE the oracle, do not loosen it.
</specifics>

<deferred>
## Deferred Ideas

- Listing-TZ confirmation (UTC vs local) — carried as a ship-gate flag, not dev work (see Decisions).
- Any reconciliation/cross-check warning when filename-derived and listing-derived timestamps DISAGREE
  — nice-to-have observability, out of scope unless the planner finds it trivial.
</deferred>

<risk_summary>
## Risk Summary

- **Canonical-data correctness (DISC-02):** writing the wrong field would make the game-date invisible
  to web/stats. Mitigated: the canonical field is proven to be `replay_timestamp` (server-2 reads it;
  discoveredAt is ignored). Listing game-date is a FALLBACK (never overrides the filename), so an
  existing trusted timestamp is never rewritten.
- **Timezone skew:** the UTC assumption is inherited from the live filename convention; a human should
  confirm the listing TZ at ship (flag, not blocker).
- **Oracle drift:** flip the golden assertion to the concrete value; never loosen to pass.
- **Boundary:** "Game date" is a LISTING cell, not replay bytes — parsing it does NOT violate the
  no-parsing invariant. Keep the parse in discovery, never decode replay content.
</risk_summary>

---

*Phase: 25-discovery-game-date-capture-cross-app-gated*
*Context gathered: 2026-06-20 via assumptions mode (orchestrator cross-app evidence; DISC-02 blocker retired from server-2 source)*
