---
name: solidstats-fetcher-ts-conventions
description: >
  Prescriptive architecture and coding conventions for replays-fetcher — the SolidStats
  TypeScript ingest CLI (commander, Zod 4, pg, @aws-sdk/client-s3, pino, p-limit; scheduled
  run-once shape; NO HTTP framework). Defines the five-band ingest-pipeline architecture,
  the hard ingest-boundary invariants (no replay parsing, S3-raw + staging/outbox writes only,
  idempotent re-discovery, auditable source evidence), the Zod config form, and the CLI error
  boundary (exit codes + run summary). Builds on solidstats-shared-backend-ts-standards and
  solidstats-shared-ts-standards. Use this proactively — read it before writing or changing
  ANY code in replays-fetcher, even when the task doesn't say "conventions"; standardizing the
  code is worth a few tokens. It is also the rule source that solidstats-fetcher-ts-code-review
  enforces.
  Triggers: "fetcher", "ingest", "ingest stage", "discovery", "discover replays", "staging
  record", "staging table", "outbox", "checkpoint", "run-once", "S3 raw object", "source
  evidence", "fetch replay bytes", "fetcher conventions",
  "фетчер", "инжест", "напиши стадию инжеста", "стадия инжеста", "дискавери реплеев",
  "стейджинг", "запись в staging", "чекпоинт", "выгрузка в S3", "скачай реплей",
  "конвенции фетчера".
---

# SolidStats Fetcher Conventions — TypeScript / Ingest CLI

**This skill builds on [`solidstats-shared-backend-ts-standards`](../solidstats-shared-backend-ts-standards/SKILL.md) — read it first.**
That skill owns the stack-neutral service rules the fetcher inherits — naming and factory
contracts, the typed error base, enums, config & validated-input discipline, and (in its
`references/correctness-and-quality.md`) external adapters, async safety, process lifecycle,
LSP/SOLID/DRY, utility libraries, observability (§Z), log diagnosability (§AA), and resource
lifecycle (§AB). It in turn builds on
[`solidstats-shared-ts-standards`](../solidstats-shared-ts-standards/SKILL.md) — the TS/Node
baseline (tsconfig strictness, code style, ESLint 10, Node 25 / pnpm 11, Prettier, Vitest 4 /
coverage gates). Read chain: **this skill → solidstats-shared-backend-ts-standards → solidstats-shared-ts-standards.**

This skill adds only the **ingest-pipeline HOW** on top of that shared layer; shared rules are
cited as `[std: §X]` / `[std: correctness §X]` and never restated here. These are the
**prescriptive** conventions for the fetcher: what good ingest code *should* look like, not a
description of whatever exists today. Where current code diverges, the code is brought into line
over time — the convention wins. This skill is the rule source that
[`solidstats-fetcher-ts-code-review`](../solidstats-fetcher-ts-code-review/SKILL.md) enforces and
that [`solidstats-fetcher-ts-tests`](../solidstats-fetcher-ts-tests/SKILL.md) assumes.

## Scope

- **Subject — `replays-fetcher` only**: the Solid Stats ingest service. It discovers new OCAP
  replay files from the external replay source, stores raw replay objects in S3-compatible
  storage, and writes ingestion staging/outbox records for `server-2` to promote.
- **Stack**: a `commander` CLI; Zod 4 (config + external-payload validation), `pg` (raw SQL,
  staging/outbox writes only), `@aws-sdk/client-s3`, pino, `p-limit`.
- **Runtime shape**: a scheduled **run-once job** — `check`, `discover --dry-run`, `run-once`.
  **No HTTP framework**: no Fastify, no web server in v1 — do not introduce one.
- `server-2` is governed by [`solidstats-server-ts-conventions`](../solidstats-server-ts-conventions/SKILL.md);
  this skill never binds it.

### Inherited — do not restate

| Concern | Home |
|---------|------|
| Naming, factory contracts (`type` + `create…(deps)`), identifiers | [std: SKILL §A] |
| Typed error base (`AppError`, snake_case codes, cause chains, `ExternalServiceError` split) | [std: SKILL §B] |
| Enums & constants (`as const` + derived union) | [std: SKILL §C] |
| Config/env discipline (validate at boot, no `process.env` scatter, no `NODE_ENV` branching) | [std: SKILL §D] — Zod form in §C below |
| External adapters, async safety, process lifecycle, LSP, SOLID/DRY, utility libraries | [std: correctness] |
| Observability (§Z), log diagnosability (§AA), resource lifecycle (§AB) | [std: correctness §Z/§AA/§AB] — boundary defined in §D below |
| tsconfig/ESLint/Prettier/Vitest baseline | `solidstats-shared-ts-standards` |

