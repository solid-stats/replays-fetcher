---
gsd_state_version: 1.0
milestone: v3.1
milestone_name: Convention Compliance & Tech-Debt Closure
current_phase: 1
status: Awaiting next milestone
stopped_at: "Milestone v3.1 complete (8/8 phases, 20 plans). Phase 26 (Test-Quality + Correctness Hygiene) shipped 2026-06-22: CORR-01 typed InvariantViolationError + validated SourceTransport + §AA traceback; TEST-01..05 builders/RITE/test.each/deterministic-ordering. verify green (567 tests, 100% coverage), golden e2e oracle green. Audit 23/23 requirements (tech_debt: 2 deployment ship-gates T-24-04, T-25-03). Archived + tagged v3.1. Note: out-of-band `fallow` enable (commit 8540649 + uncommitted package.json/pnpm-lock) left untouched per user."
last_updated: "2026-06-23"
last_activity: 2026-06-23
last_activity_desc: "Post-milestone quick task qj5 (epoch-primary replay_timestamp) executed + reviewed; pending merge to master + server-2 cross-app hand-off"
progress:
  total_phases: 8
  completed_phases: 8
  total_plans: 20
  completed_plans: 20
  percent: 100
current_phase_name: Test-Quality Pass + Correctness Hygiene
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-20)

**Core value:** Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.
**Current focus:** Phase 26 — Test-Quality Pass + Correctness Hygiene

## Current Position

Phase: Milestone v3.1 complete
Plan: —
Status: Awaiting next milestone
Last activity: 2026-06-22 — Milestone v3.1 completed and archived

## v3.1 Roadmap Summary (Phases 19-26)

Behavior-preserving compliance + tech-debt milestone on the shipped, fully-tested ingest CLI.
Load-bearing build order (non-negotiable): contracts home (19) → composition-root clients +
watch teardown (20) → mechanical cleanup (21) → god-file splits (22) → depcruise band-fences
LAST (23, lock-in) → watch pre-fetch dedup + `ON CONFLICT` (24) → discovery game-date, cross-app
gated (25) → test-quality + correctness-hygiene sweep (26).

**Behavior-preservation gate (Phases 19-23 + hygiene in 26):** coverage alone is NOT the oracle.
Gate = Docker golden run-once oracle (`src/run/golden-e2e.integration.test.ts`) + 100% V8
coverage + depcruise + knip, kept green after each move. The golden oracle is updated (not
loosened) only for the two intentional behavior changes (Phases 24 and 25).

| Phase | Goal | Requirements |
|-------|------|--------------|
| 19. Contracts Home + Config Fix + Orphan | Cross-band DTOs in one leaf module; no upward imports; orphan gone | ARCH-01, ARCH-02, ARCH-03 |
| 20. Composition-Root Clients + Watch Teardown | One S3Client + one pg.Pool injected; watch drains on SIGTERM/SIGINT | ARCH-04, ARCH-05 |
| 21. Mechanical Convention Cleanup | interface→type (~138) + import-order (~17), lint/formatter-enforced | MECH-01, MECH-02 |
| 22. God-File Decomposition | Split 4 max-lines god-files within band; remove suppressions | SPLIT-01..04 |
| 23. Depcruise Band-Fence Lock-In | Turn on 8 fences LAST; planted-violation test proves they fire | ARCH-06 |
| 24. Watch Pre-Fetch Dedup + ON CONFLICT | Skip already-staged before byte-fetch; ON CONFLICT DO NOTHING | DEDUP-01, DEDUP-02, DEDUP-03 |
| 25. Discovery Game-Date Capture (gated) | Parse "Game date" → ISO; populate canonical field per server-2 | DISC-01, DISC-02 |
| 26. Test-Quality + Correctness Hygiene | AAA/RITE/test.each/fake-timers/branches + live-verified CORR | CORR-01, TEST-01..05 |

## v3.1 Open Gates / Risks (carry into discuss/plan — surfaced, not silently assumed)

- **Pre-plan decision (Phase 19):** contracts home naming — `contracts/` (research rec) vs the
  already-encoded `types/`. Settle and encode in the depcruise preset + conventions skill in the
  same plan.

