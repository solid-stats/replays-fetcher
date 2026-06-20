# Roadmap: replays-fetcher

## Milestones

- [x] **v1.0 Initial Ingest Service** — Phases 1-6, shipped 2026-05-10. Full archive: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- [x] **v2.0 Full-Corpus Ingest Resilience** — Phases 7-12, shipped 2026-06-12. Full archive: [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)
- [x] **v3.0 Track C Toolchain Convergence (pilot)** — Phases 13-18, shipped 2026-06-14. Full archive: [milestones/v3.0-ROADMAP.md](milestones/v3.0-ROADMAP.md)
- 🚧 **v3.1 Convention Compliance & Tech-Debt Closure** — Phases 19-26 (in progress)

## Phases

<details>
<summary>✅ v1.0 Initial Ingest Service (Phases 1-6) — SHIPPED 2026-05-10</summary>

- [x] Phase 1: Project Foundation and Integration Contract (1/1 plans) — completed 2026-05-09
- [x] Phase 2: Source Discovery and Dry Run (4/4 plans) — completed 2026-05-09
- [x] Phase 3: Raw Replay Storage (4/4 plans) — completed 2026-05-09
- [x] Phase 4: Staging and Promotion Handoff (4/4 plans) — completed 2026-05-09
- [x] Phase 5: Scheduled Operations and Validation (4/4 plans) — completed 2026-05-09
- [x] Phase 6: Close v1 audit gaps: connectivity checks and discovered timestamp staging evidence (6/6 plans) — completed 2026-05-10

</details>

<details>
<summary>✅ v2.0 Full-Corpus Ingest Resilience (Phases 7-12) — SHIPPED 2026-06-12</summary>

- [x] Phase 7: v2 Foundations (3/3 plans) — completed 2026-06-07
- [x] Phase 8: Source Failure Diagnostics and Retry (4/4 plans) — completed 2026-06-08
- [x] Phase 9: Checkpoint and Resume (5/5 plans) — completed 2026-06-09
- [x] Phase 10: Dynamic Source Range and Rate Limiting (5/5 plans) — completed 2026-06-11
- [x] Phase 11: Progress Events and Compact Evidence (5/5 plans) — completed 2026-06-12
- [x] Phase 12: Source Contract Guards (2/2 plans) — completed 2026-06-12

</details>

<details>
<summary>✅ v3.0 Track C Toolchain Convergence (Phases 13-18) — SHIPPED 2026-06-14</summary>

Behavior-preserving migration onto the shared `@solid-stats/ts-toolchain` preset (Oxlint + Oxfmt + tsdown + Vitest + lefthook). `verify` green at 100% coverage at every phase boundary. Pilot before `server-2` and `web`.

- [x] Phase 13: Shared `@solid-stats/ts-toolchain` Bootstrap (3/3 plans) — completed 2026-06-13
- [x] Phase 14: Repository Cleanup & Convention Compliance (4/4 plans) — completed 2026-06-13
- [x] Phase 15: Oxfmt Formatter Migration (1/1 plans) — completed 2026-06-13
- [x] Phase 16: Oxlint Migration & Import Hygiene (6/6 plans) — completed 2026-06-14
- [x] Phase 17: tsdown Build & Docker Smoke (1/1 plans) — completed 2026-06-14
- [x] Phase 18: lefthook Hooks & CI Verify Convergence (1/1 plans) — completed 2026-06-14

</details>

### 🚧 v3.1 Convention Compliance & Tech-Debt Closure (Phases 19-26, In Progress)

**Milestone Goal:** Bring `replays-fetcher` into line with its approved five-band architecture and conventions and clear the documented tech-debt backlog (TD1–TD5 + architecture code-followups), enforcing the result inside `verify` so regressions become mechanically impossible. Behavior-preserving except the two intentional changes: the watch pre-fetch dedup (Phase 24) and the discovery game-date capture (Phase 25).

