# Quick Task 260617-tvn: Golden end-to-end integration test (run-once + watch) — Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Task Boundary

Build a golden end-to-end integration test that pins the **current correct behavior** of the
full ingest pipeline, to serve as the behavioral regression oracle **before** the upcoming
fetcher refactor (god-file splits in `run-once.ts`, `discover.ts`, `source-client.ts`,
`replay-byte-client.ts`; shared S3/pg client at composition root; etc.).

The test is the safety net: a pure-move refactor that preserves behavior must keep this test
green. It complements the existing `verify` net (100% coverage, depcruise, knip) by catching
behavioral drift the unit suite could miss.

Two golden scenarios: `run-once` and `watch`.
</domain>

<decisions>
## Implementation Decisions (LOCKED — settled with user, do not revisit)

### Fixture scope
- Capture **10 real listing pages** from the source (sg.zone) + the **real replay bytes of every
  replay** on those pages. Store as **gzip** fixtures (OCAP is JSON, compresses well).
- Fixtures follow the repo convention (recorded fixtures alongside test infra; `*.fixtures.ts`
  loaders). Real captured HTML + real byte blobs are fixture data files, not inline blobs.

### Substitution seam (what is faked vs. real)
- Fake **only the source**, via the clean DI surface in `BuildCliDependencies`
  (`src/commands/shared.ts`):
  - `createSourceClient` → fake `SourceClient` whose `fetchText(url) => string` returns the
    recorded real page HTML.
  - `createReplayByteClient` → fake `ReplayByteClient` whose `fetchBytes(url) => Uint8Array`
    returns the recorded real replay bytes keyed by url/externalId.
- Rationale: AGENTS rule — do not hammer the production-like source from CI. Source is replayed
  offline from fixtures; everything downstream is the real path.
- **Real infrastructure:** PostgreSQL + MinIO via **testcontainers** (same pattern as
  `src/storage/s3-raw-storage.integration.test.ts`). Files named `*.integration.test.ts`.

### run-once scenario assertions
Run `runOnce` through real DI capabilities with the source on fixtures. Assert:
- candidates parsed from the real HTML (count + identity),
- objects stored in MinIO with correct object-key + checksum,
- staging rows with **full source evidence** (externalId, url, discoveredAt, checksum,
  objectKey, size, status),
- `RunSummary` counts,
- **idempotency**: a second run = stored 0 / staged 0 / dup N (the `ON CONFLICT` path),
- evidence object written.

### watch scenario assertions
Run `runWatchLoop` driven by its **own injected seams** — `sleep` / `shouldStop` / `createPacer` /
`createRunId` — to advance exactly N cycles deterministically with **no real sleeps**. Do NOT use
`vi.useFakeTimers()` and do NOT wire the real `createShutdownSeam` (it registers real SIGTERM
listeners → cross-test leaks). Rationale: the watch loop already exposes these seams for testing;
using them is idiomatic and avoids the real-Promise-await conflicts `vi.useFakeTimers()` hits in
this loop (per RESEARCH §4). This supersedes the earlier "vi fake timers" wording — the intent
("test watch deterministically, no real sleeps") is unchanged; only the mechanism is the loop's own
seams. Source serves page-1 fixtures across cycles. Assert:
- cycle 1: stored N / staged N,
- subsequent cycles: dup N (current checksum-after-download behavior — this is the behavior the
  oracle pins; the dedup-before-fetch optimization is separate tech-debt, NOT changed here),
- pacing/interval respected,
- clean shutdown, no leaks.

### Fixture capture (BLOCKER — needs human)
- Capturing real fixtures needs live source access (`.env` creds/transport), which the agent is
  denied by permission settings. The task must produce a **deterministic capture script/command**
  for the user to run manually under `!`, then write the test against the saved fixtures.
- The test itself must NOT require live source access — it runs purely against committed fixtures
  + testcontainers.

### Claude's Discretion
- Exact fixture file layout/naming, loader shape, gzip helper, and test helper/builders — follow
  `solidstats-fetcher-ts-tests` + `solidstats-shared-testing-standards` and existing repo patterns.
- Whether watch + run-once share a fixture loader / harness module.
</decisions>

<specifics>
## Specific Ideas

- Reference harness: `src/storage/s3-raw-storage.integration.test.ts` (MinIO testcontainer setup).
- DI injection point: `BuildCliDependencies` in `src/commands/shared.ts`.
- Contracts: `SourceClient.fetchText(url)` (`src/discovery/types.ts`),
  `ReplayByteClient.fetchBytes(url)` (`src/storage/replay-byte-client.ts`).
- Entry points under test: `runOnce` (`src/run/run-once.ts`), `runWatchLoop`
  (`src/run/watch-loop.ts`).
</specifics>

<canonical_refs>
## Canonical References

- Skills: `solidstats-fetcher-ts-tests` (harness/layout/coverage), `solidstats-fetcher-ts-conventions`
  (ingest-boundary invariants: source evidence, idempotency, write-scope), `solidstats-shared-testing-standards`.
- `AGENTS.md` — mocked/fixture tests before touching production-like sources; 100% reachable-source coverage.
- Tech-debt backlog this oracle protects: `../plans/replays-fetcher/TECH-DEBT.md` (god-file splits) and
  `../plans/replays-fetcher/briefs/fetcher-architecture-code-followups.md` (shared S3/pg client).
</canonical_refs>