- **Pre-plan tuning (Phase 23):** depcruise `forbidden` path regexes must be tuned against the
  real `ls src/` tree (adapter files live inside capability dirs).

- **Cross-app — server-2 (Phase 24, DEDUP-03):** confirm `ON CONFLICT` benign-vs-conflicting
  semantics match the server-2 poller's expectations before the phase is planned.

- **Human-in-the-loop (Phase 24, DEDUP-01):** pre-fetch `source_replay_id` dedup is
  data-loss-capable; TECH-DEBT-explicit human review required before shipping to staging.

- **Cross-app HARD BLOCKER — server-2 (Phase 25, DISC-02):** canonical replay-date field, format,
  timezone, and `web` read-path must be agreed with server-2 before the DISC-02 contract write +
  golden-oracle flip land. DISC-01 (local parse) ships independently; **DISC-02 may slip to v3.2**
  if the decision does not land before milestone close.

- **Audit trust (Phase 26, CORR-01):** convention-audit semantic tier is ~50% false-positive
  (Haiku-verified). Re-verify every correctness-hygiene finding live (file:line) against current
  source before it becomes a commit; only the mechanical lane (Phase 21) is bulk-safe.

## Verify Gate: GREEN ✅

`pnpm run verify` exits 0: format → lint → typecheck → unit (515 tests) → coverage (100%
statements/branches/functions/lines) → build → depcruise → knip. The Docker-backed integration
suite (incl. the golden end-to-end regression test) is a separate `pnpm run test:integration`
pre-deploy gate (runs on master before deploy). The golden oracle is the v3.1 behavior-preservation
oracle — coverage alone is NOT.

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- `replays-fetcher` is a separate ingest service; v1 runtime is TypeScript; v1 runtime shape is a scheduled job.
- Fetcher writes S3 raw objects and staging/outbox records only. `server-2` owns canonical replay records, parse jobs, retry policy, RabbitMQ publication, duplicate conflict handling, and admin visibility.
- `replay-parser-2` owns parsing and parser artifact/failure production.
- Raw replay identity uses checksum plus source identity where available; ambiguous duplicate conflicts go to manual review.
- [v3.0]: Shared `@solid-stats/ts-toolchain` preset consumed as a tag-pinned pnpm git-dep; Oxlint/Oxfmt/tsdown/Vitest/lefthook are single source of truth across the TS repos.
- [v3.0]: `eslint-plugin-import` dropped; band fences + write-scope + dead-code covered by `tsc` + dependency-cruiser + knip inside `verify`.
- [v3.1 Roadmap]: 8 phases (19-26). Build order is load-bearing — depcruise fences enforced LAST (Phase 23) as a no-op lock-in, never a blocker that wedges `verify`. Behavior-preserving except DEDUP (Phase 24) and DISC game-date (Phase 25).
- [v3.1 Roadmap]: The golden run-once oracle (`src/run/golden-e2e.integration.test.ts`) + 100% V8 coverage + depcruise + knip are the behavior-preservation gate for every architecture/split/mechanical phase; coverage alone is NOT the oracle.
- [v3.1 Roadmap]: DISC-01 (local game-date parse) ships independently; DISC-02 (canonical-field write + oracle flip) is hard-gated on a server-2 decision and may slip to v3.2.
- [Phase 24-01, DEDUP-02/03]: Staging benign-duplicate detection rewritten from insert-and-catch-23505 to `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id`; zero RETURNING rows = benign skip → resolve existing id → `already_staged`. ON CONFLICT target is `(checksum, object_key)` ONLY — the `(source_system, source_replay_id)` violation still throws 23505 → `classifyExistingStaging` → `conflict` (server-2 manual-review feed NOT swallowed, integration-proven).
- [Phase 24-01, DEDUP-03]: `existsBySourceIdentity(sourceSystem, sourceReplayId): Promise<boolean>` added as a lean `SELECT 1 ... LIMIT 1` (not a reuse of the 6-column findBySourceIdentity) — the pre-fetch existence primitive Plan 24-03 will call.
- [Phase 25-01, DISC-01/02]: Listing "Game date" (DD.MM.YYYY HH:MM) is parsed in discovery by `parseGameDateToUtcIso` — an anchored day-first named-group regex mirroring `replayTimestampFromFilename`, NO date library. Threaded via the existing `discoveredAt` key end to end (zero cross-band type changes). Staging `replayTimestamp` = `replayTimestampFromFilename(...) ?? evidence.discoveredAt`: filename strictly PRIMARY, listing a strict fallback that never overrides it. Golden-e2e oracle flipped to a concrete UTC-shape match (replay_timestamp stays filename-derived in the corpus, so the fallback is proven by the payload unit test). Listing timezone (T-25-03) is a manual-only ship-gate, not auto-closed.
- [quick-260623-qj5, SUPERSEDES the Phase 25-01 precedence above]: Staging `replayTimestamp` is now epoch-PRIMARY — `epochToUtcIso(externalId) ?? replayTimestampFromFilename(...) ?? evidence.discoveredAt`. The `/replays/{id}` `externalId` is a Unix epoch (seconds) = the only true-UTC instant the source gives us; the filename and listing dates are known server-local-TZ (≈UTC+1, the filename being the wrong *event* — file-write/game-end) and now fire ONLY for id-less / non-epoch candidates. New `src/time/epoch-to-utc-iso.ts` (range-guarded 2015-01-01..2035-01-01, strict canonical-integer guard, never throws). Golden oracle flipped to assert the concrete epoch-derived `replay_timestamp` per corpus row (UPDATE, not loosen). Value-only change — same field/type, NOT a schema change; `discoveredAt`/`sourceExternalId` audit fields byte-for-byte unchanged. `verify` green (100% cov), golden integration green. Cross-app server-2 follow-up (backfill of already-staged rows + read-path UTC confirmation) is maintainer-owned — see Blockers/Concerns.

