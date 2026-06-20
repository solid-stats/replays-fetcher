# Architecture Research

**Domain:** Single-binary scheduled ingest/extract CLI (TS/Node) — replays-fetcher v3.1 convention/architecture-compliance refactor
**Researched:** 2026-06-20
**Confidence:** HIGH

> **Scope note.** The target architecture is **already decided and encoded** — the five-band
> downward-only layering in `solidstats-fetcher-ts-conventions/SKILL.md §A` (ADR
> `0002-replays-fetcher-architecture.md`). This research does **not** re-open it. It (1) validates
> the decided shape against external/published practice, (2) answers the five open architecture
> questions the v3.1 refactor still carries with **concrete dir layouts, import rules, and
> borrowable dependency-cruiser snippets**, and (3) gives the roadmapper a **safe, behavior-
> preserving refactor build-order** that fits the existing `verify` gate. Everything below
> distinguishes *real target shape* from *over-engineering for one CLI binary*.

---

## Standard Architecture

### System Overview — the decided five-band layering (validated)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  COMMAND      cli.ts (registration only) + commands/<cmd>.ts                  │  ← composition root
│               buildCli · resolveDependencies · program.command().action()     │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ (downward only)
┌───────────────▼──────────────────────────────────────────────────────────────┐
│  ORCHESTRATION  run/  — one ingest cycle: discover→fetch→store raw→stage,     │
│                 checkpoint/resume, run summary, idempotency boundary, pacing  │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────────────┐
│  CAPABILITY   discovery/ storage/ staging/ checkpoint/ evidence/              │
│               + check/ contract-check/  (read-only DIAGNOSTICS sub-band)      │
│               one ingest job each → validated domain data, typed errors       │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │  (each capability → its OWN adapter, injected client)
┌───────────────▼──────────────────────────────────────────────────────────────┐
│  ADAPTER      *-client / *-store / *-storage / *-repository                   │
│               source-client · replay-byte-client · s3-raw-storage ·           │
│               s3-checkpoint-store · s3-evidence-store · postgres-staging-repo  │
│               THE ONLY code that talks to S3 / pg / HTTP source — write scope  │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────────────┐
│  CROSS-CUTTING  config.ts · errors/ · logging/ · source/ (resilience) ·       │
│                 contracts/ (NEW — cross-band DTOs: ReplayCandidate,           │
│                 RawReplayStorageEvidence, RunSummary constituents)            │
│                 imported by any upper band; imports NONE upward               │
└──────────────────────────────────────────────────────────────────────────────┘
```

This is **layered hexagonal-lite**: capabilities are the application core, the `*-client`/`*-store`
adapters are the *driven adapters* (ports realized by the factory-contract `type` + `create…(deps)`
pattern, not separate port-interface files), and the `commands/` band is the *driving adapter* +
composition root. Published practice confirms this is the dominant shape for ingest/ETL-extract
services and that dependency-cruiser is the standard way to make the dependency rule executable
([khalilstemmler — The Dependency Rule](https://khalilstemmler.com/wiki/dependency-rule/),
[Xebia — Taking Frontend Architecture Serious With dependency-cruiser](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/)).

### Component Responsibilities

| Band | Responsibility | Implementation |
|------|----------------|----------------|
| Command | parse args, load+validate config, **build the long-lived clients once**, assemble deps, dispatch | `cli.ts` (thin) + `commands/<cmd>.ts` |
| Orchestration | sequence one cycle, own checkpoint/resume + idempotency decisions, apply resilience policy per stage, build the run summary | `run/` |
| Capability | one ingest job; return validated domain data; raise typed errors; never construct a client | `discovery/ storage/ staging/ checkpoint/ evidence/ check/ contract-check/` |
| Adapter | sole I/O surface to S3/pg/HTTP; the write-scope boundary; take client **injected** | `*-client / *-store / *-storage / *-repository`, inside their capability dir |
| Cross-cutting | config, typed errors, logger, resilience primitives, **shared data contracts** | `config.ts errors/ logging/ source/ contracts/` |

---

## The Five Open Questions — Concrete Answers

### Q1. Which architecture pattern best models "discover → fetch bytes → persist raw + staging, with checkpoint/resume"?

**Verdict: keep the decided layered/hexagonal-lite five-band — do NOT migrate to either pure
ports-and-adapters (port-interface files) or a `stage/`-renested pipeline taxonomy.** Confidence: HIGH.

Trade-offs against the three candidates, for a *single CLI binary*:

| Pattern | Fit for discover→fetch→persist+resume | Verdict for this repo |
|---------|----------------------------------------|-----------------------|
| **Pipeline-stages** (`stage/discover`, `stage/fetch`, `stage/persist`) | Models the *temporal* order legibly | **Over-engineering.** The flat `discovery/ storage/ staging/ checkpoint/ evidence/` dirs *are* the stages; re-nesting adds churn and a second axis of grouping with no enforcement benefit. Already closed as "flat" in §A convergence note 2. |
| **Pure ports-and-adapters / hexagonal** (explicit `ports/` interface files + `adapters/` impls) | Models the I/O isolation precisely | **Over-engineering for one binary.** The `type Foo + createFoo(deps)` factory contract ([std §A]) already yields a swappable seam for free; standalone port files are "ceremony without domain logic" (§A convergence note 1). Hexagonal's *dependency rule* is what we want — encoded via depcruise, not via interface files. |
| **Layered / onion (hexagonal-lite)** — the decided shape | Models both the layering (downward-only) AND the I/O isolation (adapter band = the only port realizations) | **Best fit. Keep.** Matthias Noback's layered ports-and-adapters synthesis ([matthiasnoback.nl — Layers, ports & adapters](https://matthiasnoback.nl/2017/08/layers-ports-and-adapters-part-2-layers/)) is exactly this: layers give the downward dependency rule, ports/adapters give the I/O seam; you don't need both as separate file taxonomies. |

The one thing the decided shape gets *right* that a naïve pipeline misses: **checkpoint/resume and
idempotency are orchestration concerns layered over the stages, not a stage themselves** (see Q4).

### Q2. WHERE do cross-band shared data contracts (`ReplayCandidate`, `RawReplayStorageEvidence`, `RunSummary` constituents) live so they create no upward import?

**Concrete rule: a single cross-cutting `src/contracts/` module at the BOTTOM of the dependency
graph (alongside `errors/`, `logging/`, `source/`). A type shared by ≥2 bands lives in
`contracts/`; the *builder/producer* of that value stays in its owning band.** Confidence: HIGH.

This is the textbook fix for "shared kernel" types under the dependency rule: the lowest layer
("Entities"/cross-cutting) is the only thing every other layer is allowed to depend on, so DTOs that
cross bands must live there or you get an upward import ([khalilstemmler — The Dependency Rule](https://khalilstemmler.com/wiki/dependency-rule/)).

**Why a dedicated `contracts/` and not the existing `types/`, co-location, or per-band re-export:**

- The §A convergence note already named `types/` as the home for `RunSummary`. **Recommendation:
  name it `contracts/`, not `types/`** — these are *cross-band data contracts* (some, like the staging
  payload and `ReplayCandidate`, are also `server-2`-facing contract surfaces), and `contracts/` reads
  as intent where `types/` reads as a junk-drawer that invites every local alias to migrate down. If
  the team prefers to keep the already-encoded `types/` name, that is fine — the *rule* (one
  cross-cutting home at graph bottom) is what matters, not the label. **Flag for the roadmapper:
  pick one name and encode it in the depcruise preset + skill in the same plan**, since the skill §A
  convergence note 5 currently says `types/`.
- **Co-location loses.** Putting `ReplayCandidate` in `discovery/` and letting `run/` + `staging/`
  import it works only because those are *downward* from orchestration — but `RunSummary` produced in
  `run/` and read by `evidence/` (an adapter, a *lower* band) is the exact upward violation the audit
  found (`evidence/s3-evidence-store.ts → run/types.ts`). Co-location cannot satisfy a DTO consumed by
  a band below its producer. A single bottom module always can.
- **Producer stays put.** `contracts/run-summary.ts` holds the `RunSummary` *type*; `run/summary.ts`
  holds `buildRunSummary()`. `contracts/replay-candidate.ts` holds the type; `discovery/` builds it.
  Lower bands import the *type* downward; nobody reaches up into `run/` or `discovery/`.

**Concrete layout:**

```
src/
├── contracts/                  # cross-cutting, graph-bottom — DTOs shared by ≥2 bands + their Zod schemas
│   ├── replay-candidate.ts     # ReplayCandidate (+ schema)         — built by discovery/
│   ├── raw-storage-evidence.ts # RawReplayStorageEvidence           — built by storage/
│   ├── run-summary.ts          # RunSummary, CompactRunSummary       — built by run/summary.ts
│   └── staging-payload.ts      # IngestStagingPayload (server-2-facing contract)
├── config.ts · errors/ · logging/ · source/   # the rest of cross-cutting
├── discovery/ storage/ staging/ checkpoint/ evidence/   # capabilities + their adapters
├── check/ contract-check/      # read-only diagnostics sub-band
├── run/                        # orchestration (summary.ts builds RunSummary)
└── commands/ + cli.ts          # command band + composition root
```

**Caveat — Zod schema placement.** §C requires every external-source payload to be Zod-validated at
the adapter boundary, and §A says adapters return *validated* domain data. Keep the **schema next to
its contract type** in `contracts/` when the type is shared, so the adapter imports both downward and
no band re-declares the shape. A purely local adapter-internal payload (never crosses a band) stays in
its capability dir — `contracts/` is for *shared* DTOs only, not every type.

### Q3. How is read-source / write-sink isolation encoded as a STRUCTURAL rule (extractor must not reach the system-of-record)?

**Concrete rule: dependency-cruiser `forbidden` rules keyed on `to.path` of the client package +
`dependencyTypes: ["npm"]`, gated by `from.pathNot` listing the only folders allowed to import it.**
This is the executable form of fences #4 (PG write scope) and #5 (S3 write scope). Confidence: HIGH.

dependency-cruiser is the de-facto tool for exactly this — making the hexagonal/clean dependency rule
an "architecture fitness function" ([Xebia](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/),
[Synapse Studios — dependency-cruiser config](https://docs.synapsestudios.com/implementation/frameworks/nest/dependency-cruiser-config)).
Borrowable `forbidden` snippets, adapted from the published "only this folder may import this package"
pattern ([rules-reference.md](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)):

```js
// .dependency-cruiser.cjs — write-sink isolation (fences #4, #5)
{
  name: 'only-staging-or-diagnostics-import-pg',
  comment: 'PG write scope: only staging/ (write) + check/ (read-only diag) may import pg. ' +
           'No server-2 business-table write can leak in via a stray pg import.',
  severity: 'error',
  from: { pathNot: '^src/(staging|check)/' },
  to:   { path: '^pg$', dependencyTypes: ['npm'] },
},
{
  name: 'only-s3-stores-or-diagnostics-import-aws-sdk',
  comment: 'S3 write scope: only storage/ checkpoint/ evidence/ (writes) + check/ (read-only) ' +
           'may import the S3 client.',
  severity: 'error',
  from: { pathNot: '^src/(storage|checkpoint|evidence|check)/' },
  to:   { path: '^@aws-sdk/client-s3', dependencyTypes: ['npm'] },
},
{
  name: 'no-ocap-parser',
  comment: 'Fence #3 — parsing belongs to replay-parser-2. No OCAP parser/content-decoder enters.',
  severity: 'error',
  from: {},
  to:   { path: '(ocap|replay-parser|/parse/)', dependencyTypes: ['npm', 'local'] },
},
```

**Downward-only + no-band-skipping (fences #1, #2)** are encoded with `to.path` pointing at a *higher*
band from a *lower* `from.path`. The cleanest published mechanism is one `forbidden` rule per illegal
upward edge (explicit and greppable), e.g.:

```js
{
  name: 'no-upward-adapter-to-orchestration',
  comment: 'Fence #1 — an adapter/capability never imports run/ (the RunSummary upward bug).',
  severity: 'error',
  from: { path: '^src/(storage|checkpoint|evidence|staging|discovery)/' },
  to:   { path: '^src/run/' },
},
{
  name: 'discovery-is-read-only',
  comment: 'Fence #6 — discovery/ never imports the write path.',
  severity: 'error',
  from: { path: '^src/discovery/' },
  to:   { path: '^src/(storage|staging)/' },
},
{
  name: 'diagnostics-never-import-write-path',
  comment: 'Fence #8 — check/ contract-check/ read adapters, never the staging/storage write path.',
  severity: 'error',
  from: { path: '^src/(check|contract-check)/' },
  to:   { path: '^src/(staging|storage|checkpoint|evidence)/(.*-(store|storage|repository))' },
},
```

**Composition-root exemption (the F1 sign-off item).** `cli.ts`/`commands/` legitimately import every
capability+adapter to wire them — that *looks* like band-skipping. Exempt the composition root via
`from.pathNot`, the published "except the root" idiom
([rules-reference.md](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)):

```js
{
  name: 'no-band-skipping-except-composition-root',
  comment: 'Fence #2 — only the composition root (cli.ts + commands/) may reach adapters directly.',
  severity: 'error',
  from: { path: '^src/run/' },
  to:   { path: '^src/.*-(client|store|storage|repository)\\.ts$' },
},
// cli.ts + commands/ are simply NOT in any `from.path` of an upward/skip rule — they sit at the top
// of the graph, so they need no explicit exemption beyond never being the `from` of a downward fence.
```

The diagnostics band (`check/`) imports `pg`/`@aws-sdk` directly but is **read-only** — depcruise
cannot tell read from write, so the import is *allowed* by the fence and the **reviewer enforces
read-only** (per §A convergence note 3 + the code-followups F6/F7a exemptions). This split — structure
enforces *who may import the client*, review enforces *read vs write* — is the honest boundary of what
a static dep tool can do, and it is already the documented design.

### Q4. Where do checkpoint/resume & idempotency belong — and where does composition-root DI sit?

**Checkpoint/resume & idempotency: an ORCHESTRATION concern, NOT a first-class layer.** Confidence: HIGH.

The decided design (§A convergence note 4) is correct and externally supported: idempotency in a
discover→persist pipeline is *"orchestration + database constraint, not checkpoint magic."* Concretely:

- `run/` owns the **resume decision** (which page/candidate to re-scan) and threads checkpoint state.
- The **staging table's unique natural key (checksum + source identity)** + `ON CONFLICT DO NOTHING`
  writes are the actual idempotency guarantee — a structural DB invariant, not application logic.
- The `checkpoint/` capability is just *durable progress storage* (an S3-backed store); it only
  **narrows the re-scan window**, it is not the correctness mechanism.
- Resilience primitives live in cross-cutting `source/`, but their **policies are constructed by
  orchestration and passed into capabilities/adapters per stage** — adapters never hard-code retry
  semantics. This is the standard "decorate at the edge of the use-case, configure at the
  composition/orchestration layer" placement; making resilience a separate *band* would be
  over-engineering (it has no domain logic — §A keeps it cross-cutting).

So: **no new "idempotency layer."** It is correctly distributed across orchestration (decision),
cross-cutting `source/` (mechanism), and the DB schema (guarantee).

**Composition-root DI of long-lived clients: in the COMMAND band, no container.** Confidence: HIGH.

The consensus for a single Node binary is unambiguous: **factory functions + a single composition root
cover this; a DI container (tsyringe/InversifyJS) is unwarranted** and would be over-engineering for
one CLI ([thetshaped.dev — DI in Node.js & TypeScript](https://thetshaped.dev/p/dependency-injection-in-nodejs-and-typescript-dependency-inversion-part-no-body-teaches-you),
[RisingStack — DI in Node.js](https://blog.risingstack.com/dependency-injection-in-node-js/)). The target:

- Build **one `S3Client` and one `pg.Pool`** exactly once in the composition root (`commands/<cmd>.ts`,
  after `loadConfig()` and before any side effect, per §C), then **inject** them into every adapter
  that already accepts a `sender`/`pool`.
- Collapse the four `new S3Client({...})` calls (in `s3-raw-storage`, `s3-checkpoint-store`,
  `s3-evidence-store`, `check/s3-connectivity`) and the duplicated `pg` constructions; **delete the
  `*FromConfig` convenience factories** that each `new`'d their own client. This is the
  [std: correctness → External adapters] rule ("client created once, injected, never per-adapter").
- Adapter *files* stay per-capability (do **not** introduce a shared `adapters/` dir — that breaks the
  write-scope fences). Only the *construction* moves up.

This directly closes the code-followups' "LIVE remaining" item and removes the audit's "4× client
construction" finding.

### Q5. Safe, behavior-preserving refactor ORDER

The repo has a **golden e2e oracle + 100% coverage + depcruise + knip in `verify`** — every step must
keep `verify` green and behavior identical. Order chosen so each step is independently shippable and the
fences are turned on *last* (only after the tree already satisfies them), so depcruise never blocks a
half-done move. Confidence: HIGH (ordering rationale); the steps themselves are the already-scoped
follow-ups.

| # | Step | New / Modified | Why this order | `verify` interaction |
|---|------|----------------|----------------|----------------------|
| **1** | **Create `contracts/` and move the shared DTOs down** (`RunSummary`/`CompactRunSummary` first — the one real upward violation; then `ReplayCandidate`, `RawReplayStorageEvidence`, `IngestStagingPayload`). Builders stay put. | NEW `src/contracts/*`; MODIFY imports across `run/ evidence/ discovery/ storage/ staging/` | Removes the **only existing fence violation** before any fence is enforced. Pure move — types only, zero runtime change → golden oracle + coverage unaffected. **knip** confirms no orphaned re-exports. | green throughout; knip catches dangling old `run/types.ts` exports |
| **2** | **Composition-root client consolidation** — build one `S3Client` + one `pg.Pool` in `commands/`, inject; delete `*FromConfig`. | MODIFY `commands/* run/* storage/* checkpoint/* evidence/* staging/* check/*` | Behavior-preserving (same client config, fewer instances). Do **after** contracts so adapter signatures are stable. Touches many files but each is a mechanical "accept injected client" change the golden oracle covers. | green; **knip** flags the now-dead `*FromConfig` factories to delete |
| **3** | **God-file decomposition within bands** (`run-once`, `discover`, `source-client`, `replay-byte-client`) — split, remove `oxlint-disable max-lines`. | MODIFY (split into sibling files in the same band) | Splits are easier once contracts + injected clients have simplified these files. Same-band moves → no fence implications. | green; removing the disable is the proof; coverage stays 100% per split |
| **4** | **Wire the `.dependency-cruiser.cjs` fence preset** (Q3 rules) into `verify` after `typecheck`, with the composition-root exemption + diagnostics read-only carve-out. | NEW preset; MODIFY `verify` chain (already has a generic depcruise step — replace generic with the fence preset) | **Last.** The tree now already satisfies every fence (steps 1–3), so turning them on is a no-op that *locks in* the work and prevents regression. Turning fences on earlier would block the very moves that fix them. | this step's success criterion *is* depcruise green; activates the fetcher reviewer's layer checks |

**Build-order rationale in one line:** *contracts home first* (removes the upward edge), *clients-at-root
second* (stabilizes adapter seams), *god-file splits third* (now mechanical), *fences enforced last*
(lock-in, never a blocker). This is the inverse of "enforce-then-fix," which would wedge the gate.

---

## Recommended Project Structure

```
src/
├── cli.ts                      # COMMAND — registration only (buildCli, resolveDependencies, 4× action())
├── commands/                   # COMMAND — composition root: load config, build clients ONCE, assemble, dispatch
│   ├── check.ts
│   ├── contract-check.ts
│   ├── discover.ts
│   └── run-once.ts
├── run/                        # ORCHESTRATION — cycle sequencing, checkpoint/resume decision, summary builder
│   ├── orchestrator.ts
│   ├── ingest-page.ts
│   └── summary.ts              # builds RunSummary (type lives in contracts/)
├── discovery/ storage/ staging/ checkpoint/ evidence/   # CAPABILITY + their *-client/*-store/*-repository ADAPTERS
├── check/ contract-check/      # CAPABILITY — read-only DIAGNOSTICS sub-band (may read adapters, never write path)
├── source/                     # CROSS-CUTTING — resilience primitives (retry/backoff/throttle/pacing/classify)
├── contracts/                  # CROSS-CUTTING (graph bottom) — cross-band DTOs + their Zod schemas
├── errors/  logging/           # CROSS-CUTTING — typed error base, redacting pino logger
└── config.ts                   # CROSS-CUTTING — Zod config, validated once at boot
```

### Structure Rationale

- **`contracts/` at graph bottom:** the only legal home for a DTO consumed by a band below its
  producer (the `RunSummary`→`evidence/` case). Every band imports it downward; it imports nothing.
- **Adapters inside their capability dir, not a shared `adapters/`:** keeps the per-package write-scope
  fences enforceable (`from.pathNot` of `pg`/`@aws-sdk` is meaningful only because each client lives in
  exactly the folders allowed to touch it).
- **`commands/` = composition root:** the single place clients are `new`'d and injected — the top of
  the graph, never the `from` of a downward fence.

---

## Architectural Patterns

### Pattern 1: Cross-cutting shared-kernel `contracts/` module

**What:** DTOs touched by ≥2 bands live in one bottom-of-graph module; producers stay in their band.
**When to use:** any value crossing a band boundary, *especially* one consumed below its producer.
**Trade-offs:** + kills upward imports structurally; + co-locates server-2-facing contract surfaces.
− a `contracts/` dir can rot into a junk-drawer if local-only types drift in — guard with the rule
"shared by ≥2 bands only."

```ts
// contracts/run-summary.ts  — the TYPE
export type RunSummary = { runId: string; counts: StageCounts; /* … */ };
// run/summary.ts  — the BUILDER stays in orchestration
export const buildRunSummary = (deps: …): RunSummary => { /* … */ };
// evidence/s3-evidence-store.ts  — imports the type DOWNWARD, never reaches into run/
import type { RunSummary } from '../contracts/run-summary.js';
```

### Pattern 2: Composition-root DI (factory functions, no container)

**What:** one `S3Client` + one `pg.Pool` built once in `commands/`, injected into every adapter.
**When to use:** every single-binary Node service — until the graph is genuinely container-complex.
**Trade-offs:** + no framework, + testable seams for free via `create…(deps)`; − wiring is manual
(fine at this size).

```ts
// commands/run-once.ts — the composition root
const config = loadConfig();                       // §C, before any side effect
const s3 = new S3Client(toS3Config(config));       // built ONCE
const pool = new pg.Pool(toPgConfig(config));      // built ONCE
const deps = assembleRunOnceDeps({ s3, pool, config, logger });
await deps.runner.runOnce();
```

### Pattern 3: Fences-as-fitness-function (dependency-cruiser, enforced last)

**What:** the eight §A fences as `forbidden` rules in `.dependency-cruiser.cjs`, run in `verify`.
**When to use:** once the tree already satisfies them (refactor step 4), to lock in and prevent drift.
**Trade-offs:** + executable architecture, regression-proof; − cannot distinguish read-vs-write
(diagnostics band needs a reviewer rule on top, not a depcruise rule).

---

## Data Flow

### Ingest cycle (run-once)

```
commands/run-once.ts  (load config → build S3 + pg ONCE → assemble deps)
        ↓
