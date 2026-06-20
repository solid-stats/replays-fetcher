# Feature Research

**Domain:** Internal compliance / tech-debt refactor of an existing strict-TS scheduled ingest CLI (`replays-fetcher`)
**Researched:** 2026-06-20
**Confidence:** HIGH

> **Reading note for the roadmapper/planner.** This is a *subsequent* milestone (v3.1) with **no new end-user features**.
> Each "feature" below is a **refactor / compliance capability**. "Table stakes" = an established, expected property of a
> mature single-binary TS/Node ingest service that this codebase is currently out of compliance with. "Differentiator" =
> a genuine behavior or latency win (only two capabilities qualify). "Anti-feature" = the over-engineered version of a
> capability to explicitly NOT build for a single scheduled CLI binary. Verified against the live source tree at HEAD
> (not assumed from the tech-debt doc): the composition root, staging insert path, and `discoveredAt` drop were all
> confirmed in code.

---

## Capability Landscape

### Table Stakes (Expected of a mature TS/Node ingest CLI — currently out of compliance)

| Capability | Why Expected | Complexity | Notes |
|---|---|---|---|
| **1. Shared home for cross-band data contracts** (DTOs used by ≥2 bands) | A layered (five-band) service must not let a lower band import *up* into a higher band to reach a shared DTO. The standard fix is a dependency-free contracts module every band imports *down* into. Without it, `type-over-interface` and `import-order` churn ride on top of structural import violations. | **LOW–MEDIUM** | **Partially present.** `src/types/run-summary.ts` already exists as a shared-contract home. The work is *consolidation*: move `ReplayCandidate` / `RawReplayStorageEvidence` / `RunSummary` constituents into a leaf `src/types/` (or per-band re-export) so the documented `config.ts` upward import and the `no-leak.ts` orphan disappear. Depcruise already fences cycles, so the gate to keep it from regressing is **free**. |
| **2. Composition-root construction of long-lived clients + graceful teardown** | One `S3Client` and one `pg.Pool` per process, built once at the top and injected; long-running daemons must close the pool/sockets on shutdown so they don't leak across a redeploy. This is the canonical Node service-lifecycle pattern. | **LOW** (for `run-once`) / **MEDIUM** (for `watch` teardown) | **Largely present already** — `src/commands/clients.ts` is an explicit composition root (`createS3Client`, `createPgPool`) with a header comment stating the one-client rule, and adapters take injected clients. The real gap is **graceful teardown in the `watch` daemon**: confirm `pool.end()` / `S3Client.destroy()` on `shouldStop` / SIGTERM. `check.ts` already calls `pool.end()`; the daemon path needs the same discipline. By-hand wiring (no DI container) is correct for one binary. |
| **3a. Pre-fetch idempotency: cheap existence check before downloading bytes** | A continuous page-1 poller that re-downloads ~30 replays every ~21s purely to discover they are duplicates is wasteful by every ingest standard. The expected shape is: cheap `SELECT 1 ... WHERE source_replay_id = $1` short-circuit **before** the byte fetch. | **MEDIUM** | **Absent — this is a behavior change (the one intentional one).** Correctness obligation is the whole reason it was deferred (TECH-DEBT TD1): the skip must **never** drop a genuinely-new replay. Safe because `source_replay_id` is immutable on sg.zone, but it demands careful tests (new-id → fetched; known-id → skipped pre-fetch) + the golden watch oracle. This is the latency/source-load win — see Differentiators; counted here too because "don't re-download known objects" is table-stakes hygiene. |
| **3b. Non-throwing staging dedup (`INSERT … ON CONFLICT DO NOTHING`)** | Insert-and-catch-`23505` is a working but log-noisy anti-pattern; the idiomatic Postgres dedup is `ON CONFLICT … DO NOTHING` so duplicates resolve silently in the DB with no `ERROR` line. | **LOW** | **Absent — confirmed in code.** `postgres-staging-repository.ts#insertStaging` does a bare `INSERT … returning id` and catches `23505` via `isUniqueViolation`, then re-classifies. TD4: this is the *dominant ERROR stream* in staging Postgres logs 24/7. **Same root cause as 3a** — if the pre-fetch skip lands, the duplicate INSERT is never attempted and this noise vanishes as a side effect. Fold 3a+3b into one change. Correctness obligation: the existing conflict-classification path (`source_identity_conflict` / `raw_object_identity_conflict`) must be **preserved** — `DO NOTHING` returns zero rows, so the repository must still distinguish "already staged identically" from a genuine conflict via a follow-up `SELECT`, exactly as `classifyExistingStaging` does today. |
| **5. Test-quality standardization** (AAA no-dup-literals, RITE one-behavior, table-driven, deterministic time, branch-gap closure) | The shared + fetcher test skills already mandate RITE/AAA/determinism and a 100% reachable-source gate; "table stakes" here = bringing existing tests up to the standard the repo already declares. | **LOW–MEDIUM** (mechanical, broad surface) | See the **Vitest-Concrete Test-Quality Patterns** section below. All five sub-patterns are already codified in `solidstats-fetcher-ts-tests` / `solidstats-shared-testing-standards`; the milestone *applies* them, it does not invent them. Severity per review-standards §F: test quality is **never a standalone BLOCK** unless a weak test masks a real bug. |

