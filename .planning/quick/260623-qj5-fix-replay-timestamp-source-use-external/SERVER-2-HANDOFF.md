# Hand-off → server-2: `replay_timestamp` semantics changed (epoch-primary, true UTC)

**From:** replays-fetcher, quick task `quick-260623-qj5` (landed on `gsd/v3.1-milestone`, merging to `master`).
**To:** a server-2 maintainer/agent.
**Type:** cross-app value-semantics change. **No schema change** — same field, same type.
**Status:** fetcher side done (verify + golden integration green). Server-2 actions below are OPEN.

---

## TL;DR

The fetcher now stages a **corrected** `replay_timestamp`. The value's *meaning* changed; its
column/type did not. Two things are needed on the server-2 side:

1. **Backfill** already-staged / already-promoted rows from the `externalId` epoch (existing rows
   still hold the old, wrong-timezone value).
2. **Confirm the read-path** (`replays.replay_timestamp` consumers + `web` display) treats the
   column as a **true UTC instant**.

Until the backfill runs, the column is a **mix of two conventions** (old rows ≈UTC+1 stamped as
UTC; new rows true UTC) — a ~1 hour skew on old rows, larger where the old value came from the
filename (a different event entirely).

---

## What changed and why

The fetcher's `replay_timestamp` (staged into `ingest_staging_records.replay_timestamp`, promoted to
`replays.replay_timestamp`) used to be:

```
replayTimestampFromFilename(sourceFilename) ?? discoveredAt(listing "Game date")
```

Both inputs are **server-local wall-clock (≈UTC+1) stamped as UTC**, and the filename one is the
**wrong event** (file-write / game-end, not game-start). Evidence from real captured data:

| Source | Value | Meaning |
|--------|-------|---------|
| `externalId` epoch `1781460116` | 2026-06-14 **18:01:56 UTC** | true UTC (epoch) — game start (inferred) |
| listing "Game date" cell | 14.06.2026 **19:01** (= epoch +1h) | game start, server-local ≈UTC+1 |
| download filename `…__21_25_22` | **21:25:22** | file-write / game-end, server-local |

The source identifies each replay as `/replays/{id}` where `{id}` is a **Unix epoch in seconds** —
the only unambiguous UTC instant the system carries. The fetcher now uses it as PRIMARY:

```
epochToUtcIso(externalId) ?? replayTimestampFromFilename(sourceFilename) ?? discoveredAt
```

The filename/listing fallbacks remain only for the rare id-less / non-epoch candidate.

**Caveat (accepted by the maintainer):** the epoch is *inferred* to be game-start. It could be
upload-time. Either way it is a true UTC instant and strictly better than file-write-local-as-UTC;
true game-start is unrecoverable from the data. Do not "correct" it with an offset.

Fetcher commits: `244f4dc` (parser), `2fb54a6` (precedence), `66aaad4` (golden oracle), `ac5137d`
(test nit). Parser: `replays-fetcher/src/time/epoch-to-utc-iso.ts`.

---

## How to recompute the correct value

The corrected value is a pure function of the epoch id, which server-2 already has on every staged
row:

- `ingest_staging_records.source_replay_id` **is** the `externalId` for the normal case (it equals
  the epoch string). Derived ids are prefixed `derived:` (no epoch available — leave those alone).
- `promotion_evidence.sourceExternalId` carries the same epoch when present.

Corrected value, in code terms:

```
replay_timestamp = new Date(Number(source_replay_id) * 1000)   // when source_replay_id is an in-range numeric epoch
```

**Range guard (must match the fetcher exactly):** accept only a clean integer-seconds string with
`1420070400 <= n <= 2051222400` (2015-01-01 .. 2035-01-01, inclusive). Anything else (non-numeric,
`derived:` id, out of range) → no epoch; keep the existing value.

Illustrative backfill (adapt to the real server-2 schema/migration tooling — names below are
indicative, server-2 owns the actual DDL/migration path):

```sql
-- Only rows whose source_replay_id is an in-range numeric Unix-epoch-seconds string.
UPDATE replays
SET    replay_timestamp = to_timestamp(source_replay_id::bigint)   -- to_timestamp() yields a UTC instant
WHERE  source_replay_id ~ '^\d+$'
  AND  source_replay_id::bigint BETWEEN 1420070400 AND 2051222400;
-- derived:* ids and out-of-range ids are intentionally NOT touched.
```

Decide whether to backfill at the `replays` level, the staging level, or both, per server-2's
promotion model. Snapshot / make it reversible — this rewrites historical timestamps.

---

## Read-path confirmation (the second half)

Backfill alone is not enough — confirm nothing downstream re-applies a timezone:

- `replays.replay_timestamp` is a **UTC instant**. Any consumer that formats it for display must
  render it as UTC (or convert explicitly to the viewer's TZ), not assume server-local.
- `web` game-time display: verify it shows the epoch-derived UTC correctly after backfill.
- If any server-2 logic previously compensated for the old ≈UTC+1 skew (an offset somewhere), that
  compensation must be **removed** — the value is now correct at the source.

---

## Acceptance

- [ ] Backfill executed (reversible/snapshotted); spot-check a few rows: `replay_timestamp ==
      to_timestamp(source_replay_id)` for in-range numeric ids; `derived:`/out-of-range rows
      unchanged.
- [ ] `web` shows corrected game times; no double-offset, no server-local assumption.
- [ ] Any old skew-compensation in server-2 removed.
- [ ] This change reflected in server-2's own planning/state (and the v3.1 DISC-02 cross-app gate
      in replays-fetcher `STATE.md` can then be closed).

## Context pointers

- replays-fetcher `STATE.md` → Decisions (`quick-260623-qj5`), Blockers/Concerns (cross-app
  server-2), Open Gates (DISC-02 / T-25-03 superseded).
- This quick task: `.planning/quick/260623-qj5-fix-replay-timestamp-source-use-external/`
  (`CONTEXT.md` has the locked decisions + the full evidence table; `SUMMARY.md` the outcome).
- Boundary reminder: the fetcher writes staging only; server-2 owns `replays`, promotion, and any
  backfill. This hand-off does not authorize fetcher writes to server-2 tables.