> Older per-phase decision log (Phases 1-18) is retained in PROJECT.md Key Decisions and the v1.0/v2.0/v3.0 milestone archives. Trimmed here per the STATE.md digest size constraint at the v3.1 boundary.

- [Phase ?]: test
- [Phase ?]: [Phase 24-03, DEDUP-01]: pre-fetch existence check is a standalone optional dependency on ingestPage (not a widening of the shared StagingRepository); only the watch contract (WatchStagingRepository) carries existsBySourceIdentity, so run-once stays byte-for-byte unchanged and its golden-e2e oracle is untouched. skippedBySourceId is surfaced via the run summary, not an injected logger.

### Roadmap Evolution

- Phase 6 added: Close v1 audit gaps (connectivity checks + discovered-timestamp staging evidence).
- v2.0 Phases 7–12 added: 2026-06-07.
- v3.0 Phases 13–18 added: 2026-06-13 (Track C toolchain convergence pilot).
- v3.1 Phases 19–26 added: 2026-06-20 (Convention Compliance & Tech-Debt Closure).

### Pending Todos

None.

## Deferred Items

Acknowledged and deferred at v3.1 milestone close (2026-06-22) — both are deployment-time human ship-gates, NOT code gaps (full detail in `milestones/v3.1-MILESTONE-AUDIT.md`):

| Category | Item | Status |
|----------|------|--------|
| ship-gate | T-24-04 — production-staging data-loss sign-off before the watch pre-fetch dedup ships to a real production staging target | deferred |
| ship-gate | T-25-03 — listing-timezone confirmation before production ship | SUPERSEDED by quick-260623-qj5 — epoch (true UTC) is now the primary `replay_timestamp`; the wrong-TZ filename/listing values are demoted to rare id-less-candidate fallbacks. Residual: the fallback path is still server-local TZ (bounded, rare). New cross-app item replaces it (see Blockers/Concerns). |

### Blockers/Concerns

- **Subagent reliability (2026-06-13):** During v3.0 setup, parallel research/roadmapper subagents
  returned fabricated output with `tool_uses: 0` (hallucinated reads/writes, wrote nothing to
  disk). Verify subagent disk writes before trusting their summaries on later phases.

- **DISC-02 server-2 dependency (v3.1):** see Open Gates above — hard blocker, may slip DISC-02 to v3.2.

