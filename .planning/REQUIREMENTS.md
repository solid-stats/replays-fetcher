# Requirements: replays-fetcher — Milestone v3.1 Convention Compliance & Tech-Debt Closure

**Defined:** 2026-06-20
**Core Value:** Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.

> Behavior-preserving refactor/compliance milestone on a fully-tested ingest CLI. Two intentional behavior changes only: the watch pre-fetch dedup (DEDUP) and the discovery game-date capture (DISC). Every other requirement must leave the golden e2e oracle and 100% V8 coverage untouched. Scope source: the whole-repo convention audit (`pilot-v1.2-result.json`, 335 findings at `c850190` ≡ current source tree) tiered by verification trust, plus `replays-fetcher/TECH-DEBT.md` (TD1–TD5) and the architecture code-followups. The audit's semantic/architecture tier is ~50% false-positive (Haiku-verified); only the mechanical lane is near-100% precision. Architecture and correctness requirements therefore enter as leads that must be re-verified per-finding against live code during discuss/plan before any commit.

## v3.1 Requirements

Committed scope for this milestone. Each maps to exactly one roadmap phase.

### Architecture & Layer Compliance (ARCH)

- [x] **ARCH-01**: Cross-band data contracts (`ReplayCandidate`, `RawReplayStorageEvidence`, `RunSummary`/`CompactRunSummary`, `IngestStagingPayload`) live in the cross-cutting **`src/types/`** module at the bottom of the dependency graph (naming RESOLVED — see Pre-Plan Coordination); no band defines a type that another band imports upward. Builders stay in their owning bands — only the types move; per-band `types.ts` keep band-local types only.
- [x] **ARCH-02**: The `config.ts` upward import of `SourceTransport` from `discovery/` is removed; `config.ts` depends on nothing upward.
- [x] **ARCH-03**: The `no-leak.ts` orphan module is resolved (wired or removed); knip reports no orphans.
- [x] **ARCH-04**: Exactly one `S3Client` and one `pg.Pool` are constructed in `src/`, built at the `commands/` composition root and injected; all `*FromConfig` convenience factories are removed (grep proves one constructor each).
- [x] **ARCH-05**: The `watch` daemon drains the `pg.Pool` and destroys the `S3Client` on SIGTERM/SIGINT before exit; adapters never tear down injected clients.
- [x] **ARCH-06**: The five-band import fences (downward-only, no band-skip, PG write-scope, S3 write-scope, no-parser, discovery-read-only, diagnostics-never-write, composition-root exemption) are enforced by `.dependency-cruiser.cjs` inside `verify` and proven by a planted-violation test.

### God-File Decomposition (SPLIT)

- [x] **SPLIT-01**: `src/run/run-once.ts` is split within its band into cohesive modules; its file-level `oxlint-disable max-lines` is removed and never re-added.
- [x] **SPLIT-02**: `src/discovery/discover.ts` is split within its band; its `max-lines` suppression is removed.
- [x] **SPLIT-03**: `src/discovery/source-client.ts` is split within its band; its `max-lines` suppression is removed.
- [x] **SPLIT-04**: `src/storage/replay-byte-client.ts` is split within its band; its `max-lines` suppression is removed.

### Mechanical Convention Cleanup (MECH)

- [x] **MECH-01**: All `interface` declarations that should be `type` are converted (~138 sites) and the conversion is enforced by an oxlint `consistent-type-definitions: ["error","type"]` rule so it cannot regress.
- [x] **MECH-02**: Import ordering is normalized (~17 sites) and enforced by `oxfmt sortImports` (configured in the shared `@solid-stats/ts-toolchain` preset).

### Watch Ingest Latency & Source Load (DEDUP)

- [x] **DEDUP-01**: The `watch` page-1 cycle skips a candidate whose `source_replay_id` already exists in staging BEFORE fetching its bytes; absent/empty/ambiguous ids fall through to fetch; byte-checksum dedup remains as the backstop (a genuinely-new replay can never be dropped).
- [x] **DEDUP-02**: A no-new-replay watch cycle performs only the page-1 list fetch (no redundant byte downloads), reported via a distinct `skipped-by-source-id` run-summary counter.
- [x] **DEDUP-03**: Staging dedup uses `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING` for the benign duplicate (ending the postgres duplicate-key ERROR log spam); the conflicting-duplicate (same source id, different checksum) manual-review classification is preserved.

### Discovery Completeness (DISC) — cross-app gated on server-2

- [x] **DISC-01**: Discovery parses the listing "Game date" cell (`DD.MM.YYYY HH:MM`) into an ISO-8601 timestamp threaded into candidate metadata.
- [x] **DISC-02**: The parsed game-date populates the canonical field — staging `replayTimestamp` as a strict filename-fallback plus `promotion_evidence.discoveredAt` audit evidence — and the golden oracle assertion that pinned the field's absence is flipped to assert the concrete UTC value. Cross-app gate resolved from server-2 source; residual listing-timezone confirmation (T-25-03) is a manual ship-gate.

### Correctness Hygiene (CORR)

- [x] **CORR-01**: Each verified typed-error / unexplained-cast / swallowed-error finding from the convention audit (semantic tier, re-verified live against current source) is fixed; no raw `Error` is thrown where a typed `AppError` subclass is required, and no audit false-positive is committed as a change.

### Test-Quality (TEST)