**Load-bearing build order (non-negotiable):** contracts home + config-import fix + orphan (19) → single-client composition root + watch teardown (20) → mechanical cleanup (21) → god-file splits (22) → depcruise band-fences enforced LAST (23, lock-in, never a blocker that wedges `verify`) → watch pre-fetch dedup + `ON CONFLICT` (24) → discovery game-date, cross-app gated (25) → test-quality + correctness-hygiene sweep (26). Inverting this order — enforcing fences before the tree satisfies them — wedges `verify` and blocks incremental shipping.

**Behavior-preservation gate (every architecture/split/mechanical phase: 19–23 and the hygiene sweep in 26):** coverage alone is NOT the behavior oracle. The regression gate is the **Docker golden run-once oracle** (`src/run/golden-e2e.integration.test.ts`) + **100% V8 coverage** + **depcruise** + **knip**, kept green after each extraction/move — not only at phase end. The golden oracle is updated (not loosened) only for the two intentional behavior changes (Phases 24 and 25).

- [ ] **Phase 19: Contracts Home + Config Import Fix + Orphan Cleanup** — Move cross-band DTOs to a leaf contracts module, kill the `config.ts` upward import, resolve the `no-leak.ts` orphan (pure type-move, zero runtime change)
- [ ] **Phase 20: Composition-Root Client Consolidation + Watch Teardown** — One `S3Client` + one `pg.Pool` built and injected at the `commands/` root; `watch` drains them on SIGTERM/SIGINT
- [ ] **Phase 21: Mechanical Convention Cleanup** — Bulk `interface→type` (~138) and import-order (~17) corrections, lint/formatter-enforced so they cannot regress
- [ ] **Phase 22: God-File Decomposition** — Split the four `max-lines`-suppressed god-files within their bands and remove the suppressions
- [ ] **Phase 23: Depcruise Band-Fence Lock-In** — Turn on the eight five-band import fences in `verify`, proven by a planted-violation test (enforced LAST as a no-op lock-in)
- [ ] **Phase 24: Watch Pre-Fetch Dedup + ON CONFLICT Staging** — Skip already-staged candidates before byte-fetch; non-throwing `ON CONFLICT DO NOTHING` ends the duplicate-key log spam (intentional behavior change)
- [ ] **Phase 25: Discovery Game-Date Capture (Cross-App Gated)** — Parse the listing "Game date" cell to ISO-8601; populate the canonical field once agreed with `server-2` (DISC-02 may slip to v3.2)
- [ ] **Phase 26: Test-Quality Pass + Correctness Hygiene** — Close the test-quality backlog and the live-verified correctness findings

## Phase Details

### Phase 19: Contracts Home + Config Import Fix + Orphan Cleanup
**Goal**: Cross-band data contracts live in one leaf module at the bottom of the dependency graph, no band imports a type upward, and the orphan module is gone — a pure type-move with zero runtime change.
**Depends on**: Nothing (first v3.1 phase; builds on the shipped v3.0 tree). Prerequisite for every other phase — removes the only currently-existing upward import.
**Requirements**: ARCH-01, ARCH-02, ARCH-03
**Success Criteria** (what must be TRUE):
  1. `ReplayCandidate`, `RawReplayStorageEvidence`, `RunSummary`/`CompactRunSummary`, and `IngestStagingPayload` are all defined in a single cross-cutting contracts module that imports nothing upward; builders stay in their owning bands (only the types moved).
  2. `config.ts` no longer imports `SourceTransport` from `discovery/`; `config.ts` depends on nothing upward.
  3. `no-leak.ts` is resolved (wired or removed) and `pnpm run knip` reports zero orphan modules.
  4. The Docker golden run-once oracle and 100% V8 coverage stay green — no runtime behavior changed.
**Pre-plan decision (resolve at discuss/plan)**: contracts home naming — `contracts/` (research recommendation) vs the already-encoded `types/`. Settle and encode the choice in the depcruise preset + conventions skill in the same plan.
**Behavior-preservation gate**: golden oracle (`src/run/golden-e2e.integration.test.ts`) + 100% V8 coverage + depcruise + knip green.
**Plans**: TBD

