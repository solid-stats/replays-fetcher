# V2 Full-Run Findings

## Reader and action

Reader: the engineer drafting the next `replays-fetcher` v2 milestone.

Post-read action: convert these findings into v2 requirements, phases, and
acceptance criteria for reliable full-corpus ingest.

## Evidence snapshot

The staging full-run on 2026-05-11 used the source corpus at `sg.zone/replays`.
The source exposed 786 list pages with about 30 replay rows per page, or roughly
23.5k replay candidates.

The streamed full-run Job was `replays-fetcher-fullrun-stream-202605111032`.
It used image
`ghcr.io/solid-stats/replays-fetcher:8395fbc58df3422a235d0a198e34eaf460491f21`
and `REPLAY_SOURCE_MAX_PAGES=786`.

Kubernetes created two pod attempts:

| Attempt | Runtime | Result | Discovered | Stored | Staged | Duplicate/already staged | Failure |
|---------|---------|--------|------------|--------|--------|---------------------------|---------|
| 1 | 2026-05-11T10:33:55Z to 2026-05-11T13:00:48Z | failed | 3840 | 3802 | 3810 | 30 | `source_unavailable` on `https://sg.zone/replays?p=129` |
| 2 | 2026-05-11T13:00:59Z to 2026-05-11T17:47:32Z | failed | 7740 | 3900 | 3900 | 3840 | `source_unavailable` on `https://sg.zone/replays?p=259` |

The second attempt restarted from page 1. Existing raw objects and staging rows
prevented duplicate durable writes, but the source discovery work was repeated.

## Findings

### Source failures abort the whole run

`source_unavailable` means the source page or detail page could not be fetched.
The current error path collapses most low-level failures into a generic
`Source request failed` diagnostic. It does not preserve enough detail to tell
whether the root cause was timeout, connection reset, DNS, TLS, proxy behavior,
Cloudflare, or an HTTP status other than 429.

V2 requirement candidate:

- Retry source list-page and detail-page requests with bounded exponential
  backoff.
- Preserve HTTP status, low-level error name/message, page number, and replay
  detail URL in diagnostics.
- Distinguish transient source failure from permanent malformed source data.

### Job retry starts from page 1

Kubernetes retry launched a second pod, but the application did not resume from
the last completed page or replay. The retry repeated all source reads from page
1 and spent hours rediscovering data already written to S3 and staging.

V2 requirement candidate:

- Persist full-run checkpoints: source page, candidate identity, raw object
  status, staging status, and completion timestamp.
- Allow a retry to resume at the first incomplete page or candidate.
- Make resume behavior explicit in the final run summary.

### Full-run discovery is too slow

The streamed implementation improved concurrency with `server-2` and parser
workers because each page is stored and staged before the next page starts.
However source discovery remains sequential and uses a default 2 second delay
between source requests. A full corpus needs one list page request plus detail
requests for each row, so the current approach is expected to run for many
hours.

V2 requirement candidate:

- Add a source-aware rate limiter with bounded concurrency.
- Keep operator-configurable request delay, but avoid hardcoding a delay that
turns a full corpus into an overnight job.
- Record pages per minute, candidates per minute, and estimated remaining time.

### Full-run page count is static

The operator had to set `REPLAY_SOURCE_MAX_PAGES=786` after manually inspecting
the source. That value will become stale as the source grows.

V2 requirement candidate:

- Discover the last page from source pagination at run start, or stop when a
  page has no replay rows.
- Include the discovered source range in the run summary.

### Final logs are too large and arrive too late

`run-once` emits one large JSON summary at the end. For thousands of candidates,
the pod logs became multi-megabyte JSON documents. Operators do not get compact
progress while the job is running, and parsing the final log is unnecessarily
expensive.

V2 requirement candidate:

- Emit compact progress events per page or batch.
- Keep final logs summarized by counts and failure categories.
- Store detailed per-candidate evidence in a durable artifact only when needed.

### Partial success is not first-class

The failed job still did useful work: thousands of raw replays were stored and
staged. The final job status is only failed, so an operator must manually inspect
logs and database counts to understand what completed.

V2 requirement candidate:

- Model full-run state as partial, complete, failed, or resumable.
- Make the final summary actionable: completed pages, failed page, retry
  command, durable counts, and next action.

### Source contract regressions need stronger guards

Earlier fixes corrected two source-contract issues:

- raw replay bytes must be fetched from the JSON data endpoint, not from the
  HTML detail page;
- replay timestamps must be derived and staged so downstream rotations can be
  resolved.

V2 requirement candidate:

- Keep fixture coverage for list page, detail page, raw JSON URL, missing
  external ID, missing filename, and timestamp derivation.
- Add an operator check that validates the source contract without writing S3
  or PostgreSQL state.

### App repositories must not deploy runtime wiring

The app repository previously had a workflow that SSHed into staging and applied
Kubernetes resources and runtime secrets. That was removed so the app now owns
verification and image publication only. The infrastructure repository owns
manifests, runtime secrets, and rollout orchestration.

V2 requirement candidate:

- Keep app CI limited to verify and publish image.
- Add a CI guard that fails if app workflows reintroduce `kubectl`, staging SSH,
  or Kubernetes Secret mutation.

## Reader-test checklist

A v2 milestone drafted from this document should answer:

- How does a full run resume after source failure?
- How does an operator see progress without reading huge logs?
- How does the fetcher prove it fetched JSON replay bytes, not HTML?
- How does the run avoid hardcoded source page counts?
- What is the maximum acceptable runtime for a full corpus?