### Differentiators (Genuine behavior / operational win — not mere compliance)

| Capability | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **3a. Pre-fetch dedup by `source_replay_id`** | Collapses a no-new-replay watch cycle from ~21s + ~2.7 req/s sustained on sg.zone to a single page-1 *list* fetch (sub-second, ~1 request). Turns "near-instant" detection from aspirational into real, and removes constant redundant load on the external source **and** S3. | **MEDIUM** | The single most valuable change in the milestone. Cross-app-safe (read-only existence check against staging this service owns). Bundle with 3b. |
| **4. Capture source-derived game-date → promotion-evidence contract** | Threads the listing "Game date" cell into `candidate.discoveredAt` → `promotion_evidence.discoveredAt` and/or the `replay_timestamp` staging column, so `server-2` promotes a real source date and `web` can surface it — instead of falling back to filename-prefix-or-`fetchedAt`. | **MEDIUM** | **Cross-app contract dependency — see flag below.** Parse is local (`extractReplayRows` in `discovery/html.ts`), but *which field is canonical* (promotion_evidence vs `replay_timestamp`) must be agreed with `server-2` before the contract changes. The golden oracle currently **pins the absence** (`promotion_evidence.discoveredAt toBeUndefined` at `golden-e2e.integration.test.ts:216`) — that assertion must flip when discovery starts setting it. |

### Anti-Features (Over-engineering to explicitly NOT build for a single CLI binary)

| Anti-Feature | Why It Looks Appealing | Why Problematic Here | Do Instead |
|---|---|---|---|
| **A DI container / IoC framework** (tsyringe, InversifyJS, awilix) | "Proper" dependency injection; auto-wiring | Massive over-engineering for one binary with ~2 long-lived clients. Hides the composition root the conventions *want* explicit. The repo's `clients.ts` header literally documents the by-hand one-client rule. | Keep the **by-hand composition root** (`createX(deps)` factories), pass clients down explicitly. |
| **A shared "common"/`@solid-stats/contracts` package** for the cross-band DTOs | Reuse across `server-2`/`web` | These DTOs are fetcher-internal ingest shapes; publishing them as a package invents a cross-repo contract surface and a versioning burden the milestone does not need. The staging *schema* contract with `server-2` is the only real cross-repo surface. | A **local leaf module** (`src/types/`) inside this repo only. |
| **Generic deduplication / bloom-filter / cache layer** in front of staging | "Make dedup fast/scalable" | The dataset is ~30 page-1 rows per cycle; a single indexed `SELECT` on `(source_system, source_replay_id)` is already sub-millisecond. A cache adds a coherence bug surface (the exact "never drop a new replay" risk). | One cheap, indexed existence `SELECT`, no cache. |
| **A full migration/ORM framework** to ship the `ON CONFLICT` change | "Schema is changing" | `ON CONFLICT DO NOTHING` is a query-shape change, **not** a schema change — the unique constraint already exists. Introducing an ORM hides staging writes from audit (explicitly forbidden by AGENTS). | Edit the raw SQL in `postgres-staging-repository.ts`; keep writes auditable. |
| **A mutation-testing gate (Stryker) added to `verify`** as part of test-quality | "Prove the oracles are strong" | Mutation testing is a *mindset* per testing-standards §H, valuable to *think* with — but wiring Stryker into the 100%-coverage `verify` surface is a separate, heavyweight initiative, not in-scope for closing test-quality debt. | Apply mutation *thinking* by hand when closing branch gaps; do not add the tool to the gate this milestone. |
| **Splitting god-files across band boundaries** | "Smaller files" | The four `max-lines`-suppressed files must be split **within their own band** (downward-only imports preserved). Splitting a capability file into the adapter band to shrink it would violate the five-band layering — trading one debt for a worse one. | Split each file into cohesive modules **inside its band** (TECH-DEBT seams for `run-once.ts` are pre-drawn); remove the `oxlint-disable max-lines`, never re-disable. |

