# Project Research Summary

**Project:** replays-fetcher
**Domain:** Internal refactor / convention-compliance milestone for an existing TypeScript scheduled ingest CLI
**Researched:** 2026-06-20
**Confidence:** HIGH

## Executive Summary

`replays-fetcher` v3.1 is a behavior-preserving refactor milestone on a fully-tested, already-shipped ingest CLI. The architecture, stack, and toolchain are fixed; no new runtime dependencies are warranted. The milestone closes documented tech-debt (TD1–TD5), aligns the codebase with its approved five-band layering, and enforces the resulting conventions via the existing `verify` gate — so regressions become mechanically impossible, not just policy. Two intentional behavior changes are in scope: the watch pre-fetch dedup by `source_replay_id` (collapses a no-new-replay cycle from ~21 s + ~2.7 req/s to a single list fetch) and the discovery game-date capture (threads the listing "Game date" cell into `promotion_evidence`). Everything else must leave the golden e2e oracle and 100% V8 coverage untouched.

The recommended build order is non-negotiable and load-bearing: contracts home first → single-client composition root second → god-file splits third → depcruise band-fences enforced last. This order means the tree already satisfies every fence before it is turned on, so depcruise locks in the work without ever blocking a half-done move. Inverting the order — enforcing fences before the tree satisfies them — wedges `verify` and makes incremental shipping impossible.

The biggest risks are concentrated in three items: (1) the pre-fetch dedup can silently drop a genuinely-new replay if the skip fires on a wrong or absent id — the failure is invisible and data-loss-capable; (2) `ON CONFLICT DO NOTHING` can swallow the conflicting-duplicate conflict-classification path that must route to manual review, violating a §B invariant; (3) the game-date capture changes a cross-app contract that `server-2` and `web` consume, and the golden oracle currently pins the field's absence. All three need explicit server-2 coordination before implementation. A fourth structural risk: the whole-repo convention audit is ~50% false-positive on its semantic/architecture tier — only the mechanical lane (interface→type, import-order) is safe to bulk-apply; semantic findings must be re-verified live against the current source tree before becoming scope.

## Key Findings

### Recommended Stack

The stack is fixed. No new runtime dependencies are justified. The toolchain (`oxfmt@0.54.0`, `oxlint@1.69.0`, `tsdown@0.22.2`, `dependency-cruiser@^17.4.3`, `knip@^6.16.1`, Vitest 4 + V8) is already wired into `pnpm verify` and covers every refactor concern without duplication:

- **dependency-cruiser** — sole owner of band fences and write-scope rules. Not oxlint (`no-restricted-imports` has no graph/cycle awareness and specifier-not-path matching); not `eslint-plugin-boundaries` (needs ESLint, which was deliberately dropped in v3.0).
- **oxfmt `sortImports`** — sole owner of import ordering. Not oxlint (`sort-imports --fix` does not reliably reorder, confirmed open oxc issue). Enable `sortImports` in the shared `@solid-stats/ts-toolchain` preset so `server-2`/`web` inherit it.
- **oxlint `typescript-eslint/consistent-type-definitions: ["error","type"]`** — enforces `type` over `interface` so the bulk conversion cannot regress.
- **ts-morph (dev-only, one-shot, removed after use)** — fallback only if `oxlint --fix` cannot convert all ~138 interface sites. Spike `oxlint --fix` first; if it handles all 138 and `tsc` stays green, no new dep is needed.

**Core technologies (unchanged):**
- Node.js 25 / TypeScript 6 / pnpm 11 — runtime and language baseline.
- `@aws-sdk/client-s3` — modular S3 client; built once at composition root, injected into adapters.
- `pg` (raw SQL) — staging/outbox writes only; auditable write scope; no ORM.
- Vitest 4 + testcontainers (MinIO + PostgreSQL) — behavior oracle; 100% V8 coverage gate.
- pino structured logging — `skipped-by-source-id` counter must be a distinct field (not merged into `dup`).

### Expected Features (Capabilities for v3.1)

