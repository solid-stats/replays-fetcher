# Pitfalls Research

**Domain:** Behavior-preserving convention/architecture refactor of a layered, fully-tested TypeScript ingest CLI (replays-fetcher v3.1)
**Researched:** 2026-06-20
**Confidence:** HIGH (grounded in this repo's TECH-DEBT.md, architecture follow-ups, CONCERNS.md, and the fetcher-conventions skill; not generic refactor advice)

> Scope note: this is an internal milestone on an existing, 100%-covered ingest CLI with a Docker golden run-once oracle and a `verify` gate (oxfmt → oxlint → tsc → unit → integration → 100% V8 coverage → tsdown → depcruise → knip). Every pitfall below is about doing THIS refactor without breaking THAT gate or the cross-app contract — not greenfield design. The two intentional behavior changes (watch pre-fetch dedup; discovery game-date capture) are called out explicitly; everything else must be behavior-preserving.

---

## Critical Pitfalls

### Pitfall 1: God-file split leaks an upward import or a cycle past depcruise

**What goes wrong:**
Splitting `run-once.ts` (~1046), `discover.ts` (702), `source-client.ts` (536), `replay-byte-client.ts` (491) into cohesive modules, a new module ends up importing **upward** across a band (e.g. a freshly-extracted `run/checkpoint-state.ts` reaching into a capability, or an adapter helper importing a `run/` type), or two new siblings form a cycle. This is the exact class already documented: `evidence/s3-evidence-store.ts → run/types.ts` was the one real F3 upward-import violation in the current tree. A naive extraction recreates it.

**Why it happens:**
Carving a 1046-line orchestrator into `page-loop` / `checkpoint-state` / `assemble-result` / `runtime` (the seams TECH-DEBT suggests), shared types/helpers that were co-located now have to live *somewhere*. The path of least resistance is to leave a `RunSummary`-shaped type in `run/` and import it from a lower band, or let two `run/` siblings import each other. depcruise's downward-only fence (#1) and the no-cycle rule fire — but only if the preset is wired and the extracted import is what trips it.

**How to avoid:**
- Do the **`RunSummary` → `src/types/` move FIRST**, as its own commit, before the `run-once` split — it is the documented prerequisite that removes the only standing upward import. Cross-band data contracts (`ReplayCandidate`, `RawReplayStorageEvidence`, `RunSummary` constituents) go to cross-cutting `types/`; *builders* stay in their owning band (`run/summary.ts` builds it).
- Split strictly **within the band** (TECH-DEBT "Fix approach"): `run-once` seams stay under `run/`; `discover.ts` in `discovery/`; `source-client.ts` and `replay-byte-client.ts` each stay in their own capability dir as adapters — never pulled into a shared `adapters/` dir (that breaks the write-scope fences).
- Continue from the existing seam: the watch-daemon work already extracted `run/ingest-page.ts` — follow that grain.
- Run `pnpm run verify` (esp. `depcruise` + `knip`) after **each** extraction, not once after all four.

**Warning signs:**
- depcruise reports a new `forbidden` violation naming a `run/` or `types/` path.
- A new module imports a sibling that imports it back (cycle).
- knip flags a newly-extracted module as unused (the split orphaned it, like the existing `no-leak.ts` orphan).

**Phase to address:**
Architecture/layer-compliance phase (do `RunSummary`→`types/`, `config.ts` upward-import removal, `no-leak.ts` orphan) BEFORE god-file decomposition. Ordering is load-bearing.

---

### Pitfall 2: A split silently drops a covered branch and 100% coverage masks it

**What goes wrong:**
A function moves from `run-once.ts` to `run/page-loop.ts`, and in the move a branch (an early-return, a `failed: n` increment, a throttle path) is dropped or merged. Because the milestone is "behavior-preserving," nobody re-reads the moved logic line-by-line, and the 100% V8 coverage gate stays green because the *surviving* lines are all hit. Coverage proves "every surviving line ran," NOT "no behavior was lost."

**Why it happens:**
100% coverage is necessary but not sufficient for behavior preservation. A refactor that deletes a branch and its only test together keeps coverage at 100%. V8 line coverage reports % of *reachable* source — remove a branch entirely and the metric is undisturbed.

**How to avoid:**
- Treat the **Docker golden run-once oracle** (`src/run/golden-e2e.integration.test.ts`, real MinIO+Postgres replaying the captured sg.zone corpus) as the behavior-preservation oracle, not coverage. It is the only check asserting end-to-end output equivalence across the refactor. It must stay green and **unchanged** through all four splits (the one exception is the deliberate game-date flip — Pitfall 7).
- Pure-refactor commits must be **diff-reviewable as moves**: extract with no logic edits so the reviewer confirms "same statements, new file." If a split *also* changes logic, that's a second commit.
- Test files travel with the code: when `runPageLoop` moves, its tests move and assert the same behaviors (RITE/AAA per `solidstats-fetcher-ts-tests`).
- Mutation-think the seam: if you can delete a moved branch and *no* test fails, it was undertested before the move — flag it (overlaps the test-quality "untested-branch leads").

**Warning signs:**
- A split commit's diff shows logic edits, not just relocation.
- Coverage stays 100% but the golden oracle's asserted counts change.
- A moved branch has no failing test when you tweak it.

**Phase to address:**
God-file decomposition phase. Verification = golden oracle green + diff-as-move review + coverage 100% (all three, not coverage alone).

---

### Pitfall 3: DI consolidation breaks pool/client teardown in the long-lived `watch` daemon

**What goes wrong:**
Today four sites construct their own clients (`s3-raw-storage`, `s3-checkpoint-store`, `s3-evidence-store`, `check/s3-connectivity` each `new S3Client(...)`; multiple sites build a `pg.Pool`). Consolidating to one shared `S3Client` + one `pg.Pool` built at the composition root and injected, the **single** pool/client now has a single owner responsible for teardown. In the always-on `watch` daemon (continuous page-1 poll), if SIGTERM handling doesn't drain that pool, connections leak on every redeploy; conversely, if a per-cycle path calls `pool.end()` on the *shared* pool, the next cycle uses a destroyed pool and the daemon crashes.

**Why it happens:**
Current code (CONCERNS.md "Database Pool Lifecycle") relies on the pool draining on *natural process exit* — fine for one-shot `run-once`, latent for the long-lived `watch`. Per-site construction matched each owner's lifetime to its use. After consolidation, lifetime is process-scoped, and `run-once` (exits) vs `watch` (never exits until SIGTERM) have *opposite* teardown needs from the *same* shared resource.

**How to avoid:**
- The composition root owns construction AND teardown. Build the shared `S3Client` + `pg.Pool` once; register a SIGTERM/SIGINT handler in the command band that drains the pool (`await pool.end()`) and lets buffered pino flush — per conventions §D ("never `process.exit()`; set `process.exitCode`; fix the leak, don't mask it") and [std: correctness §AB].
- Inject the shared *sender*/*pool* into adapters; adapters **never** call `pool.end()` / close the shared client — they borrow. Audit every extracted adapter for a stray teardown call.
- Distinguish the two runtimes: `run-once` drains on completion; `watch` drains only on signal. Both route through the same composition-root teardown, parameterized by lifetime, not duplicated.
- Verify with testcontainers that a `watch` loop runs ≥2 cycles on one shared pool without re-creating or ending it.

**Warning signs:**
- A `watch` test/staging shows "Cannot use a pool after calling end on the pool."
- Connection count climbs across redeploys (CONCERNS.md flags the N-pools × idle-conns math).
- An adapter file contains `.end()` / `.destroy()` on an injected client.

**Phase to address:**
Architecture/layer-compliance phase (single-client DI is the LIVE remaining item from the architecture follow-ups). Verification = multi-cycle `watch` integration test + explicit SIGTERM drain test.

---

### Pitfall 4: Partial DI migration leaves two construction paths and a hidden second pool

**What goes wrong:**
The single-client refactor touches four S3 sites and the pg sites; migrating only *some* leaves the new injected shared client AND a leftover `*FromConfig` that still `new`s its own — silently *two* `S3Client`s or *two* pools. Tests pass (each path works), depcruise passes (imports still legal), but the resource consolidation the milestone promised didn't happen and the duplicate pool reintroduces the connection-count problem.

**Why it happens:**
The `*FromConfig` convenience factories are self-sufficient. Removing one is easy to forget because nothing fails when it stays — it keeps building its own client. knip won't flag it if it's still referenced from a test or a `discover --store-raw` one-off.

**How to avoid:**
- Make removal of `*FromConfig` an explicit checklist item: "the `*FromConfig` convenience factories collapse once construction moves up." After migration, grep for `new S3Client(` and `new Pool(`/`new pg.Pool(` — expect exactly **one** of each, at the composition root.
- knip should flag the now-orphaned `*FromConfig` exports; treat that as proof the migration is complete, not noise to suppress.
- Migrate all four S3 sites + all pg sites in one phase, not piecemeal.

**Warning signs:**
- More than one `new S3Client(` or pool constructor survives in `src/`.
- knip reports a `*FromConfig` export unused and it gets suppressed rather than deleted.
- `check/s3-connectivity` still builds its own client (diagnostics is read-only and depcruise-exempt, but per the follow-up it should still take the injected client).

**Phase to address:**
Architecture/layer-compliance phase, same phase as Pitfall 3. Verification = grep count == 1 per backend + knip clean.

---

### Pitfall 5: Pre-fetch dedup by `source_replay_id` silently drops a genuinely-new replay

**What goes wrong:**
This is **the failure this project fears most** (TECH-DEBT: "must NEVER drop a genuinely new replay — a bug here silently loses ingest coverage, the exact property this whole parity effort secured"). The optimization skips fetching bytes for any candidate whose `source_replay_id` is already in staging. A bug — wrong key extraction, a candidate with missing/empty `source_replay_id` treated as "present," a case/whitespace mismatch, a query scoped to the wrong `source_system` — makes the skip fire for a NEW replay. It is never fetched, stored, or staged. Nothing errors. Ingest coverage silently degrades and no log line says so (today's `dup N` count is indistinguishable from a wrongful skip).

**Why it happens:**
Current behavior is *correct-by-construction*: it fetches + checksums everything, so it physically cannot miss — dedup happens AFTER download on the byte checksum. Moving the decision EARLIER (before download, on a source-supplied id) trades safety for latency/load. A pre-fetch existence check is an *optimization that can only lose data if wrong* — there is no symmetric, visible over-fetch failure; the dangerous direction (skip a new one) is silent.

**How to avoid:**
- **Fail safe, not fast:** if `source_replay_id` is absent, empty, or ambiguous, DO NOT skip — fall through to the existing fetch-and-checksum path. The pre-fetch skip layers *on top of*, never replaces, the byte-checksum dedup that remains the backstop. Keep the checksum dedup so even a wrongful non-skip still can't create a duplicate.
- Test the property, not by example: a "**cannot miss a new record**" test asserting *every candidate with an id not present in staging is fetched*, and *only* present ids are skipped. Parameterize: id present / absent / empty-string / whitespace / present under a *different* `source_system` / duplicate ids within one page. Integration test (testcontainers Postgres) seeds staging with N known ids, feeds a page mixing known + new + edge cases, asserts new ones all stored+staged and known ones skipped — never the reverse.
- Emit `skipped-by-source-id` **distinct** from checksum `duplicate` in the run summary so a wrongful-skip surge is visible in Loki, not buried in `dup 30`.
- Scope the existence query exactly: `WHERE source_system = $1 AND source_replay_id = $2`. `source_replay_id` alone is not the key.
- Golden oracle must still pass: it replays the real corpus and asserts stored/staged counts — a too-aggressive skip drops them.

**Warning signs:**
- A test seeds staging and a "new" id gets skipped.
- The existence query omits `source_system`.
- `skipped-by-source-id` == page size every cycle but `stored` never increments when the corpus grew (could be correct OR a wrongful blanket skip — the property test disambiguates).
- The byte-checksum dedup was *removed* rather than kept as backstop.

**Phase to address:**
Watch ingest-latency & source-load phase. The milestone's one genuinely behavior-changing, data-loss-capable item — needs the strongest verification (property test + integration + golden oracle + human review, per TECH-DEBT "review with a human in the loop"). **Flag for explicit confirmation before implementation.**

---

### Pitfall 6: `ON CONFLICT DO NOTHING` masks a real conflict-classification path

**What goes wrong:**
Moving staging dedup from insert-and-catch to `INSERT … ON CONFLICT (checksum, object_key) DO NOTHING` ends the postgres `ERROR: duplicate key` log spam (the documented goal) — but the *current* code does more than catch: on a unique violation it runs `classifyExistingStaging` (CONCERNS.md) with `findBySourceIdentity` then `findByObjectIdentity` to distinguish *which* constraint fired and route conflicting duplicates to manual review. If `ON CONFLICT DO NOTHING` swallows BOTH constraints, a genuine *conflicting* duplicate (same source identity, different checksum — which §B says must go to manual review) is dropped instead of surfaced. That violates the §B invariant "conflicting duplicates are routed to manual review, never silently merged."

**Why it happens:**
The log-noise fix and the conflict-classification logic share the same `INSERT`. `ON CONFLICT DO NOTHING` is the obvious noise fix, but the table has *two* relevant unique keys (`checksum+object_key` AND `source_system+source_replay_id` per CONCERNS.md) meaning different things: object-identity match = benign re-discovery (skip, want quiet); source-identity match with a *different* checksum = a conflicting duplicate that must NOT be dropped.

**How to avoid:**
- `ON CONFLICT DO NOTHING` targets only the **benign** conflict (object-identity / checksum re-discovery). Do not blanket-swallow the source-identity constraint; that path still detects and surfaces the conflicting-duplicate case for manual review.
- Prefer folding into the Pitfall-5 pre-fetch check (TECH-DEBT: same root cause): if `source_replay_id` is already present you skip before insert, so no benign INSERT is attempted and the log noise disappears — but STILL handle the rarer "same source id, different bytes" conflict deliberately, not drop it.
- This touches the staging write path, a `server-2`-facing contract surface (§B additive-only default). `ON CONFLICT DO NOTHING` changes how conflicts resolve; confirm with `server-2` that silently-skipped benign duplicates and still-surfaced conflicting duplicates match its poller's expectations. **Flag for a server-2 question.**
- Integration test (testcontainers Postgres): assert (a) same-checksum re-insert is a silent no-op, no error; (b) same-source-id-different-checksum still surfaces as a conflict.

**Warning signs:**
- `classifyExistingStaging` / `findBySourceIdentity` / `findByObjectIdentity` deleted wholesale in the name of "non-throwing dedup."
- A conflicting-duplicate test (same source id, new checksum) now passes silently.
- The `ON CONFLICT` clause names no constraint (swallows everything).

**Phase to address:**
Watch ingest-latency & source-load phase, bundled with Pitfall 5. **Flag for server-2 confirmation** on conflict-resolution semantics.

---

### Pitfall 7: Capturing the listing game-date changes a cross-app contract and flips a golden oracle that pins its absence

**What goes wrong:**
Parsing the "Game date" cell in `extractReplayRows` and threading it to `promotion_evidence.discoveredAt` and/or the `replay_timestamp` staging column is consumed **cross-app**: `server-2` promotes `promotion_evidence` and `web` surfaces the replay date. Three failure modes: (1) the canonical-date field isn't agreed with `server-2`, so the fetcher writes a field `server-2`/`web` don't read (or reads with a different meaning); (2) the date parse (`DD.MM.YYYY HH:MM` → ISO) is timezone-naive or locale-ambiguous, writing wrong timestamps into a UI-visible field; (3) the golden run-once oracle currently **pins the absence** (`promotion_evidence.discoveredAt` `toBeUndefined`) — populate it and that assertion fails. If someone "fixes" the failing oracle by *loosening* the assertion instead of *flipping* it, the oracle stops guarding the field entirely.

**Why it happens:**
The field was historically empty for the real corpus (the oracle's first real catch). Populating it is a discovery-completeness improvement, but it crosses into `server-2`/`web` territory: which column is canonical, what format, what timezone. The fetcher must not unilaterally decide a `server-2`-facing contract field.

**How to avoid:**
- **Coordinate the canonical date field with `server-2` BEFORE changing the contract** (TECH-DEBT explicit). Decide: `replay_timestamp` (staging column — additive/already-nullable) vs `promotion_evidence.discoveredAt` (JSON evidence) vs both, and which one `web` reads. **Flag for a server-2 question — hard blocker before implementation.**
- Parse `DD.MM.YYYY HH:MM` with an explicit, agreed timezone (the source's local zone) to an unambiguous ISO-8601 string. Do not rely on `new Date(string)` locale parsing. Zod-bound the parsed cell at the adapter boundary (§C bounds every external field) and test day/month order (e.g. `13.06.2026` = June 13, not month 13).
- **Flip** the golden oracle's `toBeUndefined` to the new expected ISO value (assert the *specific* captured date from the corpus); don't loosen it to "any or undefined." The oracle must now pin *presence with the correct value*.
- Keep the staging-column change additive (new value into the existing nullable `replay_timestamp`, or a new evidence sub-field) — no breaking DDL without the cross-app protocol (§B).
- Confirm the filename-prefix timestamp path (`YYYY_MM_DD__HH_MM_SS__`) still works — game-date is additive to, not a replacement for, it.

**Warning signs:**
- The golden oracle assertion was *relaxed* (`toBeUndefined` removed) rather than *flipped* to a concrete value.
- Date parsing uses `new Date(rawString)` with no explicit format/zone.
- The field name/semantics weren't confirmed with `server-2`.
- A `13.*`-style date parses as month-13 / NaN in a test.

**Phase to address:**
Discovery-completeness phase. **Hard-blocked on a server-2 question** (canonical date field). Verification = flipped golden oracle asserting the concrete ISO value + adapter-boundary date-parse unit tests (day/month order, timezone).

---

### Pitfall 8: Committing Haiku false-positive "violations" from the convention audit as real scope

**What goes wrong:**
The whole-repo convention audit (`pilot-v1.2-result.json`, 335 findings) has a **semantic/architecture tier Haiku-verified at ~50% false-positive on the contested sample** (the mechanical lane — `type-over-interface`, `import-order` — is near-100% precision). Taken at face value and turned into REQ-IDs and commits, roughly half of that tier is churn: "fixing" code that wasn't wrong, possibly *introducing* regressions into a behavior-preserving milestone, and burning review on non-issues.

**Why it happens:**
A static audit with a 335-finding count *looks* authoritative and exhaustive. The trap is treating tier-uniformly: mechanical findings are safe to bulk-apply, but the semantic tier's findings are *leads*, not facts. PROJECT.md is already explicit that semantic findings "enter as leads verified per-finding during discuss / plan" — the pitfall is skipping that under time pressure.

**How to avoid:**
- **Two-lane handling, hard split.** Mechanical lane (`type-over-interface`, `import-order`, redundant suppressions) → bulk-apply + enforce with a lint rule so they cannot regress (PROJECT.md: "enforced so they cannot regress"). Semantic/architecture/correctness lane → each finding is a **lead verified live against the current source before it becomes scope** (re-read the cited file:line, confirm the violation is real *today* at `c850190`≡current tree).
- Per-finding verification: open the file, confirm the claimed violation exists and matches the convention it cites (§A band, §B invariant, typed-error/cast/swallowed-error rule). Discard findings that don't reproduce. Only verified findings become REQ-IDs.
- Bias toward the documented debt (TD1–TD5 + architecture follow-ups) as the *trusted* backbone — those are human-recorded with observed evidence (Loki logs, golden-oracle catches, live cadence). The audit's semantic tier *supplements*, never overrides, the documented debt.
- Don't let finding *count* drive scope. 335 findings ≠ 335 tasks. Expect the correctness-hygiene category (typed-error / unexplained-cast / swallowed-error) to shrink substantially after live verification.

**Warning signs:**
- A semantic finding became a commit without anyone re-reading the cited line.
- "The audit says 335 findings, so we have 335 things to fix."
- A "fix" to a correctness finding changes behavior in a behavior-preserving milestone with no golden-oracle delta justifying it.
- Mechanical fixes aren't backed by an enforcing lint rule (they'll regress).

**Phase to address:**
Mechanical-convention-cleanup + correctness-hygiene phases. Verification = per-finding live reproduction recorded in the plan; mechanical fixes gated by a regression-preventing lint rule; golden oracle green proves no correctness "fix" changed behavior.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Re-`oxlint-disable max-lines` instead of splitting | `verify` goes green fast | Exactly the debt this milestone exists to clear; bans the structural gate per ADR 0005 | Never (conventions forbid silencing a structural gate) |
| Batch all four god-file splits, then `verify` once | Fewer test runs | A leaked upward import/cycle is hard to attribute to one split | Never — verify after each extraction |
| Loosen the golden oracle's `discoveredAt` assertion to pass | Green oracle | Oracle stops guarding the field; the project's one behavior oracle goes blind | Never — flip to the concrete value instead |
| Replace byte-checksum dedup with the pre-fetch id check (not layer on top) | Simpler path | Removes the backstop that makes "cannot miss" true by construction | Never — keep checksum dedup as backstop |
| `ON CONFLICT DO NOTHING` with no named constraint | Kills all duplicate-key log noise | Swallows conflicting-duplicate cases that must reach manual review | Never — target only the benign constraint |
| Take semantic audit findings at face value | Big visible "compliance" progress | ~50% are false positives → churn + possible regressions | Never for the semantic tier; fine for the near-100% mechanical lane |
| Suppress a knip "unused export" on a `*FromConfig` factory | knip green | Hides that the DI migration is incomplete (duplicate client survives) | Never — delete the factory instead |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| PostgreSQL (shared pool) | Adapter calls `pool.end()` on the injected shared pool; or `watch` never drains on SIGTERM | Composition root owns construction + teardown; adapters borrow; SIGTERM handler drains the one pool |
| PostgreSQL (existence check) | `WHERE source_replay_id = $1` (missing `source_system`) | Scope to `source_system + source_replay_id` — the real natural key |
| PostgreSQL (staging dedup) | Blanket `ON CONFLICT DO NOTHING` swallows the conflicting-duplicate constraint | Target only the benign (checksum/object) constraint; keep conflict classification for the source-identity case |
| S3 (shared client) | Some adapters migrated to injected client, leftover `*FromConfig` still `new`s its own | Exactly one `new S3Client(` at composition; grep to prove it; delete `*FromConfig` |
| Source HTML (game-date) | `new Date('13.06.2026 ...')` — locale/timezone-ambiguous | Explicit `DD.MM.YYYY HH:MM` parse with agreed timezone → ISO; Zod-bounded at adapter boundary |
| server-2 (promotion_evidence / replay_timestamp) | Fetcher unilaterally picks the canonical date field | Confirm canonical field + format with server-2 before writing; keep DDL additive |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Watch re-downloads ~30 page-1 replays every cycle | ~2.7 req/s on sg.zone 24/7; ~21s detection latency | Pre-fetch `source_replay_id` skip collapses a no-new cycle to one list fetch (Pitfall 5) | Already live on staging — this milestone fixes it |
| Duplicate-key INSERT every cycle | ~30 postgres ERRORs/cycle, dominant ERROR stream in Loki | `ON CONFLICT DO NOTHING` on benign constraint (Pitfall 6) | Already live — log hygiene only, no data impact |
| Multiple pools after partial DI migration | Connection count climbs; slots exhaust | One shared pool, grep-verified (Pitfall 4) | At redeploy churn / higher concurrency |
| Unbounded in-memory `loopState` accumulation | RAM grows with corpus size | Out of v3.1 scope; documented in CONCERNS.md | >10k candidates/run (not this milestone) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging the shared `pg`/S3 client config during DI refactor | Leaks `DATABASE_URL` creds / S3 secret key | Keep `redactConfig` boundary intact; never serialize unredacted `AppConfig`; pass `{ err }` not stringified config (§C) |
| Game-date or new evidence field includes a source-supplied unbounded string | DoS / injection into promotion_evidence | Zod-bound the parsed cell at the adapter boundary (§C bounds every external field) |
| SSH command path touched during `source-client.ts` split | Re-exposes the documented `REPLAY_SOURCE_SSH_COMMAND` injection surface | Don't change SSH command construction during a pure split; it's a known operator-managed surface (CONCERNS.md) |

---

## UX Pitfalls

(Operator-facing — this is a CLI/daemon, "UX" = operator observability.)

| Pitfall | Operator Impact | Better Approach |
|---------|-----------------|-----------------|
| Pre-fetch skip count merged into existing `dup` count | A wrongful blanket skip is invisible in run summary/Loki | Emit `skipped-by-source-id` distinct from checksum `duplicate` |
| Conflicting duplicate silently dropped by `ON CONFLICT` | Operator/server-2 never sees a case needing manual review | Keep the conflict path observable; only benign re-discovery goes quiet |
| Game-date written in wrong timezone | `web` shows wrong replay dates to end users | Agreed timezone + ISO; oracle pins the concrete value |

---

## "Looks Done But Isn't" Checklist

- [ ] **God-file split:** count drops *and* `oxlint-disable max-lines` is REMOVED (not just under the limit with the suppression still there); depcruise + knip clean after each split, not just at the end.
- [ ] **DI consolidation:** grep proves exactly one `new S3Client(` and one pool constructor; every `*FromConfig` deleted; `watch` SIGTERM drains the shared pool (integration-tested over ≥2 cycles).
- [ ] **Pre-fetch dedup:** byte-checksum dedup still present as backstop; absent/empty/cross-`source_system` ids fall through to fetch (not skipped); `skipped-by-source-id` counter distinct; property test "every unknown id is fetched" passes.
- [ ] **Staging `ON CONFLICT`:** conflicting-duplicate (same source id, new checksum) still surfaces for manual review — not swallowed.
- [ ] **Game-date:** canonical field confirmed with server-2; golden oracle assertion *flipped* to the concrete ISO value (not loosened); timezone explicit; filename-prefix path still works.
- [ ] **Audit findings:** every semantic/correctness finding re-verified live against current source before becoming a commit; mechanical fixes backed by an enforcing lint rule.
- [ ] **Whole milestone:** golden run-once oracle green throughout; 100% coverage maintained; `git status --short` clean per commit.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Leaked upward import/cycle from a split | LOW | depcruise names the edge; move the shared type to `types/` or invert the dependency; re-run verify |
| Dropped branch in a split (caught by golden oracle) | LOW–MEDIUM | Oracle/coverage delta localizes it; re-add from the pre-split diff (do moves as reviewable diffs to make this easy) |
| Wrongful pre-fetch skip shipped to staging | HIGH | Silent coverage loss — hard to detect post-hoc; recover by re-running discovery without the skip over the affected range; relies on checksum backstop having prevented dup creation. This is why it needs the property test + human review pre-ship |
| `ON CONFLICT` swallowed a conflicting duplicate | MEDIUM–HIGH | server-2 lost a manual-review signal; re-scan and re-stage affected source ids; restore the conflict path |
| Game-date written wrong / wrong-field | MEDIUM | Cross-app: server-2/web already consumed bad dates; coordinate a corrective re-stage; flip oracle |
| Committed false-positive audit "fix" that regressed behavior | MEDIUM | Golden oracle catches it; revert the commit (GSD atomic commits make this clean) |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Upward import / cycle on split | Architecture/layer-compliance (do `types/` move first) | depcruise + knip clean after each extraction |
| 2. Dropped branch on split | God-file decomposition | Golden oracle green + diff-as-move review + 100% coverage |
| 3. Pool/client teardown in `watch` | Architecture/layer-compliance (single-client DI) | Multi-cycle `watch` integration test + SIGTERM drain test |
| 4. Partial DI / duplicate pool | Architecture/layer-compliance (same phase as 3) | grep count == 1 per backend + knip clean |
| 5. Pre-fetch skip drops new replay | Watch ingest-latency & source-load **[server-2 + human review flag]** | "Cannot miss a new record" property test + integration + golden oracle |
| 6. `ON CONFLICT` swallows conflict | Watch ingest-latency & source-load **[server-2 question]** | Conflict-classification integration test (benign quiet, conflicting surfaced) |
| 7. Game-date contract / oracle flip | Discovery-completeness **[server-2 question — hard blocker]** | Flipped oracle asserts concrete ISO + date-parse unit tests |
| 8. Audit false positives as scope | Mechanical-cleanup + correctness-hygiene | Per-finding live reproduction; mechanical lint-enforced; oracle green |

### Items needing a server-2 question BEFORE implementation

- **Pitfall 7 (game-date) — hard blocker:** which field is canonical (`replay_timestamp` vs `promotion_evidence.discoveredAt`), format, timezone, which `web` reads.
- **Pitfall 6 (`ON CONFLICT`) — confirmation:** does server-2's poller expect silently-skipped benign duplicates, and still-surfaced conflicting duplicates?
- **Pitfall 5 (pre-fetch dedup) — human-in-the-loop review** required per TECH-DEBT before ship (data-loss-capable).

---

## Sources

- `replays-fetcher/TECH-DEBT.md` (TD1–TD5: watch pre-fetch dedup, god-file splits, game-date drop, staging `ON CONFLICT` log spam) — human-recorded debt with observed evidence (Loki, golden-oracle catches, live cadence). HIGH confidence.
- `plans/replays-fetcher/briefs/fetcher-architecture-code-followups.md` (single shared S3/pg client at composition root, `RunSummary` → `types/`, the three predicted depcruise violations). HIGH confidence.
- `.planning/codebase/CONCERNS.md` (pool lifecycle, `classifyExistingStaging` two-constraint dedup, HTML parsing fragility, connection-pool math). HIGH confidence.
- `.claude/skills/solidstats-fetcher-ts-conventions/SKILL.md` (§A five-band downward-only fences, §B ingest invariants incl. idempotency + conflicting-duplicate manual review, §C Zod bounding, §D error boundary + `process.exitCode` / resource teardown). HIGH confidence.
- `.planning/PROJECT.md` v3.1 milestone scope + audit trust tiers (~50% semantic FP, near-100% mechanical). HIGH confidence.

---
*Pitfalls research for: behavior-preserving convention/architecture refactor of the replays-fetcher ingest CLI (v3.1)*
*Researched: 2026-06-20*