---

## A. Architecture — the ingest pipeline (five bands)

> **APPROVED (2026-06-13).** This architecture — in-house Variant A converged with the
> deep-research pass, all layout questions closed (Command-band split, diagnostics band,
> `RunSummary`→`types/`, one injected client) — is signed off. The fences below ship as the
> `.dependency-cruiser.cjs` preset and the fetcher reviewer's layer checks activate **when the
> fetcher trio is wired into the `replays-fetcher` repo** (migration step) — until then the code
> still predates the refactor (split `cli.ts`, move `RunSummary`, dedup the S3 client; see
> `skills/decisions/research/gate-suppression-backlog.md` §D). Debate record:
> `skills/decisions/research/` (`architecture-convergence.md` §1).

The fetcher is not a Fastify module tree — it is a pipeline. Five bands, dependencies point
downward only:

| Band | Holds today | Responsibility | May depend on |
|------|-------------|----------------|---------------|
| **Command** | `cli.ts` + `commands/` | `cli.ts` is **command registration only**: `buildCli` + `resolveDependencies` + the four `program.command().action()` registrations, each action delegating to its per-command handler in `commands/`. Orchestration logic **never** lives in `cli.ts` — it belongs in `run/`. A `commands/` module (one per command: `check`, `contract-check`, `discover`, `run-once`) parses/validates options, assembles dependencies, and calls the orchestrator. Thin by construction — no `/* eslint-disable max-lines */` needed or permitted (see §A note below). | Orchestration |
| **Orchestration** | `run/` | One ingest cycle: discover → fetch bytes → store raw → write staging/evidence, with checkpoint/resume and a run summary. Owns sequencing, pacing, and the idempotency boundary. (The fetcher's "usecase".) | Capabilities, Cross-cutting |
| **Capability** | `discovery/ storage/ staging/ checkpoint/ evidence/ contract-check/ check/` | One ingest job each: returns validated domain data, raises typed errors, delegates external I/O to its adapter. (The "service".) | own Adapter, Cross-cutting |
| **Adapter** | `*-client / *-store / *-storage / *-repository` (`source-client`, `s3-raw-storage`, `s3-checkpoint-store`, `s3-evidence-store`, `postgres-staging-repository`, `replay-byte-client`) | The only code that talks to S3 / PostgreSQL / the HTTP source. The write-scope boundary. (The "repository/adapter".) Each adapter takes its client **injected** (`sender` / `pool` / `http`); the shared S3 / PostgreSQL / HTTP client is built **once** at composition and passed into every adapter — never a per-adapter `*FromConfig` that `new`s its own (the *External adapters* rule, [std: correctness]). Adapter files stay **inside their capability dir** — they are not pulled into a shared `adapters/` dir (that would break the write-scope fences and co-locate unrelated operations). | Cross-cutting |
| **Cross-cutting** | `config.ts errors/ logging/ source/ types/` | Config validation, typed error system, logger, source-resilience primitives (retry/backoff/throttle/pacing/concurrency/classify-failure), and `types/` — **cross-band data contracts** (e.g. the `RunSummary` shape) that more than one band needs. The type lives here so a lower band (an adapter like `evidence/`) never imports it upward from `run/`; the *builder* of such a value stays in its owning band (`run/summary.ts` builds `RunSummary`). Imported by any upper band; imports none upward. (The "infra".) | — |

### Command band — god-file constraint

`cli.ts` must stay thin enough that `max-lines` is never in play. The rule: `cli.ts`
contains `buildCli`, `resolveDependencies`, and exactly the four
`program.command().action()` wiring calls — each action body is a one-liner that
delegates to `commands/<command>.ts`. All option parsing, dependency assembly, and
orchestrator dispatch live in `commands/<command>.ts`, not in `cli.ts`.

The **current `cli.ts` is 822 lines** and carries `runStoreRawDiscovery`,
`stageRawEvidence`, `storeRawCounts`, and other orchestration functions behind a
`/* eslint-disable max-lines */` suppression — that is exactly the anti-pattern this
band split removes. Splitting it surfaces that the orchestration was misplaced: those
functions belong in `run/`. Once the split is done, `cli.ts` should be well under any
reasonable line-count limit with no suppression needed.

**Lint-suppression policy**: structural limits (max-lines, max-lines-per-function) are
split, never disabled — `/* eslint-disable max-lines */` on a file is a smell that the
file holds too many responsibilities. Cross-reference
[`solidstats-shared-ts-standards §C`](../solidstats-shared-ts-standards/SKILL.md) for
the full lint-suppression policy.

### Convergence adjustments (research-driven)

1. **Keep the layering light — no port ceremony.** The factory-contract pattern (typed `type` +
   `create…(deps)`, [std: SKILL §A]) already gives us swappable adapter interfaces for free; do
   NOT add separate port-interface files/abstractions on top — ceremony without domain logic.
2. **Flat capability dirs stay; no `stage/` re-nesting.** The current
   `discovery/ storage/ staging/ checkpoint/ evidence/` layout is the pipeline-stage taxonomy
   already — renesting adds churn, not legibility. The open question is closed: **flat**.
3. **Diagnostics band named.** `check/` and `contract-check/` form a **read-only diagnostics
   band**: they may import adapters/capabilities to *read*, never the write path. Becomes
   fence #8.
4. **Idempotency is orchestration + database constraint, not checkpoint magic.** `run/` owns
   resume decisions; the staging table carries a **unique natural key (checksum + source
   identity)** and writes are `ON CONFLICT DO NOTHING`-style idempotent; checkpoint state only
   narrows the re-scan window. Resilience primitives live in cross-cutting `source/`, but their
   **policies are configured and applied by orchestration** per stage — adapters don't hard-code
   retry semantics.

   **`source/` resilience API shape.** Primitives in `source/` follow the factory-contract
   pattern ([std: SKILL §A]). Orchestration constructs a policy and passes it to
   capabilities/adapters — adapters never choose their own retry semantics:

   ```ts
   // source/types.ts
   export type RetryPolicy = { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };
   export type ThrottlePolicy = { requestsPerSecond: number };
   export type ConcurrencyPolicy = { limit: number };
   export type ResiliencePolicy = {
     retry: RetryPolicy;
     throttle: ThrottlePolicy;
     concurrency: ConcurrencyPolicy;
   };
   export type WithResilience = { resiliencePolicy: ResiliencePolicy };

   // run/orchestrator.ts — orchestration wires the policy into the capability factory
   const discoveryClient = createSourceClient({ ...deps, resiliencePolicy: policy.discovery });
   ```

5. **Cross-band data contracts live in cross-cutting `types/`.** A type shared by more than one band
   — e.g. `RunSummary`, which orchestration (`run/`) produces and the evidence adapter (`evidence/`)
   persists — lives in `types/`, not in `run/`. Today `RunSummary` is in `run/types.ts` and
   `evidence/s3-evidence-store.ts` imports it **upward** (a layer violation); moving the *type* to
   `types/` fixes it while the *builder* (`run/summary.ts`) stays in orchestration. Adapters import
   the contract downward, never reach up into `run/`.

6. **One external client per backend, built once and injected.** S3 / PostgreSQL / HTTP clients are
   constructed a single time at composition (the `commands/` handler / composition root) and injected
   into every adapter that needs them (the adapters already accept a `sender`/`pool`). The current
   `*FromConfig` convenience factories — each doing its own `new S3Client({...})`, four times over —
   collapse into one shared client. This is the [std: correctness → External adapters] rule applied:
   a client is created once and injected, never per-adapter. The adapter *files* still stay per
   capability (fence layout) — only the client construction is shared. *(Code cleanup tracked in
   `skills/decisions/research/gate-suppression-backlog.md`.)*

### Boundary fences (→ the future depcruise `forbidden` preset)

These encode the §B invariants as enforceable import rules — the executable form of the
architecture. When §A is signed off they ship as the `.dependency-cruiser.cjs` preset and the
fetcher reviewer's layer checks switch on:

1. **Downward-only.** `command → orchestration → capability → adapter`; a lower band never
   imports an upper one. Cross-cutting imports nothing upward.
2. **No band-skipping.** Command never imports an adapter/capability internal directly; it goes
   through orchestration. Orchestration composes capabilities, not raw clients.
3. **No replay parsing.** No module imports an OCAP parser / replay-content reader — parsing
   belongs to `replay-parser-2`. (`forbidden` on parser packages + any content-decode path.)
4. **PG write scope.** Only `staging/` (writes) and the read-only diagnostics band (`check/`) may
   import the PostgreSQL client — no business-table write can leak in via a stray `pg` import
   elsewhere. Diagnostics only ping/read (never write); depcruise allows the import, review enforces
   read-only. The client is built once at composition and injected — no adapter `new`s its own.
5. **S3 write scope.** Only `storage/ checkpoint/ evidence/` (writes) and the read-only diagnostics
   band may import the S3 client. One shared S3 client is built once at composition and injected into
   all three stores — no per-adapter `*FromConfig` that constructs its own (today's four `new
   S3Client(...)` calls collapse to one — see the convergence note).
6. **Discovery is read-only.** `discovery/` never imports `storage/` or `staging/`; it produces
   candidates, orchestration wires them to writers.
7. **Resilience is cross-cutting.** `source/` is imported by `discovery/`/`storage/` adapters,
   and never imports them back.
8. **Diagnostics never import the write path.** `check/ contract-check/` may read adapters and
   capabilities; they never import the staging/storage write path.

---

## B. Ingest invariants — hard rules (NOT pending)

Unlike §A, this section is **not** waiting on sign-off: these are the `replays-fetcher` AGENTS
hard rules (Critical Context + Engineering Rules) and bind today. Every rule here is a hard
boundary — a violation is a blocking [🔴] review finding.

- **Never parse replay contents.** Parsing belongs to `replay-parser-2`. No OCAP parser library
  or replay-content reader enters this repo — the fetcher moves bytes and records evidence; it
  never looks inside them.
- **Write scope: S3 raw objects + PostgreSQL staging/outbox records — nothing else.** The
  accepted v1 boundary is S3 raw object write plus staging/outbox records only.
- **Never create or mutate `server-2` business tables** — `replays`, `parse_jobs`,
  `parse_results`, stats, identity, roles, requests, or moderation tables. A direct write to a
  `server-2` business table is a risky override requiring explicit user confirmation and
  planning updates.
- **No RabbitMQ publishing.** `server-2` polls/promotes staging rows, owns deduplication
  decisions, creates parse jobs, publishes RabbitMQ parse requests, receives parser results,
  and persists parsed data. Do not bypass the `server-2` job lifecycle or retry visibility.
- **No stats, identity, or moderation.** Do not calculate public stats, bounty points,
  canonical identity, or moderation decisions. Do not write parser artifacts — those belong to
  the `replay-parser-2` worker output.
- **Idempotent re-discovery.** Repeated discovery of the same replay must not create duplicate
  promoted product records. (§A adjustment 4 — unique natural key + idempotent writes — is the
  structural form of this rule; the rule itself binds regardless of §A's status.)
- **Auditable source evidence is first-class.** Source URL/ID, discovered timestamp, fetch
  timestamp, checksum, object key, size, and fetch status are first-class evidence fields — not
  optional metadata to backfill later.
- **Replay identity = checksum + external source identity** where available.
- **Conflicting duplicates are routed to manual review by `server-2`** — never automatically
  merged by the fetcher.
- **Staging-table DDL ownership — PENDING.** Who owns the staging migration file (which repo,
  which naming convention) is being locked with `server-2` — see `replays-fetcher/.planning`
  and the AGENTS context. Until resolved: NO schema or DDL change ships from this repo without
  first completing the cross-app compatibility protocol below. Do not invent an owner.
- **Cross-app schema compatibility.** The staging table schema, S3 object-key layout, and
  operator-visible status values are `server-2`-facing contract surfaces — `server-2` polls and
  promotes staging rows. The default discipline for staging columns is **additive-only** (new
  nullable columns, new indices); anything breaking (dropping/renaming a column, changing a type,
  altering a unique key) requires the cross-app compatibility protocol in
  [`solidstats-shared-project-standards` §E — Cross-App Compatibility Protocol](../solidstats-shared-project-standards/SKILL.md)
  to be completed with `server-2` first.

---

## C. Config & validation — the Zod form

The discipline is shared — [std: SKILL §D]: validate once at boot and fail fast, everything
reads the validated config object (never `process.env` directly), no config files, no `NODE_ENV`
branching, no top-level config reads, no hardcoded secrets, schema-first types, bound every
field. This section fixes the fetcher's tool form: **Zod 4**.

```ts
// config.ts
import { z } from 'zod';

import { ConfigValidationError } from './errors/config-validation-error.js';

const ConfigSchema = z.object({
  SOURCE_BASE_URL: z.url().max(2048),
  SOURCE_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  S3_ENDPOINT: z.url().max(2048),
  S3_BUCKET: z.string().min(1).max(255),
  S3_ACCESS_KEY_ID: z.string().min(1).max(255),
  S3_SECRET_ACCESS_KEY: z.string().min(1).max(255),
  DATABASE_URL: z.string().min(1).max(2048),
  FETCH_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>; // derived — never a hand-mirrored interface

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigValidationError({ issues: parsed.error.issues });
  }
  return parsed.data;
};
```

- **Types derive from the schema**: `z.infer<typeof X>` — never a parallel hand-written
  interface that can drift [std: SKILL §D].
- **Bound every field**: strings get `.max()`, numbers get `.int().min().max()`, enums are
  `z.enum`. An unbounded externally-sourced field is a DoS vector [🟡] — this binds the config
  schema AND every Zod schema for external-source payloads (discovery listings, source
  metadata): adapters return *validated* domain data (§A band table), so every payload parsed
  from the external source gets a bounded Zod schema at the adapter boundary.
- **Validate at boot, before ANY side effect**: `loadConfig()` runs first in the command band —
  no S3 client constructed, no `pg.Pool` created, no source request issued, no checkpoint read
  until the config has parsed. Fail before mutating S3 or PostgreSQL.
- **Coerce at the schema** (`z.coerce.number()`, `z.coerce.boolean()`) — env vars are strings;
  ad-hoc `parseInt`/`=== 'true'` at call sites is a violation.
- **`safeParse` + a typed error**: boot failure raises `ConfigValidationError` (an `AppError`
  per [std: SKILL §B]) carrying the Zod issues in `details` — a raw `ZodError` never escapes to
  the operator. §D maps it to exit code `2`.
- Secrets (`S3_SECRET_ACCESS_KEY`, credentials in `DATABASE_URL`) come from env only and are
  **never logged** — the run summary and error details never include the config object.

---

## D. CLI error boundary — exit codes + the run summary

Capabilities and adapters raise typed errors per [std: SKILL §B] (`AppError` subclasses;
`ExternalServiceError` for upstream failures) and never know about exit codes or the process.
Transport mapping happens in exactly **one** place: the top-level handler in the command band.

| Exit code | Meaning |
|-----------|---------|
| `0` | Run completed; run summary emitted. A run that staged zero new replays is still `0`. |
| `1` | Operational failure — a typed `AppError` (or an unexpected error) aborted the run; the cause is recorded in the failure log/run summary. |
| `2` | Config/usage error — `ConfigValidationError` at boot or bad CLI arguments. Nothing was touched: config validates before any side effect (§C). |

The **run summary** is a structured log object emitted exactly once per run: counts per stage
(discovered, fetched, stored, staged, skipped-duplicate, failed), run duration, checkpoint
advance, and — on failure — the typed error `code`. It is the fetcher's operational surface,
the equivalent of server-2's `prom-client`/`/health` [std: correctness §Z]. Item-local failures
that orchestration's policy tolerates do not flip the exit code — they are counted in the
summary (`failed: n`) and logged per item; exit `1` means the run itself aborted.

**This handler + the run summary ARE the §AA logging boundary for this repo**
[std: correctness §AA]. Consequences:

- Every error that propagates to the top is recorded here — do **not** add defensive
  `try/catch` in capabilities just to log-and-rethrow, and do **not** flag inner methods for
  "no logs" when the boundary already covers the propagating error.
- §AA still binds what the boundary cannot see: errors swallowed before they reach it, which
  branch ran and why, and upstream status/body on adapter failure paths.

```ts
// cli.ts — the only place that maps errors to the process
const runCommand = async (): Promise<void> => {
  const config = loadConfig(); // §C — before any side effect
  const deps = assembleDeps(config); // S3 client, pg pool, source client, logger
  const summary = await deps.runner.runOnce();
  deps.logger.info({ summary }, 'run complete');
};

runCommand().catch((err: unknown) => {
  if (err instanceof ConfigValidationError) {
    logger.error({ err }, 'invalid config — nothing was run');
    process.exitCode = 2;
  } else if (err instanceof AppError) {
    logger.error({ err }, 'run failed');
    process.exitCode = 1;
  } else {
    logger.fatal({ err }, 'unexpected error — programmer bug');
    process.exitCode = 1;
  }
});
```

- Set `process.exitCode`; never call `process.exit()` from the handler — it can drop buffered
  pino output and skip resource teardown. If a hung handle keeps the process alive after the
  run, fix the leak [std: correctness §AB]; don't mask it with `process.exit()`.
- Pass `{ err }` (the error object), not `err.message` — the structured logger serializes the
  stack [std: correctness §AA].
- An unexpected non-`AppError` is a programmer bug: logged at `fatal` with the error object,
  exits non-zero, never swallowed to "finish the run".

---

## Using this skill

When writing or changing fetcher code, place it with §A (which band, which fence applies),
check it against the §B invariants (hard, blocking), use the §C Zod form for anything parsed
from env or the source, and let §D own every exit code and run-summary decision. For naming,
errors, enums, async, adapters, and observability — go to
`solidstats-shared-backend-ts-standards`; this skill never restates it.