**Must have (table stakes — compliance work):**
- Shared cross-band contracts home (`src/contracts/` or `src/types/` — naming decision required before Phase 1 begins, encode in depcruise preset + skill in the same plan) holding `ReplayCandidate`, `RawReplayStorageEvidence`, `RunSummary`/`CompactRunSummary`, `IngestStagingPayload`. Builders stay in their owning bands; only the types move.
- Single `S3Client` + single `pg.Pool` built once at `commands/` composition root and injected. All four existing `new S3Client(...)` sites and all `*FromConfig` convenience factories deleted. Grep-verifiable: exactly one `new S3Client(` and one pool constructor in `src/`.
- `watch` daemon SIGTERM teardown: `await pool.end()` + `s3.destroy()` in the composition-root signal handler; adapters never call teardown on injected clients.
- God-file decomposition: `run-once.ts` (~1046 lines), `discover.ts` (702), `source-client.ts` (536), `replay-byte-client.ts` (491) split within their bands; `oxlint-disable max-lines` suppressions removed, never re-added.
- Mechanical convention cleanup: bulk `interface → type` (~138 sites) + `import-order` fix (17 sites), both enforced by lint/formatter so they cannot regress.

**Should have (behavior changes with operational value):**
- Pre-fetch dedup by `source_replay_id`: cheap `SELECT 1 WHERE source_system=$1 AND source_replay_id=$2` before downloading bytes. Must layer on top of, never replace, the byte-checksum dedup backstop. Absent/empty/ambiguous ids fall through to fetch. `skipped-by-source-id` counter distinct in run summary. Human-in-the-loop review required before ship.
- Non-throwing staging dedup: `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING` on the benign constraint only. `classifyExistingStaging` semantics preserved for conflicting duplicates.
- Test-quality pass: AAA literal deduplication, RITE one-behavior splits, `test.each` parameterization for dedup/conflict matrices, `vi.useFakeTimers()` for watch-loop paths, untested-branch closure (new branches land with tests, not `v8 ignore` suppressions).
- Correctness hygiene: verified typed-error/unexplained-cast/swallowed-error findings from the audit (semantic tier only, each re-verified live before becoming scope).

**Gated on server-2 coordination:**
- Game-date capture: local parse can be built; the contract write to `promotion_evidence.discoveredAt` / `replay_timestamp` and the golden oracle flip wait on canonical-field agreement with server-2.

**Explicitly out (anti-features):**
- DI container, shared contracts npm package, dedup cache, ORM, Stryker-in-verify, cross-band god-file splits, re-introduction of ESLint.

### Architecture Approach

The five-band downward-only layering (Command → Orchestration → Capability → Adapter → Cross-cutting) is decided and validated. This research does not re-open it. The v3.1 work is consolidation and finishing, not greenfield: `src/commands/clients.ts` (composition root) and `src/types/run-summary.ts` (contracts home seed) already exist. Several audit violations (e.g., four S3Client constructions) may be partially stale — every finding must be re-verified against the live source tree before it becomes a plan item.

**Major components and their refactor obligations:**
1. **`src/contracts/` (new) or `src/types/` (existing, expanded)** — cross-cutting, graph-bottom; DTOs shared by ≥2 bands. Naming must be settled before Phase 1 so the depcruise preset and conventions skill stay in sync.
2. **`commands/` (composition root)** — single site where `S3Client` + `pg.Pool` are built and injected. Load config → build clients → assemble deps → dispatch → teardown in `finally`.
3. **`.dependency-cruiser.cjs` fence preset** — eight `forbidden` rules enforced last (after tree satisfies them). Validated by a planted-violation test.
4. **God-file splits (within-band only)** — never across bands, never into a shared `adapters/` dir.
5. **Staging repository** — `ON CONFLICT DO NOTHING` on the benign constraint; conflict-classification path preserved; pre-fetch existence check layered upstream.

**Behavior oracle:** the Docker golden run-once integration test (`src/run/golden-e2e.integration.test.ts`), NOT 100% coverage alone. Coverage stays green when a split drops a branch and its test together. The golden oracle remains unchanged through all behavior-preserving phases; it is updated (not loosened) only for the two intentional behavior changes.

