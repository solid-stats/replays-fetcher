# replays-fetcher v2 Milestone Brief: Full-Corpus Ingest Resilience

**Created:** 2026-05-12
**Intended command:** `$gsd-new-milestone --auto @gsd-briefs/v2-backend-parity-and-full-run.md`
**Application:** `replays-fetcher`
**Primary role:** second implementation milestone in the cross-app sequence

## Cross-App Briefs

Read these sibling briefs before drafting the milestone:

- `/home/afgan0r/Projects/SolidGames/server-2/gsd-briefs/v2-backend-parity-and-full-run.md`
- `/home/afgan0r/Projects/SolidGames/replay-parser-2/gsd-briefs/v2-backend-parity-and-full-run.md`
- `/home/afgan0r/Projects/SolidGames/infrastructure/gsd-briefs/v2-backend-parity-and-full-run.md`
- `/home/afgan0r/Projects/SolidGames/web/gsd-briefs/v2-backend-parity-and-full-run.md`

## Global Sequence

1. `server-2`: parity foundation, recalculation report, legacy public export, and diff contract.
2. `replays-fetcher`: resumable full-corpus ingest that can reliably feed the backend parity gate.
3. `infrastructure`: controlled full run, legacy snapshot, and evidence capture.
4. `web`: product UI after backend parity and API stability.

`replay-parser-2` remains a contract-support dependency. Do not change parser behavior from this milestone unless the `server-2` parity contract requires it.

## Goal

Make full-corpus replay ingest reliable enough that a failed source request or pod restart does not waste hours or leave operators guessing what completed.

The output of this milestone is durable full-run input for `server-2` parity and infrastructure diff readiness.

## Source Evidence

- `.planning/research/v2-full-run-findings.md`
- `.planning/quick/260511-stream-full-run-pages.md`
- `README.md`
- `/home/afgan0r/Projects/SolidGames/server-2/.planning/research/v2-full-run-findings.md`
- `/home/afgan0r/Projects/SolidGames/infrastructure/docs/full-run.md`
- `/home/afgan0r/Projects/SolidGames/infrastructure/docs/diff-readiness.md`

## Required Decisions Already Made

- `server-2` parity tools come first, but the final review gate requires a complete source corpus.
- `replays-fetcher` remains bounded to raw object storage and staging rows only.
- It must not create canonical replays, parse jobs, parser results, stats, identity rows, moderation records, or public API data.
- Full-run progress must be observable before the final log is emitted.
- Partial success must be first-class and resumable.

## Problem To Solve

The full-run attempt discovered and staged useful data but failed on source availability and restarted from page 1. Existing idempotency prevented duplicate durable writes, but source discovery work was repeated for hours. Final JSON logs were too large and too late to be an operator-friendly progress surface.

## Suggested Milestone Phases

### Phase 1: Source Failure Diagnostics and Retry Policy

Goal: source failures tell the operator what failed and whether retrying can help.

Acceptance criteria:

- Preserve HTTP status, low-level error name/message, page number, and detail URL where available.
- Distinguish transient source failures from permanent malformed source data.
- Add bounded retry/backoff for list-page and detail-page reads.
- Keep diagnostics free of secrets, raw replay bytes, and large HTML bodies.

### Phase 2: Checkpoint and Resume

Goal: a restarted full run resumes from the first incomplete page or candidate.

Acceptance criteria:

- Persist source page, candidate identity, raw object status, staging status, and completion timestamp.
- A retry can resume without rereading all completed pages.
- Final summary states whether the run is complete, partial, failed, or resumable.
- The summary includes the recommended next command or operator action.

### Phase 3: Dynamic Source Range and Rate Limiting

Goal: full-run scope is discovered and paced instead of hardcoded.

Acceptance criteria:

- Discover the last source page from pagination or stop on the first empty replay page.
- Remove reliance on manually hardcoded `REPLAY_SOURCE_MAX_PAGES` for normal full runs.
- Add source-aware bounded concurrency and operator-configurable delay.
- Emit pages per minute, candidates per minute, and estimated remaining time.

### Phase 4: Progress Events and Compact Evidence

Goal: operators can follow a run while it is running and inspect details only when needed.

Acceptance criteria:

- Emit compact progress events per page or batch.
- Keep final stdout summarized by counts and failure categories.
- Store detailed per-candidate evidence in a durable artifact only when explicitly enabled or needed.
- Preserve current secret-safety and boundary-safety guarantees.

### Phase 5: Source Contract Guards

Goal: regressions in source parsing do not silently poison a full run.

Acceptance criteria:

- Tests cover list page, detail page, raw JSON URL, missing external ID, missing filename, duplicate filename, changed metadata, and timestamp derivation.
- Add an operator check that validates source contract without writing S3 or PostgreSQL state.
- Prove raw replay bytes are fetched from the JSON data endpoint, not the HTML detail page.

## Dependencies On Other Apps

- Depends on `server-2` defining the full-run readiness report and any required staging evidence before this milestone finalizes checkpoint metadata.
- Feeds `infrastructure` controlled full-run orchestration.
- Must preserve `replay-parser-2` raw object key/checksum expectations.
- `web` should not consume fetcher status directly; UI-visible ingest status belongs behind `server-2` APIs.

## Non-Goals

- Do not parse replays.
- Do not publish RabbitMQ parse jobs.
- Do not mutate `server-2` business tables beyond the agreed staging table.
- Do not implement public stats comparison in this app.

## Recommended Next Command

Run this milestone after the first `server-2` parity milestone has defined the full-run status and export contracts.