run/ orchestrator  (checkpoint load → resume cursor → per-page loop)
        ↓ discover            ↓ fetch+store          ↓ stage
discovery/ (read-only) → storage/ (S3 write) → staging/ (pg write, ON CONFLICT DO NOTHING)
        ↓                                              ↓
   ReplayCandidate                          IngestStagingPayload   ← both from contracts/
        ↓
run/summary.ts → RunSummary (contracts/) → evidence/ persists it (downward import)
```

### Idempotency / resume flow

```
checkpoint/ (durable progress, narrows re-scan window)  →  run/ decides resume cursor
staging unique key (checksum + source identity) + ON CONFLICT DO NOTHING  →  the actual guarantee
```

---

## Scaling Considerations

| Scale | Adjustments |
|-------|-------------|
| One scheduled run | Current shape is correct; nothing to change. Single-threaded with `p-limit` fan-out. |
| Larger corpus / longer runs | Tune `FETCH_CONCURRENCY` + AIMD throttle (already in `source/`); checkpoint already bounds re-scan on restart. No architectural change. |
| Multiple concurrent runners | The staging unique key already makes concurrent inserts safe (`ON CONFLICT DO NOTHING`); S3 keys are checksum-deterministic. Already supported — no redesign. |

### Scaling Priorities

1. **First bottleneck:** source politeness / rate limits — handled by `source/` throttle+pacing, a
   cross-cutting concern, no structural change.
2. **Second bottleneck:** pg write contention under high concurrency — the unique-key + `ON CONFLICT`
   design absorbs it; if it ever matters, batch staging writes within `staging/` (adapter-local, no
   fence impact). The v3.1 watch pre-fetch dedup + non-throwing `ON CONFLICT DO NOTHING` staging dedup
   directly reduce this load.

---

## Anti-Patterns

### Anti-Pattern 1: A shared `adapters/` directory

**What people do:** collect all `*-client`/`*-store` files into one `src/adapters/` folder.
**Why it's wrong:** it makes the per-package write-scope fences unenforceable — `from.pathNot` of `pg`
and `@aws-sdk` only works because each client lives exactly in the folders permitted to import it. A
shared adapter dir co-locates the PG writer with S3 writers and lets a stray import leak.
**Do this instead:** adapters stay inside their capability dir; only client *construction* moves up.

### Anti-Pattern 2: Introducing port-interface files / a DI container "for cleanliness"

**What people do:** add `ports/*.ts` interfaces and/or tsyringe to "do hexagonal properly."
**Why it's wrong:** the `type Foo + createFoo(deps)` factory already provides the swappable seam; extra
abstraction is ceremony without domain logic in a single CLI binary (§A convergence note 1).
**Do this instead:** keep factory contracts; wire by hand in the composition root.

### Anti-Pattern 3: Enforcing fences before the tree satisfies them

**What people do:** wire the depcruise preset first, then refactor under a red gate.
**Why it's wrong:** the fences block the very imports the refactor is meant to remove — you wedge the
`verify` gate and can't ship incremental steps.
**Do this instead:** move contracts → consolidate clients → split god-files → **then** enforce fences
(refactor step 4).

### Anti-Pattern 4: Treating checkpoint as the idempotency mechanism

**What people do:** rely on checkpoint state to avoid duplicates.
**Why it's wrong:** a lost/corrupt checkpoint would then re-create rows; correctness must not depend on
soft progress state.
**Do this instead:** the staging unique natural key + `ON CONFLICT DO NOTHING` is the guarantee;
checkpoint only narrows the re-scan window.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| S3-compatible storage | one injected `S3Client` (`@aws-sdk/client-s3`), used only by `storage/ checkpoint/ evidence/` + read-only `check/` | fence #5; built once at composition root |
| PostgreSQL (staging only) | one injected `pg.Pool`, used only by `staging/` + read-only `check/` | fence #4; **never** a `server-2` business table |
| HTTP/SSH replay source | injected source client in `discovery/`/`storage/` adapters, resilience policy from `source/` | fence #6/#7; read-only extractor |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `commands/ ↔ run/` | direct call, deps injected | composition root → orchestrator |
| `run/ ↔ capabilities` | direct call, factory-created | orchestration composes capabilities, not raw clients (fence #2) |
| capability ↔ its adapter | injected client via `create…(deps)` | adapter is the sole I/O surface |
| any band ↔ `contracts/` | downward type import only | the shared-kernel rule (Q2) |

### `verify` gate integration (for the roadmapper)

- **dependency-cruiser:** replace the current *generic* depcruise step with the **fence preset** (Q3
  rules) after `typecheck`; this is refactor **step 4** and is where the eight fences become
  regression-proof. The fetcher reviewer's layer checks switch on at the same moment.
- **knip:** already in `verify` — the safety net for steps 1–2 (catches orphaned `run/types.ts`
  re-exports and the dead `*FromConfig` factories left after the moves). Resolving the `no-leak.ts`
  orphan named in the milestone goals is a knip-surfaced item.
- **coverage (100% V8) + golden e2e oracle:** the behavior-preservation guarantee for every step;
  type-only moves (step 1) and injected-client moves (step 2) must leave both untouched.
- **oxlint `max-lines`:** the god-file splits (step 3) remove the `oxlint-disable max-lines`
  suppressions; the split *is* the fix (ADR 0005 — never silence a structural gate).

---

## Sources

- [solidstats-fetcher-ts-conventions/SKILL.md §A] — the decided five-band architecture + eight fences (in-repo, HIGH)
- [fetcher-architecture-conventions.md / fetcher-architecture-code-followups.md] — Variant A + the live follow-ups (in-repo, HIGH)
- [khalilstemmler — The Dependency Rule](https://khalilstemmler.com/wiki/dependency-rule/) — why shared DTOs live at the graph bottom (MEDIUM)
- [matthiasnoback.nl — Layers, ports & adapters, Part 2](https://matthiasnoback.nl/2017/08/layers-ports-and-adapters-part-2-layers/) — layered-hexagonal synthesis, no separate port files needed (MEDIUM)
- [sverweij/dependency-cruiser — rules-reference.md](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) — `forbidden`/`allowed`, `pathNot` composition-root exemption, `dependencyTypes` per-package restriction (HIGH, official docs)
- [Xebia — Taking Frontend Architecture Serious With dependency-cruiser](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/) — depcruise as architecture fitness function for layer boundaries (MEDIUM)
- [Synapse Studios — dependency-cruiser config (NestJS)](https://docs.synapsestudios.com/implementation/frameworks/nest/dependency-cruiser-config) — published layered/clean ruleset to borrow (MEDIUM)
- [thetshaped.dev — DI in Node.js & TypeScript](https://thetshaped.dev/p/dependency-injection-in-nodejs-and-typescript-dependency-inversion-part-no-body-teaches-you) / [RisingStack — DI in Node.js](https://blog.risingstack.com/dependency-injection-in-node-js/) — factory functions + composition root, no container needed for a single binary (MEDIUM)

---
*Architecture research for: scheduled ingest/extract CLI (replays-fetcher v3.1 compliance refactor)*
*Researched: 2026-06-20*