### Critical Pitfalls

1. **Pre-fetch dedup silently drops a genuinely-new replay** — data-loss-capable, invisible in logs. Mitigation: absent/empty/ambiguous `source_replay_id` always falls through to fetch; checksum dedup kept as backstop; property test "every unknown id is fetched" over parameterized matrix; `skipped-by-source-id` distinct from `dup`; human review required before ship.

2. **`ON CONFLICT DO NOTHING` swallows the conflicting-duplicate manual-review path** — violates §B invariant. Mitigation: target only the benign (checksum/object-key) unique constraint; same-source-id/different-checksum case still surfaces via `classifyExistingStaging`; confirm with server-2 before landing.

3. **God-file split creates an upward import or drops a covered branch** — two distinct failure modes. Mitigation: contracts move first; split strictly within band; run `pnpm verify` after each extraction; golden oracle is the behavior-preservation gate (not coverage alone); commits are diff-reviewable pure moves.

4. **Partial DI migration leaves a hidden second client/pool** — silent resource leak. Mitigation: migrate all four S3 sites and all pg sites in one phase; grep proves exactly one constructor each; knip flags surviving `*FromConfig` exports — delete, never suppress.

5. **Committing ~50%-false-positive semantic audit findings as real scope** — churn and possible regressions. Mitigation: mechanical lane bulk-applied + lint-enforced; semantic/architecture findings each re-verified live before becoming a REQ-ID or commit.

## Implications for Roadmap

### Phase 1: Contracts Home + Config Import Fix + Orphan Cleanup
**Rationale:** Prerequisite for every other phase. Removes the only currently-existing upward import (`evidence/s3-evidence-store.ts → run/types.ts`). Pure type-move — zero runtime change, golden oracle unaffected. Must precede god-file splits (Pitfall 1 avoidance) and mechanical cleanup (downstream of having a leaf contracts home).
**Delivers:** `src/contracts/` (or expanded `src/types/`) with `ReplayCandidate`, `RawReplayStorageEvidence`, `RunSummary`/`CompactRunSummary`, `IngestStagingPayload`; `config.ts` upward import removed; `no-leak.ts` orphan deleted; imports updated downward across `run/ evidence/ discovery/ storage/ staging/`.
**Decision required before this phase:** `contracts/` vs `types/` naming — settle and encode in depcruise preset + skill in the same plan.
**Addresses:** Architecture/layer compliance (shared contracts home).
**Avoids:** Pitfall 1 (upward import/cycle on split).
**Research flag:** Standard pattern — no additional research needed.

### Phase 2: Composition-Root Client Consolidation + Watch Teardown
**Rationale:** Depends on Phase 1 (adapter signatures stable once contracts are settled). Behavior-preserving mechanical move. Confirms `src/commands/clients.ts` already exists as composition root; collapses four `new S3Client(...)` sites + all `*FromConfig` factories; adds watch SIGTERM teardown.
**Delivers:** Single `S3Client` + single `pg.Pool` at composition root; `*FromConfig` factories deleted; SIGTERM/SIGINT handler that drains the pool and destroys the S3 client; knip clean; grep shows exactly one constructor per backend.
**Implements:** Composition-root DI (hand-rolled factory injection, no container).
**Avoids:** Pitfalls 3 and 4 (pool teardown and partial migration).
**Verification:** Multi-cycle `watch` integration test + SIGTERM drain test + grep count == 1 + knip clean.
**Research flag:** Standard pattern — no additional research needed.