---

## Vitest-Concrete Test-Quality Patterns (Capability 5 detail)

These are the standardizations worth enforcing, expressed against this repo's actual Vitest setup (colocated `*.test.ts`, native `expect`, `vi`, `test.each`, `vi.useFakeTimers`):

1. **AAA with no duplicated literals.** Per testing-standards §C Arrange/Assert DRY rule: if a value appears in both Arrange and Assert, bind it once (`const sourceReplayId = "1778269931"`) and reference it in both places. Today fixtures hardcode the same ISO timestamps and ids inline across Arrange and Assert (e.g. `"2026-05-09T00:32:44.000Z"` repeated in `payload.test.ts`). Lift logically-identical literals to a named binding; keep intentional duplicates with a one-line justifying comment.

2. **RITE one-behavior-per-test (Explicit).** Split tests that assert several unrelated contracts into one-behavior tests. A run-once orchestration test asserting *both* skip-count *and* staged-count *and* an emitted log line is three behaviors — only group assertions that check the **same** contract.

3. **Parameterized / table-driven tests (`test.each`).** The repo already uses this well (`sourceConcurrencyBoundaryCases` in config). Extend it to the conflict-classification matrix (3b) and the new-id-vs-known-id pre-fetch matrix (3a): a `readonly (readonly [label, input, expected])[]` table feeding one `test.each` beats N near-identical copy-pasted tests.

4. **Deterministic time — no real sleeps.** Fetcher-specific hard rule (`solidstats-fetcher-ts-tests`): pacing/backoff/retry and the **watch loop** are tested with `vi.useFakeTimers()` + an injected `sleep`/`now` seam, never wall-clock waits. The watch loop already injects `sleep`/`now`/`shouldStop` for exactly this; the new pre-fetch path (3a) must be tested through those fakes (assert "known-id cycle issues zero byte-fetch calls" via a spy on the byte client, advancing fake timers — not by sleeping).

5. **Closing untested-branch gaps.** The 100% reachable-source gate means new branches (pre-fetch skip taken / not-taken; `ON CONFLICT` zero-rows → re-`SELECT` → already-staged vs conflict; game-date present / absent / unparseable) each need a fixture-driven test, **not** a `/* v8 ignore */`. Inline ignores are only for structurally-unreachable branches (the existing non-`Error` catch fallbacks); a cluster of ≥3 in one file is itself a split signal, not a license for more.

---

## Capability Dependencies

```
[1. Shared contracts home]
    └──unblocks──> [mechanical type-over-interface / import-order cleanup]
    └──unblocks──> [config.ts upward-import removal + no-leak.ts orphan resolution]

[2. Composition root + teardown]  ── already mostly present; teardown gated on the watch daemon path

[3a. Pre-fetch existence check] ──same-root-cause──> [3b. ON CONFLICT DO NOTHING]
    (3a landing makes 3b's duplicate-INSERT noise disappear; fold into ONE change)
    3a/3b both depend on ──> [staging repository contract preserved: conflict classification]

[4. Game-date capture] ──BLOCKED-BY──> [server-2 canonical-date field decision]
    └──forces──> [golden-e2e oracle assertion flip (currently pins absence)]

[5. Test-quality] ──enhances──> every other capability (new branches need new tests, not ignores)

[God-file decomposition] ──must-respect──> [five-band layering] (split within band only)
```

### Dependency Notes

- **1 unblocks the mechanical cleanup:** the `type-over-interface` / `import-order` bulk fix and the `config.ts` upward-import removal are downstream of having a leaf contracts home to import down into. Do 1 first within the architecture phase.
- **3a and 3b share one root cause:** plan them as a single change. Splitting them risks patching `ON CONFLICT` separately and leaving the redundant byte-fetch (the bigger cost).
- **4 is gated on a `server-2` decision:** do not change the promotion-evidence/`replay_timestamp` contract until the canonical date field is agreed. Plan the local parse independently of the contract write.
- **5 wraps everything:** every new branch from 3a/3b/4 lands with a test under the 100% gate — budget test work into each of those phases, not only the dedicated test-quality phase.

---

## MVP Definition (milestone scoping)

### Land This Milestone (v3.1)

