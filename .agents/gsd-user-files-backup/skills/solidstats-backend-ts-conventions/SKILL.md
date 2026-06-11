---
name: solidstats-backend-ts-conventions
description: >
  Prescriptive architecture and coding conventions for the SolidStats TypeScript/Fastify backend
  (server-2 is the primary subject; a shared baseline also binds the replays-fetcher CLI). Defines
  the 4-layer architecture (controllers → usecases → services → repositories), module layout,
  naming, the typed error system, TypeBox schema discipline, Kysely data access, Fastify-plugin
  dependency injection, and the security/async/observability/resource rules. Consult this before
  writing or changing any backend TypeScript; it is also the rule source that
  solidstats-backend-ts-code-review enforces.
  Use this proactively — read it before writing or changing ANY TS/Fastify backend code
  (server-2, replays-fetcher), even when the task doesn't say "conventions"; standardizing the code is
  worth a few tokens.
  Triggers: "backend conventions", "fastify route", "add endpoint", "write a service",
  "write a repository", "add a migration", "kysely query", "queue consumer", "backend module",
  "конвенции бэкенда", "напиши эндпоинт", "добавь роут", "сервис на fastify", "напиши репозиторий",
  "добавь миграцию", "воркер очереди", "структура модуля бэкенда".
---

# SolidStats Backend Conventions — TypeScript / Fastify

**This skill builds on [`solidstats-process-ts-standards`](../solidstats-process-ts-standards/SKILL.md) — read it first.**
That skill owns the TypeScript baseline shared across all SolidStats TS repos: tsconfig
strictness flags, code style (`type` over `interface`, no `any`, no `as`), the ESLint 10
setup, Node 25 / pnpm 11, Prettier defaults, and Vitest 4 / V8 coverage gates. This skill
adds only the **Fastify/backend HOW** on top of that baseline.

These are the **prescriptive** conventions for the SolidStats backend: what good backend code
*should* look like, not a description of whatever exists today. Where current code diverges, the
code is brought into line over time — the convention wins. This skill is the rule source that
[`solidstats-backend-ts-code-review`](../solidstats-backend-ts-code-review/SKILL.md) enforces and
that [`solidstats-backend-ts-tests`](../solidstats-backend-ts-tests/SKILL.md) assumes.

## Scope

- **Primary subject — `server-2`**: the Fastify HTTP backend (Fastify 5, TypeBox, Kysely/pg,
  amqplib, S3, pino, prom-client, envalid). All sections apply.
- **Shared baseline — `replays-fetcher`** (a `commander` CLI; Zod, no Fastify/amqplib): the
  layering discipline (§A), naming (§B), error system, async rules, logging, config, and TS
  strictness apply. The Fastify-, TypeBox-, and HTTP-specific sections are marked **[HTTP]** and do
  not bind the CLI.

This skill absorbs the relevant Fastify, Node, and API-design best practices — those generic
skills are not installed separately; their guidance lives here, tuned to SolidStats.

## Reference map

The detailed rules live in `references/`. Read the one you need:

| File | Covers |
|------|--------|
| `references/layers.md` | Per-layer rules: controllers/routes, usecases, services, repositories, and Fastify-plugin DI. |
| `references/schemas-and-data.md` | TypeBox schemas, the typed error system, Kysely data access & query rules, enums/filters/pagination, config/env. |
| `references/correctness-and-quality.md` | The design & correctness rules: LSP, async safety, security depth (IDOR, mass assignment) + security/runtime hardening, queue reliability, SOLID thresholds, DRY, observability (§Z), log diagnosability (§AA), resource lifecycle (§AB) — plus code-quality bugs, imports, comments. |

This SKILL.md owns the spine that everything else hangs off: the architecture, the module layout,
and naming.

---

## A. Architecture, layers & module structure

The backend is split into **feature modules** under `src/modules/<feature>/`, plus cross-cutting
infrastructure under `src/infra/`. Most rules in this skill are really one rule — *keep each layer
doing its own job* — so start with the layer responsibilities; the specific checks then read as
consequences, not dogma.

### Layer responsibilities (bottom-up)

| Layer | Responsibility | Depends on |
|-------|----------------|------------|
| **repository** | Data-access adapter. Builds and runs Kysely queries, returns typed rows. No business logic, no HTTP. | (db) |
| **service** | Works with repositories; returns **validated** domain data; carries minimal business logic (guards, simple checks); raises typed domain errors. | repositories |
| **usecase** *(optional)* | Orchestrates **multiple** services into one unit of business logic and owns the transaction boundary. | services |
| **controller** (Fastify route + handler) | Wraps one unit of business logic into an HTTP endpoint — routing, request/response schema, status code. No logic of its own. | usecases (or a service directly, for plain CRUD) |