- **Cross-app — server-2 (quick-260623-qj5, OPEN, maintainer-owned):** qj5 changed the *semantics*
  of the staged `replays.replay_timestamp` value — was server-local-TZ-as-UTC (≈UTC+1, file-write
  event), now true-UTC epoch game-start. Same field/type (not a schema change), but already-staged
  rows keep the old wrong-TZ values → the column is a **mix of two conventions** until server-2
  backfills. Server-2 owns: (a) backfill of existing rows from the `externalId` epoch, (b)
  confirming the read-path / `web` display treats the column as true UTC. Out of scope for the
  fetcher; handed off — see the qj5 handoff brief in the quick-task dir.

- **RESOLVED (Phase 20 → §AA fix 5fa86e6):** `src/commands/shared.ts` had hit the 300-line
  `max-lines` limit after the pool-ownership move. The §AA teardown-logging fix split
  `createDispose` + `createStoreRawResources` into a new `src/commands/store-raw-resources.ts`
  ("split structural limits, never suppress"), clearing the headroom problem. No longer a concern.

- **Carry-forward (Phase 20 → 26):** two code-review findings deferred — W-02 (`watch.ts:19`
  raw `Error` on a v8-ignored unreachable guard → typed error) and I-01 (`flushLogger` try-scope
  doc). See `.planning/phases/20-*/deferred-items.md`; route into Phase 26 CORR-01. (The Phase 20/22
  §AA re-review findings — swallowed teardown/fixture/checkpoint errors — are already fixed in 5fa86e6.)

## Next Step

Milestone v3.1 is complete, tagged `v3.1`, and on `master`. The Phase 19-26 planning notes above are
retained as the milestone record; they are NOT pending work.

1. **Land quick-260623-qj5 on `master`.** The `gsd/v3.1-milestone` branch is 6 commits ahead of
   `master` — all of them the qj5 epoch-primary `replay_timestamp` quick task (planned, executed,
   reviewed, verify + integration green). Merge to `master` (fast-forward; `master` has diverged 0
   commits) and push.

2. **Cross-app server-2 hand-off (qj5, maintainer-owned).** The staged `replay_timestamp` semantics
   changed (true-UTC epoch, was server-local-TZ). Server-2 must backfill existing rows from the
   `externalId` epoch and confirm its read-path / `web` display treats the column as UTC. See the
   qj5 handoff brief in `.planning/quick/260623-qj5-fix-replay-timestamp-source-use-external/`.

3. **Next milestone:** start with `/gsd-new-milestone` when ready (see Operator Next Steps).

## Reviewer skill-chain note (process) — RESOLVED via hook

Earlier worry that the GSD `agent-skills` resolver "returns empty at 5 entries" was disproven — it
was a transient race during a rapid edit/commit; `buildAgentSkillsBlock` has no count cap and 5
resolves stably. `gsd-code-reviewer` config carries all 5 chain skills. The deeper issue (the
injection emits only each skill's `SKILL.md`, never its `references/*.md`, so index-only skills like
`shared-backend-ts-standards` reach the subagent without their real §Z/§AA/§AB rules) is now handled
mechanically: the **`gsd-skill-chain-guard` PreToolUse hook** (`~/.agents/hooks/`) appends explicit
`references/*.md` Read directives onto every convention-bound `gsd-*` subagent spawn and makes the
agent confirm which reference files it read. Verified working on the §AA fixer (read
correctness-and-quality.md). Belt-and-suspenders: still name the full chain explicitly in
hand-spawned reviewer/fixer prompts.

## Session

**Last session:** 2026-06-23
**Stopped at:** Milestone v3.1 complete + tagged (`v3.1`, on master). Post-milestone quick task
quick-260623-qj5 (epoch-primary `replay_timestamp`) planned, executed, reviewed (APPROVE) and its
one review nit fixed on `gsd/v3.1-milestone`; `verify` green (100% cov), golden integration green.
Pending: merge qj5 → master + push; server-2 cross-app hand-off (see Next Step).
**Resume file:** None

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 24 P03 | 12 | 3 tasks | 10 files |
| Phase 25 P01 | 01 | ~7m | 3 tasks, 5 files |

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