### Phase 3: Mechanical Convention Cleanup
**Rationale:** Depends on Phase 1 (contracts home means no upward imports from the `type` conversion). Near-100%-precision mechanical lane from the audit. Isolated commits, diff-reviewable, zero logic change. Better before god-file splits to reduce noise in larger structural diffs.
**Delivers:** ~138 `interface → type` conversions enforced by `oxlint consistent-type-definitions: ["error","type"]`; 17 import-order fixes enforced by `oxfmt sortImports` (add to `@solid-stats/ts-toolchain` preset); redundant suppressions removed. Each conversion committed as one isolated mechanical commit.
**Implementation note:** Spike `oxlint --fix` first. If it converts all 138 and `tsc` stays green, zero new deps. Otherwise add ts-morph as dev-only one-shot dep, run codemod, commit, then `pnpm remove ts-morph`.
**Avoids:** Pitfall 5 (audit false positives — only mechanical lane here).
**Research flag:** Standard pattern — STACK.md covers all mechanics.

### Phase 4: God-File Decomposition
**Rationale:** Depends on Phases 1 and 2 (contracts settled; injected clients have simplified the god files). Pure structural refactor using TECH-DEBT's pre-drawn seams. Run `verify` after each extraction, not once at the end.
**Delivers:** Four god-files split within their bands; all four `oxlint-disable max-lines` suppressions removed (never re-added); depcruise + knip green after each step; golden oracle unchanged.
**Avoids:** Pitfalls 1 and 2 (upward import via incremental verify; dropped branch via diff-as-move discipline and golden oracle gate).
**Verification:** Golden oracle green + 100% coverage + depcruise/knip clean after each extraction.
**Research flag:** Standard pattern — no additional research needed.

### Phase 5: Depcruise Band-Fence Preset (Lock-In)
**Rationale:** Enforced last — the tree now already satisfies every fence (Phases 1–4). Turning the fences on is a no-op that locks in the work and prevents drift. This is the key sequencing invariant: fences last, never first.
**Delivers:** Eight `forbidden` rules in `.dependency-cruiser.cjs` (downward-only per band, no-band-skipping, PG write scope, S3 write scope, no-parser, discovery-read-only, diagnostics-never-write-path, composition-root exemption). Planted-violation test proves fences fire.
**Avoids:** Anti-pattern 3 (enforce-before-fix wedges `verify`).
**Verification:** `pnpm run depcruise` green; planted-violation test exits non-zero.
**Research flag:** Standard pattern — depcruise rule shapes are in STACK.md with concrete snippets ready to adapt (path regexes need tuning against real file tree during plan).

### Phase 6: Watch Pre-Fetch Dedup + ON CONFLICT Staging (Behavior Change)
**Rationale:** The headline operational win. Bundled because they share a root cause (redundant byte-downloads). Depends on Phases 1–5 (architecture stable). Data-loss-capable item — needs the strongest verification gates and explicit human review before ship. Server-2 coordination required on conflict-resolution semantics.
**Delivers:** `SELECT 1 WHERE source_system=$1 AND source_replay_id=$2` before byte-fetch; absent/empty/ambiguous ids fall through; `skipped-by-source-id` run-summary counter; `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING` replacing insert-and-catch-23505; `classifyExistingStaging` semantics preserved for conflicting duplicates; golden watch oracle updated (not loosened).
**Cross-app flag:** Server-2 question required — confirm `ON CONFLICT` behavior for benign vs conflicting duplicates matches server-2 poller expectations.
**Human-in-the-loop flag:** TECH-DEBT explicit — human review required before shipping to staging.
**Avoids:** Pitfalls 5 and 6 (silent new-replay drop; conflict-classification masking).
**Verification:** "Cannot miss a new record" property test (parameterized matrix); conflict-classification integration test (benign quiet, conflicting surfaced); golden oracle updated to reflect dedup counts.
**Research flag:** No additional research needed; mitigation strategies are concrete.

### Phase 7: Discovery Game-Date Capture (Cross-App Gated)
**Rationale:** Local parse of `DD.MM.YYYY HH:MM` can be built independently. Contract write and oracle flip are hard-blocked on server-2 canonical-field agreement. Schedule only after that agreement lands; if it does not land before milestone close, defer to v3.2 and ship local parse logic only.
**Delivers:** Explicit parse with agreed timezone → ISO-8601; Zod-bounded at adapter boundary; `promotion_evidence.discoveredAt` / `replay_timestamp` populated per agreed field; golden oracle `toBeUndefined` flipped to concrete ISO value; filename-prefix timestamp path confirmed still working.
**Cross-app flag:** Hard blocker — canonical date field, format, timezone, and `web` read-path must be agreed with server-2 before the contract write lands.
**Avoids:** Pitfall 7 (wrong timezone, oracle loosened, unilateral contract decision).
**Verification:** Flipped oracle asserts concrete ISO value; date-parse unit tests cover day/month order, timezone, absent/unparseable cell.
**Research flag:** Needs server-2 coordination decision; no additional tooling research needed.

