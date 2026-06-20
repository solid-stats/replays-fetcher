---
gsd_state_version: 1.0
milestone: v3.1
milestone_name: Convention Compliance & Tech-Debt Closure
current_phase: 24
current_phase_name: Watch Pre-Fetch Dedup + ON CONFLICT Staging
status: executing
stopped_at: Phase 23 complete (1/1 plan; eight five-band depcruise import fences turned on in verify as a NO-OP lock-in — the tree already satisfied every fence so verify stayed green; planted-violation proof + review clean via full skill-chain incl correctness-and-quality.md). Out-of-band: re-review §AA findings from Phases 20/22 fixed (commit 5fa86e6 — teardown/fixture/checkpoint errors now logged under pino err key; verify green, 100% coverage, 515 tests) and the gsd-skill-chain-guard PreToolUse hook now auto-injects references/*.md into convention-bound subagent spawns. Autonomous run at 63% (5/8), continuing to Phase 24.
last_updated: "2026-06-20T13:28:31.681Z"
last_activity: 2026-06-20
last_activity_desc: Phase 23 complete, transitioned to Phase 24
progress:
  total_phases: 8
  completed_phases: 5
  total_plans: 12
  completed_plans: 12
  percent: 63
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-20)

**Core value:** Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.
**Current focus:** Phase 24 — Watch Pre-Fetch Dedup + ON CONFLICT Staging

## Current Position

Phase: 24 — Watch Pre-Fetch Dedup + ON CONFLICT Staging
Plan: Not started
Status: Phase 23 complete; Phase 24 not yet started
Last activity: 2026-06-20 — Phase 23 complete, transitioned to Phase 24

Progress: [██████░░░░] 63% (5/8 phases)

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

- **RESOLVED (Phase 20 → §AA fix 5fa86e6):** `src/commands/shared.ts` had hit the 300-line
  `max-lines` limit after the pool-ownership move. The §AA teardown-logging fix split
  `createDispose` + `createStoreRawResources` into a new `src/commands/store-raw-resources.ts`
  ("split structural limits, never suppress"), clearing the headroom problem. No longer a concern.

- **Carry-forward (Phase 20 → 26):** two code-review findings deferred — W-02 (`watch.ts:19`
  raw `Error` on a v8-ignored unreachable guard → typed error) and I-01 (`flushLogger` try-scope
  doc). See `.planning/phases/20-*/deferred-items.md`; route into Phase 26 CORR-01. (The Phase 20/22
  §AA re-review findings — swallowed teardown/fixture/checkpoint errors — are already fixed in 5fa86e6.)

## Next Step

1. Plan Phase 24 (Watch Pre-Fetch Dedup + ON CONFLICT Staging — DEDUP-01, DEDUP-02, DEDUP-03).
   First INTENTIONAL behavior change of the milestone: skip already-staged replays BEFORE the byte
   fetch, and make the staging insert `ON CONFLICT DO NOTHING`. The golden run-once oracle is
   UPDATED (not loosened) to encode the new skip behavior.

2. **Cross-app gate (DEDUP-03, load-bearing):** confirm `ON CONFLICT` benign-vs-conflicting
   semantics match the server-2 poller's expectations BEFORE the phase is planned (staging-schema
   contract — adjacent-app evidence or a user question required).

3. **Human-in-the-loop (DEDUP-01):** pre-fetch `source_replay_id` dedup is data-loss-capable —
   TECH-DEBT-explicit human review required before shipping to staging. Surface in discuss/plan.

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

**Last session:** 2026-06-20
**Stopped at:** Phase 23 complete (1/1 plan; eight depcruise band fences locked in as a no-op; planted-violation proof + review clean via full skill-chain). Out-of-band: §AA re-review findings fixed (5fa86e6) + gsd-skill-chain-guard hook added. Autonomous run at 63% (5/8), continuing to Phase 24.
**Resume file:** None