### Phase 20: Composition-Root Client Consolidation + Watch Teardown
**Goal**: Exactly one `S3Client` and one `pg.Pool` exist in `src/`, both built at the `commands/` composition root and injected; the `watch` daemon tears them down cleanly on shutdown; adapters never construct or tear down injected clients.
**Depends on**: Phase 19 (adapter signatures stable once contracts are settled)
**Requirements**: ARCH-04, ARCH-05
**Success Criteria** (what must be TRUE):
  1. Grep proves exactly one `new S3Client(` and exactly one `pg.Pool` constructor in `src/`; all `*FromConfig` convenience factories are deleted and `pnpm run knip` flags none surviving.
  2. The `watch` daemon drains the `pg.Pool` (`await pool.end()`) and destroys the `S3Client` (`s3.destroy()`) on SIGTERM/SIGINT before exit, in the composition-root signal handler.
  3. Adapters receive injected clients and never call teardown on them.
  4. A multi-cycle `watch` integration test plus a SIGTERM-drain test pass; golden oracle and 100% V8 coverage stay green.
**Behavior-preservation gate**: golden oracle + 100% V8 coverage + depcruise + knip green; the single-constructor migration is done in one phase so no hidden second client/pool is left behind.
**Plans**: TBD

### Phase 21: Mechanical Convention Cleanup
**Goal**: The near-100%-precision mechanical lane of the convention audit is fully applied and locked in — every `interface` that should be `type` is converted and import order is normalized, both enforced so they cannot regress.
**Depends on**: Phase 19 (leaf contracts home means the `type` conversion creates no upward imports). Sequenced before the god-file splits to keep the bulk conversion out of large structural diffs.
**Requirements**: MECH-01, MECH-02
**Success Criteria** (what must be TRUE):
  1. ~138 `interface→type` conversions are applied and enforced by oxlint `consistent-type-definitions: ["error","type"]` so a new `interface` fails `verify`.
  2. ~17 import-order sites are normalized and enforced by `oxfmt sortImports` (configured in the shared `@solid-stats/ts-toolchain` preset so `server-2`/`web` inherit it).
  3. Conversions land as isolated, diff-reviewable mechanical commits with zero logic change; redundant suppressions are removed.
  4. `tsc` stays green and the golden oracle + 100% V8 coverage are unaffected.
**Implementation note**: spike `oxlint --fix` first; only if it cannot convert all 138 sites with `tsc` green, add `ts-morph` as a dev-only one-shot dep, run the codemod, commit, then `pnpm remove ts-morph`. Only the mechanical lane is in scope here — no semantic audit findings (Pitfall 5).
**Behavior-preservation gate**: golden oracle + 100% V8 coverage + depcruise + knip green.
**Plans**: TBD

### Phase 22: God-File Decomposition
**Goal**: The four files carrying `oxlint-disable max-lines` are split into cohesive modules strictly within their own bands, and the suppressions are removed for good — a pure structural refactor with no behavior change.
**Depends on**: Phases 19 and 20 (contracts settled; injected clients have already simplified the god-files)
**Requirements**: SPLIT-01, SPLIT-02, SPLIT-03, SPLIT-04
**Success Criteria** (what must be TRUE):
  1. `src/run/run-once.ts`, `src/discovery/discover.ts`, `src/discovery/source-client.ts`, and `src/storage/replay-byte-client.ts` are each split within their band; no split crosses a band or lands in a shared `adapters/` dir.
  2. All four `oxlint-disable max-lines` suppressions are removed and never re-added.
  3. `pnpm run verify` (incl. depcruise + knip) is green after each extraction, not only at phase end; commits read as pure moves.
  4. The Docker golden run-once oracle and 100% V8 coverage stay green after every extraction — a dropped branch is caught by the oracle, not just by coverage.
**Behavior-preservation gate**: golden oracle + 100% V8 coverage + depcruise + knip green after **each** extraction (run `verify` per-extraction, not once at the end).
**Plans**: TBD