### Phase 8: Test-Quality Pass + Correctness Hygiene
**Rationale:** Applied continuously as each phase above lands (new branches need tests immediately), but a dedicated sweep closes the pre-existing backlog. Correctness hygiene belongs here — each finding re-verified live before becoming a commit.
**Delivers:** AAA literal deduplication; RITE one-behavior-per-test splits; `test.each` tables for dedup/conflict/date-parse matrices; `vi.useFakeTimers()` for watch-loop paths; untested-branch closure via test additions (never `v8 ignore`); correctness-hygiene commits backed by live-verified file:line citations.
**Avoids:** Pitfall 8 (audit false positives — semantic findings each re-verified live).
**Verification:** 100% V8 coverage maintained; golden oracle green; no new `v8 ignore` suppressions added.
**Research flag:** Standard patterns — `solidstats-fetcher-ts-tests` and `solidstats-shared-testing-standards` cover all required idioms.

### Phase Ordering Rationale

- **Phases 1–5 are architecture-first:** structural invariants established before behavior changes; behavior changes on an unstable architecture invite regressions hard to attribute.
- **Fences last (Phase 5), not first:** the single most important sequencing decision. Depcruise fences enforced before the tree satisfies them wedge `verify` and block incremental shipping.
- **Mechanical cleanup (Phase 3) before god-file splits (Phase 4):** reduces diff noise; the `interface → type` conversion is an isolated commit that should not be interleaved with large structural file moves.
- **Pre-fetch dedup (Phase 6) after fences (Phase 5):** the behavior change touches the staging repository and run-once path; those paths should be architecturally stable before the logic change lands.
- **Game-date (Phase 7) isolated:** cross-app gated; can slip to v3.2 without blocking any other phase.
- **Test quality (Phase 8) continuous + sweep:** budget test work into each phase; Phase 8 closes residual gaps.

### Research Flags

**Phases with standard patterns (skip `--research-phase`):**
- All phases 1–5 and 8: tooling, patterns, and rule shapes are documented in STACK.md and ARCHITECTURE.md.

**Pre-plan coordination items (not more research, but decisions/questions):**
- **Before Phase 1:** `contracts/` vs `types/` naming decision — must be settled and encoded in depcruise preset + skill before planning begins.
- **Before Phase 5:** depcruise path regexes need tuning against the actual `ls src/` file tree during planning (adapter files live inside capability dirs; anchors need verification).
- **Before Phase 6:** server-2 question on `ON CONFLICT` conflict-resolution semantics; human-in-the-loop review gate before ship to staging.
- **Before Phase 7:** server-2 canonical date field decision (hard blocker; phase may slip to v3.2).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Toolchain is fixed and wired; tool ownership decisions grounded in official docs and confirmed open issues. One MEDIUM caveat: exact `oxfmt sortImports` group key spelling at v0.54.0 needs confirmation against installed schema. |
| Features | HIGH | Verified against live source tree at HEAD. Two already-present artifacts (`src/commands/clients.ts`, `src/types/run-summary.ts`) confirmed in code; staging `ON CONFLICT` absence confirmed; golden oracle pin confirmed at `golden-e2e.integration.test.ts:216`. |
| Architecture | HIGH | Five-band layering is decided (ADR 0002). Depcruise rule shapes grounded in official rules-reference. One MEDIUM caveat: exact path regexes in `forbidden` rules need tuning against real resolved paths during plan. |
| Pitfalls | HIGH | All grounded in human-recorded TECH-DEBT.md, CONCERNS.md, and architecture follow-ups — not generic inference. Mitigation strategies are concrete and testable. |

