---
name: solidstats-shared-backend-ts-standards
description: >
  Shared standards for every SolidStats TypeScript backend repo. The audience is defined by
  the name's semantics, not by a fixed list: any repo that is TypeScript AND backend (server,
  worker, ingest CLI) inherits this skill — currently server-2 (Fastify HTTP backend) and
  replays-fetcher (ingest CLI); the Rust parser is excluded by `ts`, the React web frontend by
  the backend scope. Owns the stack-neutral rules all such repos inherit: naming and factory
  contracts, the typed error system (base), enums/constants, config & validated-input discipline,
  external adapters, async safety, process lifecycle, LSP, SOLID/DRY thresholds, observability
  (§Z), log diagnosability (§AA), and resource lifecycle (§AB). Builds on
  solidstats-shared-ts-standards. The per-stack skills (solidstats-server-ts-conventions,
  solidstats-fetcher-ts-conventions) hard-require this skill and read it first; each adds only its
  framework/architecture rules on top. Do NOT trigger this for an actual coding task in a specific
  repo — use the matching per-stack skill instead.
  Triggers (meta only): "backend ts standards", "shared service conventions", "typed error system",
  "logging standard", "стандарты сервисного TS", "общие конвенции сервисов", "система
  типизированных ошибок", "стандарт логирования".
---

# SolidStats Backend TS Standards — Shared Service Baseline

This skill is the single source of truth for the **stack-neutral service conventions** shared by
every SolidStats TypeScript backend repo. The audience is intensional — TypeScript AND
backend — not a fixed list: today that means server-2 and replays-fetcher, and any future TS
service inherits it automatically. The per-stack skills own their framework and architecture;
this skill owns the parts that must be identical across all of them:

- [`solidstats-server-ts-conventions`](../solidstats-server-ts-conventions/SKILL.md) — server-2,
  the Fastify HTTP backend — hard-requires this skill, then adds the 4-layer HTTP architecture,
  zod (route schemas), Kysely, and queue/security specifics.
- [`solidstats-fetcher-ts-conventions`](../solidstats-fetcher-ts-conventions/SKILL.md) —
  replays-fetcher, the ingest CLI — hard-requires this skill, then adds the ingest boundary
  invariants and (once converged) the pipeline architecture.

**This skill builds on [`solidstats-shared-ts-standards`](../solidstats-shared-ts-standards/SKILL.md)**
— the TypeScript/Node baseline (tsconfig strictness, code style, ESLint 10, Node 25 / pnpm 11,
Prettier, Vitest 4 / coverage gates) shared by all three TS repos including `web`. Read it first.

If you reached this skill directly for an actual coding task, use the matching per-stack skill
instead — this skill is the shared foundation they build on.

These are **prescriptive** conventions: what good service code *should* look like, not a
description of whatever exists today. Where current code diverges, the code is brought into line
over time — the convention wins. The code-review skills cite these sections as `[std: §X]` /
`[std: correctness §X]`.

## Reference map

This SKILL.md owns the spine: naming, the error system base, enums, and config/input discipline.
The design & correctness rules live in `references/`:

| File | Covers |
|------|--------|
| `references/correctness-and-quality.md` | External adapters, async safety, process lifecycle & construction, LSP, SOLID thresholds, DRY, observability (§Z), log diagnosability (§AA), resource lifecycle (§AB), code-quality bugs, comments, imports. Utility & type libraries moved to `solidstats-shared-ts-standards` §F. |

---

## A. Naming

Deviation from naming is a finding. "Reads fine" is not the standard — consistency is, because the
role of a symbol should be legible from its name.

**Files** — kebab-case with a role suffix, one role per file: `appeal.service.ts`,
`appeal.repository.ts` (server-2), `s3-checkpoint-store.ts`, `source-client.ts` (fetcher). The
per-stack skill defines the role vocabulary for its architecture; this rule fixes the *shape*.

**Types / contracts** — `PascalCase`. Each unit is a **factory function** that returns a typed
contract object — a `type` for the contract plus a `create…` factory:

```ts
type AppealService = { getById(id: string): Promise<Appeal>; /* … */ };
const createAppealService = (deps: AppealServiceDeps): AppealService => ({ /* … */ });
```

Factories — not classes — are the SolidStats default: they are trivial to test (pass fake deps,
no `new`), avoid `this`/binding pitfalls, and compose cleanly with either Fastify decoration or
CLI assembly. Contracts are plain `type`s with **no `I`-prefix** (`AppealService`, not
`IAppealService`). Consumers are typed against the contract `type`, never a concrete
construction — that is what makes the units swappable and testable.