### Phase 23: Depcruise Band-Fence Lock-In
**Goal**: The five-band import fences are turned on in `verify` as a no-op lock-in — by now the tree (Phases 19–22) already satisfies every fence, so enforcement only prevents future drift and never wedges `verify`.
**Depends on**: Phases 19, 20, 21, 22 (the tree must already satisfy every fence before fences are enforced — the single most important sequencing invariant of the milestone)
**Requirements**: ARCH-06
**Success Criteria** (what must be TRUE):
  1. `.dependency-cruiser.cjs` enforces all eight `forbidden` rules inside `verify`: downward-only per band, no band-skip, PG write-scope, S3 write-scope, no-parser, discovery-read-only, diagnostics-never-write, composition-root exemption.
  2. `pnpm run depcruise` passes green on the current tree (fences are a no-op because the tree already satisfies them).
  3. A planted-violation test exits non-zero — proving each fence actually fires.
  4. The golden oracle + 100% V8 coverage stay green; enforcement adds no runtime change.
**Pre-plan tuning**: depcruise `forbidden` path regexes must be tuned against the real `ls src/` file tree during planning (adapter files live inside capability dirs; anchors need verification).
**Behavior-preservation gate**: golden oracle + 100% V8 coverage + depcruise + knip green; fences enforced LAST so they lock in completed work rather than blocking an in-flight move.
**Plans**: TBD

### Phase 24: Watch Pre-Fetch Dedup + ON CONFLICT Staging
**Goal**: A no-new-replay watch cycle collapses to a single page-1 list fetch (no redundant byte downloads), and benign staging duplicates stop spamming the postgres duplicate-key ERROR log — without ever dropping a genuinely-new replay or masking a conflicting-duplicate.
**Depends on**: Phase 23 (architecture stable; the staging repo and run-once path are fenced and settled before this behavior change lands)
**Requirements**: DEDUP-01, DEDUP-02, DEDUP-03
**Success Criteria** (what must be TRUE):
  1. The `watch` page-1 cycle skips a candidate whose `source_replay_id` already exists in staging BEFORE fetching its bytes; absent/empty/ambiguous ids fall through to fetch, and byte-checksum dedup remains as the backstop (a genuinely-new replay can never be dropped).
  2. A no-new-replay watch cycle performs only the page-1 list fetch and reports it via a distinct `skipped-by-source-id` run-summary counter (not merged into `dup`).
  3. Staging inserts use `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING` for the benign duplicate, ending the duplicate-key ERROR log spam, while the conflicting-duplicate (same source id, different checksum) manual-review classification via `classifyExistingStaging` is preserved.
  4. The golden watch oracle is updated (not loosened) to reflect the new dedup counts; a "cannot miss a new record" property test over a parameterized matrix and a conflict-classification integration test (benign quiet, conflicting surfaced) both pass.
**Phase risks (surfaced, not silently assumed)**:
  - **Data-loss-capable** — a pre-fetch skip on a wrong/absent id silently drops a new replay (invisible in logs). Mitigated by always-fall-through on absent/ambiguous id, the checksum backstop, and the "cannot miss a new record" property test.
  - **Cross-app — server-2 coordination (pre-plan gate, DEDUP-03)** — confirm `ON CONFLICT` benign-vs-conflicting semantics match the server-2 poller's expectations before the phase is planned.
  - **Human-in-the-loop — TECH-DEBT-explicit (DEDUP-01)** — pre-fetch `source_replay_id` dedup needs human review before shipping to staging.
**Behavior-preservation gate**: golden watch oracle **updated** to the new expected dedup counts (intentional behavior change), 100% V8 coverage maintained, depcruise + knip green.
**Plans**: TBD

### Phase 25: Discovery Game-Date Capture (Cross-App Gated)
**Goal**: The listing "Game date" cell is parsed into an ISO-8601 timestamp and threaded into candidate metadata; once the canonical field is agreed with `server-2`, it populates `promotion_evidence` and the golden oracle assertion that pins the field's absence is flipped to assert the concrete value.
**Depends on**: Phase 24 (discovery/run-once paths stable). DISC-02 is additionally **hard-blocked** on the server-2 canonical-date-field decision.
**Requirements**: DISC-01, DISC-02
**Success Criteria** (what must be TRUE):
  1. Discovery parses the listing "Game date" cell (`DD.MM.YYYY HH:MM`) into an ISO-8601 timestamp, Zod-bounded at the adapter boundary, threaded into candidate metadata — shippable independently of the cross-app gate (DISC-01).
  2. Date-parse unit tests cover day/month order, the agreed timezone, and the absent/unparseable cell; the existing filename-prefix timestamp path is confirmed still working.
  3. **(Gated — DISC-02)** The parsed game-date populates the canonical field (`promotion_evidence.discoveredAt` and/or `replay_timestamp`) agreed with `server-2`, and `golden-e2e.integration.test.ts:216` is flipped from `toBeUndefined` to assert the concrete ISO value.