- [x] **1. Shared cross-band contracts home** — unblocks mechanical cleanup; low risk, depcruise-fenced. *Verify-gate impact: none new (depcruise already runs).*
- [x] **2. Composition-root teardown for the watch daemon** — close `pg.Pool` / `S3Client` on stop; root already exists.
- [x] **3a + 3b. Pre-fetch dedup + `ON CONFLICT DO NOTHING`** (one change) — the headline win; the only intentional behavior change; preserve conflict classification; new golden-watch oracle.
- [x] **5. Test-quality pass** — applied continuously as the above land, plus the dedicated AAA/RITE/table/determinism/branch-gap sweep.
- [x] **God-file decomposition** — split the four `max-lines`-suppressed files within their bands (pure refactor, behavior identical).

### Gated on Cross-App Agreement

- [ ] **4. Game-date capture** — local parse can be built now; the **promotion-evidence / `replay_timestamp` contract write and the oracle flip wait on the `server-2` canonical-date decision.**

### Explicitly Out (anti-features above)

- [ ] DI container, shared contracts package, dedup cache/bloom filter, ORM, Stryker-in-`verify`, cross-band splits.

---

## Capability Prioritization Matrix

| Capability | Operational Value | Implementation Cost | Risk | Priority |
|---|---|---|---|---|
| 3a+3b Pre-fetch dedup + ON CONFLICT | HIGH (latency + source load + log signal) | MEDIUM | MEDIUM (must never drop a new replay) | **P1** |
| 1 Shared contracts home | MEDIUM (unblocks cleanup, kills upward import) | LOW | LOW | **P1** |
| 2 Watch teardown | MEDIUM (clean redeploys, no leaks) | LOW | LOW | **P1** |
| God-file decomposition | MEDIUM (maintainability, honest lint) | MEDIUM | LOW (behavior-preserving) | **P2** |
| 5 Test-quality sweep | MEDIUM (regression safety) | LOW–MEDIUM | LOW | **P2** |
| 4 Game-date capture | MEDIUM (UI/operator metadata completeness) | MEDIUM | MEDIUM (cross-app contract) | **P2 — gated on server-2** |

**Priority key:** P1 = land early; P2 = land after P1 / once its gate clears.

---

## Cross-App & Architecture Dependency Flags (for the roadmapper)

- **server-2 contract decision (BLOCKER for Capability 4):** which field is the canonical replay date — `promotion_evidence.discoveredAt` or the `replay_timestamp` staging column? The fetcher must not change the staging/promotion contract until this is agreed. Surfaces a downstream `web` date-display dependency. This is the only capability with a hard external dependency.
- **Five-band layering (constrains god-file split + contracts home):** splits stay within-band, downward-only imports; the shared-contracts module must be a true leaf (no band imports up into it). Depcruise enforces this — keep it green.
- **Verify gate (constrains every capability):** 100% reachable-source coverage + oxfmt/oxlint/tsc/unit/integration/depcruise/knip must stay green. New branches → new tests, not ignores. Behavior-preserving capabilities (1, 2, god-file split) must show **zero** golden-oracle delta; the two behavior-changing capabilities (3a/3b, 4) must **update** their oracles (the golden-watch dedup oracle; the `discoveredAt` absence pin must flip).
- **Staging conflict-classification contract (constrains 3b):** `ON CONFLICT DO NOTHING` returns zero rows; the repository must still distinguish already-staged-identical from a real source/object conflict — preserve `classifyExistingStaging` semantics, do not collapse them into a silent no-op.

## Sources

- `.planning/PROJECT.md` — milestone v3.1 scope and accepted ingest architecture [HIGH]
- `replays-fetcher/TECH-DEBT.md` — TD1 (pre-fetch dedup), TD2 (god-file split), TD3 (game-date), TD4 (ON CONFLICT log noise) [HIGH]
- Live source verified at HEAD: `src/commands/clients.ts` (composition root present), `src/staging/postgres-staging-repository.ts` (insert-and-catch confirmed, no `ON CONFLICT`), `src/run/watch-loop.ts` (injected sleep/now/shouldStop seams), `src/run/golden-e2e.integration.test.ts:216` (`discoveredAt` absence pinned), `src/discovery/html.ts` (game-date cell dropped), `src/types/run-summary.ts` (shared-contract home already exists) [HIGH]
- `solidstats-fetcher-ts-tests` + `solidstats-shared-testing-standards` — RITE/AAA/determinism/coverage doctrine, fetcher no-real-sleep rule, 100% reachable-source gate, review-standards §F test-quality severity [HIGH]

---
*Feature research for: replays-fetcher v3.1 convention-compliance & tech-debt closure*
*Researched: 2026-06-20*