The **usecase layer is optional**: introduce it only when an operation orchestrates more than one
service or has non-trivial assembly/transaction logic. Plain CRUD goes straight from controller to
service.

### Dependency rules

- Dependencies point **downward only**: `controller → usecase → service → repository`. A lower
  layer never imports an upper one — a repository knows nothing about services; a service never
  calls a usecase.
- No layer reaches **past** the one below it for business flow: a controller never calls a
  repository directly; a usecase never issues a Kysely query. (A controller may call a service
  directly for plain CRUD with no orchestration.)
- **Cross-module sharing happens only through a module's service contract.** Module A may depend on
  module B's exported service *interface* (`BService`) — nothing else. Importing B's repository,
  usecase, route, schema, or error internals into A is a violation.
- Genuinely cross-cutting code lives in `src/infra/` (db, queue, storage, logging, metrics, health,
  runtime) — never copied between modules or pulled sideways from a peer module.

### Module layout

Every feature module follows this layout (files; small modules may inline, but the role split
stays):

```
src/modules/<feature>/
├── <feature>.routes.ts        # [HTTP] Fastify plugin — registers routes (the controller layer)
├── <feature>.controller.ts    # [HTTP] handlers, when separated from route registration
├── <feature>.usecase.ts       # optional — orchestration across services + transaction boundary
├── <feature>.service.ts       # business logic; returns validated data; raises typed errors
├── <feature>.repository.ts    # Kysely data access only
├── <feature>.schemas.ts       # [HTTP] TypeBox request/response schemas
├── <feature>.errors.ts        # module-specific typed errors + codes
├── <feature>.types.ts         # domain types (derived from schemas / DB row types)
├── <feature>.constants.ts     # enums, status/type unions, route-path constants
└── index.ts                   # public surface — re-exports ONLY the service contract used cross-module
```

- New files land in the correct role file/dir — no flat modules where a service sits beside a
  handler with no layer separation.
- `index.ts` exposes only what other modules may consume (the service contract). It never
  re-exports repositories, usecases, routes, schemas, or errors.
- New routes are registered with the app (a single place wires module route-plugins with their
  prefix/tag), not scattered.
- Cross-cutting clients (db, queue, storage) are **not** imported ad-hoc — they are provided by
  `src/infra/` plugins and injected (see DI, `references/layers.md`).

---

## B. Naming

Deviation from naming is a finding. "Reads fine" is not the standard — consistency is, because the
layer of a symbol should be legible from its name.

**Files** — kebab-case with a role suffix: `appeal.service.ts`, `appeal.repository.ts`,
`appeal.routes.ts`, `appeal.schemas.ts`, `appeal.errors.ts`. One role per file.

**Types / contracts** — `PascalCase`. Each layer is a **factory function** that returns a typed
contract object — a `type` for the contract plus a `create…` factory:

```ts
type AppealService = { getById(id: string): Promise<Appeal>; /* … */ };
const createAppealService = (deps: AppealServiceDeps): AppealService => ({ /* … */ });
```

Factories — not classes — are the SolidStats default: they are trivial to test (pass fake deps,
no `new`), avoid `this`/binding pitfalls, and compose cleanly with Fastify decoration. Contracts
are plain `type`s/`interface`s with **no `I`-prefix** (`AppealService`, not `IAppealService`).
Lower layers are typed against the contract `type`, never a concrete construction — that is what
makes the layering swappable and testable.

**Functions / variables** — `camelCase`, no abbreviations: `userId` not `uid`, `replayId` not
`rid`. **Constants** that are true constants — `UPPER_SNAKE_CASE`. **Enums / unions** —
`PascalCase` type, with values as a `StrEnum`-style const object or string-literal union (see
`references/schemas-and-data.md`).

**Identifiers** — Steam identity is `steamId64` (string); internal numeric ids are `<entity>Id`;
opaque/UUID surrogate keys keep the entity name (`replayId`, `jobId`). Correlate logs and jobs by
`jobId` / `replayId` (see observability in `references/correctness-and-quality.md`).

---

## Using this skill

When writing or changing backend code, consult the spine here for placement and naming, then the
relevant `references/` file for the layer or concern you are touching. When in doubt about whether
something is a convention violation, the rule is: does it keep each layer doing its own job, does
it preserve the typed contract, and does it match an explicit rule here? If yes to all, it is fine.