**Cross-app gate (hard blocker, DISC-02)**: the canonical date field, format, timezone, and `web` read-path must be agreed with `server-2` before the DISC-02 contract write and oracle flip land. **If that decision does not land before milestone close, DISC-01 (local parse) ships and DISC-02 explicitly slips to v3.2.** Structure the phase so DISC-01 ships independently of the gate.
**Behavior-preservation gate**: the golden oracle flip is the intentional behavior change for DISC-02; until then DISC-01 leaves the oracle and 100% V8 coverage untouched. depcruise + knip green throughout.
**Plans**: TBD

### Phase 26: Test-Quality Pass + Correctness Hygiene
**Goal**: The pre-existing test-quality backlog is closed and the live-verified correctness findings are fixed — raising test rigor and code correctness with zero false-positive churn and no loss of coverage or behavior.
**Depends on**: Phase 25 (residual sweep after all prior phases land; test work is also budgeted into each phase above as new branches arrive)
**Requirements**: CORR-01, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):
  1. AAA arrange/assert duplicated literals are factored into named constants or typed builders; multi-behavior tests are split to one behavior per test (RITE).
  2. Dedup / conflict / date-parse matrices use `test.each` parameterized tables, and watch-loop timing paths use `vi.useFakeTimers()` — no real sleeps remain in tests.
  3. Untested reachable branches are closed by new tests; no new `v8 ignore` coverage suppressions are added.
  4. Each verified typed-error / unexplained-cast / swallowed-error finding (semantic tier, re-verified live against current source) is fixed — no raw `Error` is thrown where a typed `AppError` subclass is required, and no audit false-positive is committed as a change.
**Phase risk (surfaced, not assumed)**: the convention audit's semantic tier is ~50% false-positive (Haiku-verified); every correctness-hygiene finding must be re-verified live (file:line) against current source before becoming a commit. Expect the category to shrink substantially from its raw 335-finding count.
**Behavior-preservation gate**: golden oracle + 100% V8 coverage maintained; no new `v8 ignore` suppressions; depcruise + knip green.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 19 → 20 → 21 → 22 → 23 → 24 → 25 → 26

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-6 | v1.0 | 23/23 | Complete | 2026-05-10 |
| 7-12 | v2.0 | 24/24 | Complete | 2026-06-12 |
| 13-18 | v3.0 | 16/16 | Complete | 2026-06-14 |
| 19. Contracts Home + Config Fix + Orphan | v3.1 | 0/TBD | Not started | - |
| 20. Composition-Root Clients + Watch Teardown | v3.1 | 0/TBD | Not started | - |
| 21. Mechanical Convention Cleanup | v3.1 | 0/TBD | Not started | - |
| 22. God-File Decomposition | v3.1 | 0/TBD | Not started | - |
| 23. Depcruise Band-Fence Lock-In | v3.1 | 0/TBD | Not started | - |
| 24. Watch Pre-Fetch Dedup + ON CONFLICT | v3.1 | 0/TBD | Not started | - |
| 25. Discovery Game-Date Capture (gated) | v3.1 | 0/TBD | Not started | - |
| 26. Test-Quality + Correctness Hygiene | v3.1 | 0/TBD | Not started | - |

---

*v1.0 archived 2026-05-10. v2.0 archived 2026-06-12. v3.0 Track C archived 2026-06-14 (Phases 13-18). v3.1 Convention Compliance & Tech-Debt Closure roadmapped 2026-06-20 (Phases 19-26).*
