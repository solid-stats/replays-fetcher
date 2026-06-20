# Codebase Concerns

**Analysis Date:** 2026-06-20

## Tech Debt

### TD1 — Watch dedup fires after byte-fetch (latency + source load)

- Issue: The `watch` daemon checks dedup by checksum **after** downloading bytes. Every page-1 poll cycle re-fetches all ~30 replay files, computes checksums, finds them duplicates, and discards them. Cycle time ≈ 21 s, steady ~2.7 req/s of redundant downloads 24/7.
- Files: `src/run/watch-loop.ts`, `src/run/ingest-page.ts`, `src/staging/postgres-staging-repository.ts`
- Impact: (a) new-replay detection latency ≈ one full cycle instead of near-instant; (b) constant redundant load on sg.zone + S3.
- Fix approach: Before fetching bytes, check `source_replay_id` existence in staging with a cheap PG query. Unknown IDs fall through to the existing byte-fetch + checksum path. Byte-checksum dedup stays as the backstop (cannot silently drop a new replay). Needs human-in-the-loop review + redeploy gate per `TECH-DEBT.md`.
- v3.1 REQ: **DEDUP-01, DEDUP-02** (Phase 24)

### TD2 — Four files carry file-level `oxlint-disable max-lines`

- Issue: Four source files exceed the `max-lines` structural limit and suppress it with `/* oxlint-disable max-lines … */` at the file top, violating `solidstats-fetcher-ts-conventions` §A lint-suppression policy (structural limits must be split, never disabled).
- Files and current line counts:
  - `src/run/run-once.ts` — 1046 lines (page-loop, checkpoint-state, assemble-result, runtime all inlined)
  - `src/discovery/discover.ts` — 702 lines
  - `src/discovery/source-client.ts` — 536 lines
  - `src/storage/replay-byte-client.ts` — 491 lines
- Impact: Masks multi-responsibility violations; linter passes only because the rule is disabled. Makes targeted edits to any of these files riskier due to size.
- Fix approach: Pure behavior-preserving split within each file's five-band zone. Remove the `oxlint-disable` comment; never re-add it. `pnpm verify` must stay green and 100% V8 coverage must be preserved after each split.
- v3.1 REQ: **SPLIT-01, SPLIT-02, SPLIT-03, SPLIT-04** (Phase 22)

### TD3 — Discovery drops listing game-date → `discoveredAt` / `replay_timestamp` unpopulated