**Functions / variables** — `camelCase`, no abbreviations: `userId` not `uid`, `replayId` not
`rid`. **Constants** that are true constants — `UPPER_SNAKE_CASE`. **Enums / unions** —
`PascalCase` type, with values as a `StrEnum`-style const object or string-literal union (see §C).

**Identifiers** — Steam identity is `steamId64` (string); internal numeric ids are `<entity>Id`;
opaque/UUID surrogate keys keep the entity name (`replayId`, `jobId`). Correlate logs and jobs by
`jobId` / `replayId` (see §Z in `references/correctness-and-quality.md`).

---

## B. Typed error system (base)

A typed error hierarchy is mandatory — never throw a raw `Error`, a framework error, or a bare
value from business logic.

```ts
// the shared base shape — the per-stack skill defines the transport mapping
abstract class AppError extends Error {
  readonly isOperational = true;                 // expected/handled vs a programmer bug
  protected constructor(
    readonly code: string,                       // snake_case, unique within its module
    message: string,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions,                      // { cause } is forwarded to Error
  ) {
    super(message, options);                     // keeps error.message; preserves the cause chain
  }
}

class AppealNotFound extends AppError {
  constructor(details?: Record<string, unknown>, options?: ErrorOptions) {
    super('appeal_not_found', 'Appeal not found', details, options);
  }
}
// throw new AppealNotFound({ id });                 // simple
// throw new AppealNotFound({ id }, { cause: err }); // with the source chain
```

- Errors are defined **per module/feature** in `<feature>.errors.ts`; `code` is `snake_case` and
  unique within its module.
- **Domain errors extend the base; external-service failures use a separate
  `ExternalServiceError`** type. Mixing them breaks the taxonomy callers rely on (see
  `references/correctness-and-quality.md` → External adapters).
- `details` adds context (the offending id/value); it does not duplicate the static `message`.
- Preserve the cause chain when re-wrapping: `throw new XError({ … }, { cause: err })`.
- **Transport mapping is per-stack.** server-2 extends the base with a semantic `httpStatus` and
  maps errors in one central `setErrorHandler` (see `solidstats-server-ts-conventions` →
  `schemas-and-data.md`); the fetcher maps errors to CLI exit codes and the run summary in one
  top-level handler (see `solidstats-fetcher-ts-conventions`). Business code raises typed errors
  and never knows about the transport.

---

## C. Enums & constants

TypeScript has no `StrEnum`; use a `const` object + a derived union, and never a magic string.

```ts
const AppealStatus = { Pending: 'pending', Accepted: 'accepted', Rejected: 'rejected' } as const;
type AppealStatus = (typeof AppealStatus)[keyof typeof AppealStatus];
```

- Status / type / role values are `as const` objects with a derived union type — not loose string
  literals sprinkled through the code.
- Conditions compare against the const (`status === AppealStatus.Pending`), never `=== 'pending'`.
- Repeated path-like literals (route paths, object-key prefixes) live in a per-module const, not
  inline strings.

---

## D. Config & validated input discipline

The tool is now uniform across the org — **zod 4** is the single schema-first tool (server-2 +
fetcher + web all on zod) — and the discipline below is stack-neutral regardless:

- **Validate config/env once, at boot, and fail fast** — before any side effect (no S3 write, no
  DB connection, no HTTP listener until the config parsed). Everything reads the validated config
  object, never `process.env` directly.
- **No config files**, **no per-environment config objects**, and **no branching on `NODE_ENV`** —
  use explicit env vars / feature flags with sensible defaults.
- **No hardcoded secrets** anywhere — not as defaults, not inline. Secrets come from env only and
  are never logged.
- No config read at module top level (it ties import order to env and breaks tests) — read inside
  the config loader / a factory.
- **Schema-first types**: the TS type is derived from the runtime zod schema
  (`type X = z.infer<typeof X>`) — never a hand-mirrored parallel interface. (TypeBox was retired
  from server-2 in favour of zod 4 — it keeps handler inference under `$ref` and makes the org
  zod-uniform; see `solidstats-server-ts-conventions`.)
- **Bound every externally-sourced field**: strings get `.max(n)`, arrays get `.max(n)` (maxItems),
  bounded-domain numbers get `.int().min(n).max(n)`. An unbounded external field is a DoS vector —
  this applies to HTTP request bodies and to anything parsed from an external source alike. [🟡]
- **`.strict()` on request objects**: reject unknown keys with `z.object({…}).strict()` so an
  external caller cannot smuggle unexpected fields past validation. [🟡]

---

## Using this skill

When writing or changing service code, consult the spine here for naming, errors, enums, and
config, then `references/correctness-and-quality.md` for the design/correctness concern you are
touching — and always pair it with the per-stack skill, which owns the architecture the code must
fit into.