**Overall confidence:** HIGH

### Gaps to Address

- **`contracts/` vs `types/` naming:** research recommends `contracts/` (reads as intent; `types/` invites junk-drawer drift); existing code has `types/`. Must be settled before Phase 1 — encode in depcruise preset and conventions skill in the same plan.
- **Depcruise rule path regexes:** STACK.md and ARCHITECTURE.md provide concrete rule shapes but path anchors need tuning against `ls src/` during planning. Cannot be fully resolved until the planner has the actual file tree.
- **`oxfmt sortImports` group key spelling at v0.54.0:** confirm against `node_modules/oxfmt` schema or installed docs before writing the `.oxfmtrc.json` block.
- **Semantic/correctness audit findings (Phase 8 scope):** each finding outside the mechanical lane requires live re-verification before becoming a commit. Budget this verification time explicitly; expect the correctness-hygiene category to shrink substantially from its raw 335-finding count.
- **Server-2 canonical date field (Phase 7 gate):** no fetcher-side research resolves this — requires a synchronous question to the server-2 maintainer before Phase 7 can be planned.
- **Server-2 `ON CONFLICT` semantics (Phase 6 gate):** a server-2 question before Phase 6 planning; treat as a pre-plan action item, not a task inside the phase.

## Sources

### Primary (HIGH confidence)
- `.planning/PROJECT.md` — v3.1 milestone scope, seven categories, audit trust tiers, key decisions log
- `replays-fetcher/TECH-DEBT.md` — TD1–TD5 with observed evidence (Loki logs, golden-oracle catches, live cadence)
- `plans/replays-fetcher/briefs/fetcher-architecture-code-followups.md` — single shared S3/pg client, `RunSummary → types/`, three predicted depcruise violations
- `.planning/codebase/CONCERNS.md` — pool lifecycle, `classifyExistingStaging` two-constraint dedup, HTML fragility
- `solidstats-fetcher-ts-conventions/SKILL.md §A` — five-band map, write-scope fences, composition-root DI, no-port-ceremony
- `solidstats-shared-ts-standards §B, §C` — type-over-interface, suppression policy
- Live source verified at HEAD: `src/commands/clients.ts`, `src/types/run-summary.ts`, `src/staging/postgres-staging-repository.ts`, `src/run/golden-e2e.integration.test.ts:216`, `src/discovery/html.ts`
- [dependency-cruiser rules-reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) — `forbidden`/`pathNot`/`dependencyTypes` mechanics
- [Oxfmt import sorting docs](https://oxc.rs/docs/guide/usage/formatter/sorting.html) — `sortImports` groups and config
- [oxc issue #13316](https://github.com/oxc-project/oxc/issues/13316) — confirms oxlint `sort-imports --fix` does not reliably reorder

### Secondary (MEDIUM confidence)
- [khalilstemmler — The Dependency Rule](https://khalilstemmler.com/wiki/dependency-rule/) — why shared DTOs live at graph bottom
- [matthiasnoback.nl — Layers, ports & adapters, Part 2](https://matthiasnoback.nl/2017/08/layers-ports-and-adapters-part-2-layers/) — layered-hexagonal without separate port files
- [Xebia — dependency-cruiser as architecture fitness function](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/)
- [thetshaped.dev — DI in Node.js & TypeScript](https://thetshaped.dev/p/dependency-injection-in-nodejs-and-typescript-dependency-inversion-part-no-body-teaches-you) — factory functions + composition root, no container for a single binary
- [ts-morph for type-aware codemods](https://codemod.com/blog/ts-morph-support) — safe fallback over jscodeshift for declaration-merging-aware conversion

### Tertiary (LOW confidence)
- [Oxfmt Beta announcement](https://oxc.rs/blog/2026-02-24-oxfmt-beta) — `sortImports` built-in; specific group key spelling at v0.54.0 must be confirmed against the installed package

---
*Research completed: 2026-06-20*
*Ready for roadmap: yes*