- [x] **TEST-01**: AAA arrange/assert duplicated literals are factored into named constants or typed builders.
- [x] **TEST-02**: Multi-behavior tests are split to one behavior per test (RITE).
- [x] **TEST-03**: Dedup / conflict / date-parse matrices use `test.each` parameterized tables.
- [x] **TEST-04**: Watch-loop timing paths use `vi.useFakeTimers()` — no real sleeps in tests.
- [x] **TEST-05**: Untested reachable branches are closed by new tests; no new `v8 ignore` coverage suppressions are added.

## Pre-Plan Coordination (resolve before the gated phases — not new requirements)

| Item | Gates | Owner / Action |
|------|-------|----------------|
| Contracts home naming: `contracts/` vs `types/` | ARCH-01 | **RESOLVED 2026-06-20 → `src/types/`.** Conventions skill §A already names the cross-cutting band `types/` (signed off) and `src/types/run-summary.ts` is the existing seed; keeping `types/` needs no vendored-skill or depcruise change. `contracts/` was rejected: its only edge is naming clarity, which does not justify diverging from signed-off §A or a cross-repo skill edit inside a milestone whose purpose is closing code↔skill gaps. Action: move scattered cross-band contracts into `src/types/`; per-band `types.ts` keep band-local types. |
| Canonical replay-date field (`promotion_evidence.discoveredAt` vs `replay_timestamp`), format, timezone, `web` read-path | DISC-02 | Synchronous question to `server-2` (hard blocker; DISC-02 may slip to v3.2) |
| `ON CONFLICT` benign-vs-conflicting semantics vs the server-2 poller's expectations | DEDUP-03 | Question to `server-2` before the phase is planned |
| Pre-fetch `source_replay_id` dedup needs human-in-the-loop review before ship | DEDUP-01 | TECH-DEBT-explicit; review gate before staging deploy |
| Depcruise `forbidden` path regexes need tuning against the real `src/` tree | ARCH-06 | Tune during plan against `ls src/` (adapters live inside capability dirs) |

## Out of Scope

Over-engineering traps for THIS refactor — the tempting wrong turn inside a v3.1 phase, documented so a future agent doesn't take it. (Project-level exclusions — `~/sg_stats` import, ESLint re-introduction — already live in PROJECT.md and are not repeated here.)

| Feature | Reason |
|---------|--------|
| DI container (inversify / tsyringe / awilix) | The ARCH composition-root work is hand-rolled factory injection; a container is over-engineering for a single CLI binary |
| Shared cross-band contracts as an npm package | The ARCH contracts module is an internal `src/` dir; a package adds release overhead for one consumer |
| Dedup cache / bloom filter | The DEDUP latency goal is met by a cheap PostgreSQL existence check; an in-memory cache adds a staleness failure mode |
| ORM | Raw `pg` keeps the DEDUP/staging writes auditable; an ORM hides the write scope |

## Traceability

Each requirement maps to exactly one phase. v3.1 continues the project phase numbering: v3.0 ended at Phase 18, so v3.1 spans Phases 19-26.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARCH-01 | Phase 19 | Complete |
| ARCH-02 | Phase 19 | Complete |
| ARCH-03 | Phase 19 | Complete |
| ARCH-04 | Phase 20 | Complete |
| ARCH-05 | Phase 20 | Complete |
| ARCH-06 | Phase 23 | Complete |
| SPLIT-01 | Phase 22 | Complete |
| SPLIT-02 | Phase 22 | Complete |
| SPLIT-03 | Phase 22 | Complete |
| SPLIT-04 | Phase 22 | Complete |
| MECH-01 | Phase 21 | Complete |
| MECH-02 | Phase 21 | Complete |
| DEDUP-01 | Phase 24 | Complete |
| DEDUP-02 | Phase 24 | Complete |
| DEDUP-03 | Phase 24 | Complete |
| DISC-01 | Phase 25 | Complete |
| DISC-02 | Phase 25 | Complete |
| CORR-01 | Phase 26 | Complete |
| TEST-01 | Phase 26 | Complete |
| TEST-02 | Phase 26 | Complete |
| TEST-03 | Phase 26 | Complete |
| TEST-04 | Phase 26 | Complete |
| TEST-05 | Phase 26 | Complete |

**Coverage:**

- v3.1 requirements: 23 total
- Mapped to phases: 23 ✓ (every requirement maps to exactly one phase; no orphans, no duplicates)
- Unmapped: 0
- Note: DISC-01 + DISC-02 both shipped in Phase 25. The DISC-02 cross-app gate was resolved from server-2 source (canonical field = staging `replayTimestamp`; listing is a strict fallback); the residual listing-timezone confirmation (T-25-03) is a manual ship-gate, not a planning blocker.

**Phase → requirement summary:**

- Phase 19 (Contracts Home + Config Fix + Orphan): ARCH-01, ARCH-02, ARCH-03
- Phase 20 (Composition-Root Clients + Watch Teardown): ARCH-04, ARCH-05
- Phase 21 (Mechanical Convention Cleanup): MECH-01, MECH-02
- Phase 22 (God-File Decomposition): SPLIT-01, SPLIT-02, SPLIT-03, SPLIT-04
- Phase 23 (Depcruise Band-Fence Lock-In): ARCH-06
- Phase 24 (Watch Pre-Fetch Dedup + ON CONFLICT): DEDUP-01, DEDUP-02, DEDUP-03
- Phase 25 (Discovery Game-Date Capture, cross-app gated): DISC-01, DISC-02
- Phase 26 (Test-Quality + Correctness Hygiene): CORR-01, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05

---
*Requirements defined: 2026-06-20*
*Last updated: 2026-06-20 — traceability populated by roadmapper; 23/23 mapped to Phases 19-26.*
