---
gsd_state_version: 1.0
milestone: v3.1
milestone_name: Convention Compliance & Tech-Debt Closure
status: executing
stopped_at: Phase 22 complete (4/4 plans, SPLIT-01..04; 4 god-files split within-band via 4 PARALLEL worktrees, merged conflict-free, all <300, max-lines suppressions gone; verify + golden run-once/watch oracles green; review clean via full skill chain). Autonomous run continuing to Phase 23. HALFWAY (4/8).
last_updated: "2026-06-20T11:50:05.206Z"
last_activity: 2026-06-20
progress:
  total_phases: 8
  completed_phases: 4
  total_plans: 11
  completed_plans: 11
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-20)

**Core value:** Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.
**Current focus:** Phase 23 — Depcruise Band-Fence Lock-In (Phases 19–22 shipped; HALFWAY)

## Current Position

Phase: 23 of 26 (Depcruise Band-Fence Lock-In) — next to plan
Plan: Not started
Status: Phases 19–22 complete (4/8) — autonomous run advancing to Phase 23
Last activity: 2026-06-20 — Phase 22 done (4/4 SPLIT plans via 4 parallel worktrees; verify + golden oracles green; review clean)

Progress: [█████░░░░░] 50% (4/8 phases)

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

`pnpm run verify` exits 0: format → lint → typecheck → unit (502 tests) → coverage (100%
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

> Older per-phase decision log (Phases 1-18) is retained in PROJECT.md Key Decisions and the v1.0/v2.0/v3.0 milestone archives. Trimmed here per the STATE.md digest size constraint at the v3.1 boundary.

### Roadmap Evolution

- Phase 6 added: Close v1 audit gaps (connectivity checks + discovered-timestamp staging evidence).
- v2.0 Phases 7–12 added: 2026-06-07.
- v3.0 Phases 13–18 added: 2026-06-13 (Track C toolchain convergence pilot).
- v3.1 Phases 19–26 added: 2026-06-20 (Convention Compliance & Tech-Debt Closure).

### Pending Todos

None.

### Blockers/Concerns

- **Subagent reliability (2026-06-13):** During v3.0 setup, parallel research/roadmapper subagents
  returned fabricated output with `tool_uses: 0` (hallucinated reads/writes, wrote nothing to
  disk). Verify subagent disk writes before trusting their summaries on later phases.

- **DISC-02 server-2 dependency (v3.1):** see Open Gates above — hard blocker, may slip DISC-02 to v3.2.

- **Carry-forward (Phase 20 → 22):** `src/commands/shared.ts` is now AT the 300-line `max-lines`
  limit after the pool-ownership move (no suppression, but zero headroom). It is NOT one of the
  four `max-lines`-suppressed god-files Phase 22 targets (`run-once.ts`, `discover.ts`,
  `source-client.ts`, `replay-byte-client.ts`), but Phase 22 should keep an eye on it — any
  further growth needs a split within `commands/`.

- **Carry-forward (Phase 20 → 26):** two code-review findings deferred — W-02 (`watch.ts:19`
  raw `Error` on a v8-ignored unreachable guard → typed error) and I-01 (`flushLogger` try-scope
  doc). See `.planning/phases/20-*/deferred-items.md`; route into Phase 26 CORR-01.

## Next Step

1. Plan Phase 23 (Depcruise Band-Fence Lock-In, ARCH-06) — turn on the EIGHT five-band `forbidden`
   rules in `.dependency-cruiser.cjs` inside `verify` as a NO-OP lock-in (the tree, after Phases
   19–22, already satisfies every fence). Prove each fence FIRES via a planted-violation test.
   The 8 fences: downward-only per band, no band-skip, PG write-scope, S3 write-scope, no-parser,
   discovery-read-only, diagnostics-never-write, composition-root exemption.
2. **Pre-plan tuning (load-bearing):** the `forbidden` path regexes must be tuned against the REAL
   `ls src/` tree — adapter files live inside capability dirs, and Phase 22 added ~14 new sibling
   modules (run-once-*, discover-*, source-client-*, replay-byte-client-*) that the regexes must
   account for. Confirm `pnpm run depcruise` stays green (no-op) on the current tree BEFORE locking.
3. Enforced LAST on purpose — the single most important sequencing invariant. It must lock in
   completed work, never wedge an in-flight move.

## Reviewer skill-chain note (process)

The GSD `agent-skills` resolver returns EMPTY for `gsd-code-reviewer` when its config list has 5
entries (flaky at 4), so the config stays at the single top review skill. To make a hand-spawned
reviewer read the FULL chain (review-skill + shared-review-standards + fetcher-conventions +
shared-backend-ts-standards + shared-ts-standards), inject an explicit `<agent_skills>` block of
Read directives in the reviewer prompt — proven to work (Phase 22 review read all 5). Apply the
same to the Phase 26 review.

## Session

**Last session:** 2026-06-20
**Stopped at:** Phase 22 complete (4/4 SPLIT plans; 4 god-files decomposed within-band via 4 parallel worktrees, merged conflict-free, all <300, suppressions gone; ~14 new sibling modules; verify + golden oracles green; review clean via explicit full skill-chain injection). Autonomous run at 50% (4/8), continuing to Phase 23.
**Resume file:** None