- Issue: `extractReplayRows` in `src/discovery/html.ts` parses the mission link, world, and server-id cells but skips the 4th `<td>` ("Game date", format `DD.MM.YYYY HH:MM`). Consequently `candidate.discoveredAt` is never set by sg.zone discovery, and `staging/payload.ts#toPayload` omits `discoveredAt` from `promotion_evidence`. The staging `replay_timestamp` column stays `NULL` for rows whose filename does not match the `YYYY_MM_DD__HH_MM_SS__` prefix.
- Files: `src/discovery/html.ts`, `src/staging/payload.ts`, `src/run/golden-e2e.integration.test.ts` (line 216 pins the field's *absence* — `toBeUndefined`)
- Impact: Cross-app — `server-2` promotes `promotion_evidence` and `web` surfaces the replay date. Without a source-derived game date the canonical replay has only the filename-prefix timestamp (when it matches) plus `fetchedAt`. Metadata gap, not a correctness bug; nothing is corrupted.
- Fix approach: Parse the Game date cell in `extractReplayRows` → ISO-8601 timestamp → thread through candidate metadata → `promotion_evidence.discoveredAt` and/or `replay_timestamp`. **Cross-app blocker:** coordinate with `server-2` on the canonical date field before writing the contract. Once agreed, flip the golden oracle assertion at line 216 from `toBeUndefined` to assert the concrete value.
- v3.1 REQ: **DISC-01** (Phase 25); **DISC-02 blocked** on server-2 canonical-date-field decision (may slip to v3.2)

### TD4 — Staging insert-and-catch spams postgres `ERROR: duplicate key` logs

- Issue: Every watch cycle the staging layer attempts a plain `INSERT` and catches the unique-constraint violation (`ingest_staging_records_checksum_object_key_key`) to classify duplicates. The app handles the rejection correctly, but postgres logs an `ERROR: duplicate key value violates unique constraint` per rejected row. At ~30 duplicates/cycle every ~21 s that is ~30 ERRORs/cycle, 24/7 — the dominant error stream in the `solid-stats-staging` namespace.
- Files: `src/staging/postgres-staging-repository.ts` (the `insertStaging` → catch flow at lines 53–84 and the `classifyExistingStaging` fallback at lines 134–174)
- Impact: Pure log noise — nothing is lost or corrupted — but it buries any genuine postgres error and inflates log volume. Observed as the only ERROR-level stream in the namespace over 24 h (Loki).
- Fix approach: Change the benign duplicate path to `INSERT … ON CONFLICT (checksum, object_key) DO NOTHING` so the DB resolves the conflict silently. The conflicting-duplicate branch (same `source_replay_id`, different checksum → `"source_identity_conflict"` / `"raw_object_identity_conflict"`) is preserved. **Preferred:** fold with TD1 — if the pre-fetch `source_replay_id` check (DEDUP-01) lands first, no duplicate `INSERT` is ever attempted and TD4 disappears as a side effect.
- v3.1 REQ: **DEDUP-03** (Phase 24)

### TD5 (architecture follow-up) — Multiple `S3Client` / `pg.Pool` constructions

- Issue: Per `src/commands/clients.ts` the composition-root single-client pattern is documented and the factories (`createS3Client`, `createPgPool`) are in place, but the follow-up in `plans/replays-fetcher/briefs/fetcher-architecture-code-followups.md` records that individual adapter modules previously each called `new S3Client(…)` / `new Pool(…)`. The `*FromConfig` convenience factories were the vehicle for this duplication.
- Files: `src/commands/clients.ts`, `src/commands/shared.ts`, `src/storage/s3-raw-storage.ts`, `src/checkpoint/s3-checkpoint-store.ts`, `src/evidence/s3-evidence-store.ts`, `src/check/s3-connectivity.ts`
- Impact: Redundant client instances increase connection overhead and make teardown harder to guarantee. Partially addressed — `clients.ts` now exists as the intended composition root — but a full grep-proof of "exactly one `new S3Client` and one `new Pool` in `src/`" is the ARCH-04 acceptance gate.
- Fix approach: Audit with `grep -rn "new S3Client\|new Pool" src/` excluding test files; ensure each appears exactly once in `src/commands/clients.ts`. Remove any remaining `*FromConfig` factory calls in adapter constructors.
- v3.1 REQ: **ARCH-04, ARCH-05** (Phase 20)

## Architecture-Compliance Gaps

### Cross-band type contracts without a dedicated contracts home

- Issue: `ReplayCandidate`, `RawReplayStorageEvidence`, `RunSummary`/`CompactRunSummary`, and `IngestStagingPayload` are defined in their owning-band modules and imported across bands. `src/evidence/s3-evidence-store.ts` imports `RunSummary` from `src/run/types.ts` — an upward import from the Adapter band into the Orchestration band, the confirmed fence violation predicted by the depcruise preset.
- Files: `src/run/types.ts` (defines `RunSummary`), `src/evidence/s3-evidence-store.ts` (imports it upward), `src/staging/types.ts`, `src/discovery/types.ts`
- Impact: Upward imports break the downward-only fence. The depcruise preset predicts this as violation F3. Any refactor of `run/types.ts` silently breaks `s3-evidence-store`.
- Fix approach: Move shared cross-band types to a new `src/contracts/` (or `src/types/`) cross-cutting module at the bottom of the dependency graph. Builders stay in their owning bands; only the bare types move. Decision on `contracts/` vs `types/` naming must be made at Phase 19 discuss/plan and encoded in the depcruise preset.
- v3.1 REQ: **ARCH-01** (Phase 19)

### `config.ts` upward import of `SourceTransport` from `discovery/`

- Issue: `src/config.ts` imports `SourceTransport` from `src/discovery/types.ts` (line 5). Config is a foundation module that nothing should depend on upward; importing from a capability band violates the downward-only fence.
- Files: `src/config.ts` (line 5), `src/discovery/types.ts`
- Fix approach: Move `SourceTransport` to the cross-cutting contracts module (see ARCH-01 above) so `config.ts` can import it downward.
- v3.1 REQ: **ARCH-02** (Phase 19)

### `no-leak.ts` orphan module

- Issue: `src/run/no-leak.ts` exports `NoLeakSurface` but is imported by nothing in `src/` (confirmed by grep). It exists as documentation of the PROG-04 no-leak contract but has no callers in production code; `knip` would report it as an orphan.
- Files: `src/run/no-leak.ts`
- Impact: Dead code that knip flags; every new agent reading the codebase may treat it as an active abstraction.
- Fix approach: Either wire it (import `NoLeakSurface` in the no-leak test or the guard that enforces the contract) or remove it and leave the comment inline. Decision at Phase 19 discuss/plan.
- v3.1 REQ: **ARCH-03** (Phase 19)

### Band-import fences not yet enforced by depcruise

- Issue: `.dependency-cruiser.cjs` exists as a generic preset from `pnpm verify` wiring, but the five-band rules (downward-only, no band-skip, PG write-scope, S3 write-scope, no-parser, discovery-read-only, diagnostics-never-write, composition-root exemption) are not yet encoded as `forbidden` rules. The depcruise draft lives in `plans/archive/replays-fetcher/briefs/fetcher-dependency-cruiser.cjs` and was proven against the current tree, but it has not been promoted to the repo's live config.
- Files: `.dependency-cruiser.cjs` (generic), `plans/archive/replays-fetcher/briefs/fetcher-dependency-cruiser.cjs` (draft with fetcher rules), `plans/archive/replays-fetcher/briefs/fetcher-depcruise-notes.md`
- Impact: Architectural fences are manually enforced by code review only. A band-skip or upward import will not be caught by CI until ARCH-06 lands.
- Fix approach: Promote the draft preset into `.dependency-cruiser.cjs`; add a planted-violation test (`pnpm run deps:validate` in the `verify` chain after `typecheck`). Tune path regexes against the real `src/` tree (adapters live inside capability dirs, not a flat `adapters/` dir).
- v3.1 REQ: **ARCH-06** (Phase 23)

## Fragile Areas

### HTML parsing in `src/discovery/html.ts`

- Why fragile: The listing and detail pages are parsed with regex/cheerio-style string selectors against sg.zone's HTML structure. Any layout change on the external site silently breaks discovery — candidates stop appearing with no thrown error, just an empty result set.
- Files: `src/discovery/html.ts`, `src/run/fixtures/golden/list/`, `src/run/fixtures/golden/detail/`
- Safe modification: All HTML parsing changes must update the golden fixture corpus and re-run `src/run/golden-e2e.integration.test.ts`. Never remove a `<td>` selector without verifying against a live page capture.
- Test coverage: Golden integration test covers the real captured corpus; unit tests in `src/discovery/html.test.ts` cover edge cases. Coverage is good but fixtures are point-in-time snapshots — they do not guard against future site changes.

### `classifyExistingStaging` two-constraint dedup

- Why fragile: After an insert unique-violation, `classifyExistingStaging` in `src/staging/postgres-staging-repository.ts` (lines 134–174) runs two sequential `SELECT` queries (`findBySourceIdentity` then `findByObjectIdentity`) to decide the conflict type. This is a TOCTOU window: if another worker inserts between the failed INSERT and the two SELECTs, classification may return the wrong branch. In v1 (single fetcher instance) this is safe; it becomes a risk if multiple fetcher pods run concurrently.
- Files: `src/staging/postgres-staging-repository.ts`
- Safe modification: Any change to the dedup/conflict classification must preserve all three outcome branches (`already_staged`, `conflict`, `failed`) and must not narrow the `ON CONFLICT` target columns without validating against `server-2`'s ON CONFLICT semantics expectations.

### `pg.Pool` lifecycle in the watch daemon

- Why fragile: The watch daemon (`src/commands/watch.ts`) does not explicitly call `pool.end()` on SIGTERM/SIGINT. The shutdown seam (lines 40–58) flips a `stopRequested` flag and waits for the current cycle to finish, but there is no `finally` block that drains the pool or destroys the S3Client after the loop resolves.
- Files: `src/commands/watch.ts` (lines 98–138), `src/run/watch-loop.ts`
- Risk: On Kubernetes pod termination, open PG connections may linger until the server-side `idle_in_transaction_session_timeout` closes them. Not a data-loss risk but causes connection slot exhaustion if pods are cycled rapidly.
- v3.1 REQ: **ARCH-05** (Phase 20)

## Cross-App Risks

### server-2 canonical replay-date field (DISC-02 hard blocker)

- Risk: `DISC-02` requires writing the parsed game-date to the field(s) that `server-2` promotes as the canonical replay date and that `web` surfaces in the UI. The field name, format (ISO-8601 UTC vs local), timezone interpretation, and `promotion_evidence` schema key have not been agreed. Writing the wrong field or format corrupts the canonical replay record in `server-2`.
- Files (fetcher side): `src/discovery/html.ts`, `src/staging/payload.ts`, `src/staging/types.ts`, `src/run/golden-e2e.integration.test.ts` (line 216 must flip)
- Current mitigation: DISC-02 is explicitly **Blocked** in `REQUIREMENTS.md` (Phase 25) until the server-2 decision lands. DISC-01 (local parse only, no staging write) can ship independently.
- Action required: Synchronous question to server-2 team before Phase 25 is planned.

### `ON CONFLICT` semantics vs server-2 poller expectations (DEDUP-03)

- Risk: Changing the staging insert from insert-and-catch to `INSERT … ON CONFLICT … DO NOTHING` changes which rows the server-2 poller sees. If server-2 relies on the ERROR path as a signal, the change must be validated against the poller's polling query.
- Files: `src/staging/postgres-staging-repository.ts`
- Current mitigation: Listed as a pre-plan coordination item in `REQUIREMENTS.md`. Must be confirmed with server-2 before Phase 24 is planned.

### `source_replay_id` pre-fetch dedup cannot silently drop replays (DEDUP-01)

- Risk: If the `source_replay_id` existence check has a bug (e.g. wrong column, wrong `source_system` filter), new replays will be silently skipped — ingest coverage is lost without any error. This is the exact property the golden parity harness was built to prove.
- Files: `src/staging/postgres-staging-repository.ts`, `src/run/watch-loop.ts`, `src/run/ingest-page.ts`
- Current mitigation: `TECH-DEBT.md` explicitly requires human-in-the-loop review + a new staging deploy gate before this ships. Byte-checksum dedup must remain as the backstop.

## Missing Critical Features

### Depcruise band fences not in CI

- Problem: There is no automated check that enforces the five-band import layering. A future PR could introduce an upward import or a write-scope fence violation without any CI failure.
- Blocks: Architecture integrity guarantee; the code-review skill's `[pending]` layer-check annotations cannot be retired until ARCH-06 ships.

## Test Coverage Gaps

### Watch-loop timing paths use real sleeps

- What is not tested: Timing-sensitive branches in `src/run/watch-loop.ts` (inter-cycle sleep, heartbeat interval) use real `setTimeout`-based sleeps in tests rather than `vi.useFakeTimers()`.
- Files: `src/run/watch-loop.test.ts`, `src/run/golden-watch.integration.test.ts`
- Risk: Slow CI, flaky results under load, and inability to deterministically test edge cases (sleep interrupted by SIGTERM mid-wait).
- Priority: Medium — TEST-04 (Phase 26)

### Multi-behavior tests and duplicated arrange literals

- What is not tested (consistently): Some test suites assert multiple behaviors per `it()` block and repeat fixture literals across assertions rather than using named constants or `test.each` tables.
- Files: `src/staging/postgres-staging-repository.test.ts`, `src/run/run-once.test.ts`
- Risk: A single test failure masks the unrelated behavior that was bundled in the same block; duplicated literals drift silently.
- Priority: Low-medium — TEST-01, TEST-02, TEST-03 (Phase 26)

---

*Concerns audit: 2026-06-20*
