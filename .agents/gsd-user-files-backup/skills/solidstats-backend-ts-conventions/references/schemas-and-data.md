# Schemas, errors & data

Translated from the SolidStats backend doctrine to TypeScript / Fastify (TypeBox + Kysely + envalid).
Covers the typed error system, TypeBox schema discipline, Kysely data access, enums/filters/
pagination, transactions, and config. Read alongside `layers.md`.

---

## Error system

A typed error hierarchy is mandatory — never throw a raw `Error`, an HTTP-framework error, or a
bare value from a service/usecase.

```ts
// src/infra/errors/app-error.ts
abstract class AppError extends Error {
  readonly isOperational = true;                 // expected/handled vs a programmer bug
  protected constructor(
    readonly code: string,                       // snake_case, unique within its module
    readonly httpStatus: number,                 // semantic — see table below
    message: string,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions,                       // { cause } is forwarded to Error
  ) {
    super(message, options);                      // keeps error.message; preserves the cause chain
  }
}

// modules/appeal/appeal.errors.ts
class AppealNotFound extends AppError {
  constructor(details?: Record<string, unknown>, options?: ErrorOptions) {
    super('appeal_not_found', 404, 'Appeal not found', details, options);
  }
}
// throw new AppealNotFound({ id });                 // simple
// throw new AppealNotFound({ id }, { cause: err }); // with the source chain
```

- Errors are defined **per module** in `<feature>.errors.ts`; `code` is `snake_case` and unique.
- `httpStatus` is set from a **semantic** constant, never a bare literal scattered in logic:
  - `400` — business validation failure / invalid state transition
  - `403` — insufficient permissions
  - `404` — entity does not exist
  - `409` — uniqueness / conflict
  - `422` — invalid request payload (a project override; Fastify's Ajv validation defaults to **400**)
  - `502` — an upstream service returned an error
  - `500` — reserved for the unknown/unexpected error only, never a domain error
- **Domain errors extend `AppError`; external-service failures use a separate `ExternalServiceError`**
  type. Mixing them breaks the taxonomy callers rely on (see `correctness-and-quality.md` → external
  adapters).
- One **central `setErrorHandler`** maps errors to the response envelope and logs them:

```ts
app.setErrorHandler((err, req, reply) => {
  req.log.error({ err });
  if (err instanceof AppError) return reply.code(err.httpStatus).send(envelope(err));
  if (err.validation) return reply.code(422).send(validationEnvelope(err));   // Ajv
  return reply.code(500).send(opaque500(req));     // never leak internals in prod
});
```

- Response envelope is consistent across the API: `{ statusCode, error, message, details? }`.
- `details` adds context (the offending id/value); it does not duplicate the static `message`.

---

## TypeBox schemas [HTTP]

Request and response shapes are TypeBox; the TS type is derived from the schema, never hand-mirrored.

```ts
const AppealCreate = Type.Object(
  {
    title: Type.String({ maxLength: 200 }),                 // bound every string
    tags:  Type.Array(Type.String(), { maxItems: 50 }),     // bound every array
    score: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  },
  { additionalProperties: false },
);
type AppealCreate = Static<typeof AppealCreate>;
```

- Derive types with `Static<typeof Schema>` — never maintain a parallel hand-written interface.
- **Bound every string (`maxLength`) and array (`maxItems`)** on request bodies, and bound numeric
  ranges (`minimum`/`maximum`) — an unbounded field is a DoS vector (the review hunts for missing
  bounds; see `correctness-and-quality.md` → schema quality).
- `additionalProperties: false` on request objects.
- Schema naming: `XBase` (minimal shared), `XFull` (all fields + relations), `XCreate` (creation
  input), `XUpdate` (partial — `Type.Partial(XCreate)`), `XRow` (DB row shape).
- A **response schema is always declared** on a route — it gates serialization and feeds the
  generated OpenAPI (the contract `web` consumes). Share common schemas via `$id` + `app.addSchema`.
- IDs are typed `string`; timestamps are ISO strings with `format: 'date-time'`.
- TypeBox/Ajv handles *shape* validation (→ **400** by default; the central handler remaps it to 422
  if that's the project's chosen code). **Domain** validation (a rule that
  needs data or context) lives in the **service** and raises a typed `AppError` — do not push
  business rules into schema keywords.

> `replays-fetcher` validates with **Zod**, not TypeBox. The rules above (derive types from the
> schema, bound every field, one source of truth) apply there in Zod form; the TypeBox specifics do
> not.

---

## Kysely data access & models

- The database shape is a typed Kysely `Database` interface (table row interfaces). Columns are
  precisely typed; nullable columns are `T | null`, not loose.
- Surrogate keys are explicit and consistently named (`id`); Steam identity is `steamId64: string`.
- `createdAt` / `updatedAt` are managed consistently (DB default or a shared helper) — not set
  ad-hoc per insert.
- Frequently-filtered columns are indexed (declared in the migration).
- If Postgres schemas/namespaces are used to separate domains, the schema is explicit in the table
  definition — never implicit `public`.
- Configure the `pg.Pool` explicitly — `max`, `connectionTimeoutMillis` (default `0` = wait forever),
  `idleTimeoutMillis`, `maxUses` — so DB pressure surfaces as a timeout, not a hung request.

### Migrations

- Run through the existing `src/infra/db/migrate.ts` script (`pnpm db:migrate`); no ad-hoc DDL.
- Every migration has a correct `up` **and** `down`.
- Adding a `NOT NULL` column to an existing table includes a `DEFAULT` or a prior backfill step in
  the same migration.
- Migration files have descriptive names, not just a hash/timestamp.

### Transactions

- A composite write (multiple inserts/updates that must succeed together) runs in **one** Kysely
  transaction, opened by the **usecase**: `db.transaction().execute(async (tx) => { … })`.
- Services and repositories accept an optional `tx` and use `tx ?? db`, so the same method composes
  inside or outside a transaction. The transaction boundary is never opened in a repository or a
  controller.

---

## Enums & constants

TypeScript has no `StrEnum`; use a `const` object + a derived union, and never a magic string.

```ts
const AppealStatus = { Pending: 'pending', Accepted: 'accepted', Rejected: 'rejected' } as const;
type AppealStatus = (typeof AppealStatus)[keyof typeof AppealStatus];

const RoutePath = { create: '/create', revoke: '/:id/revoke' } as const;  // per-module route paths
```

- Status / type / role values are `as const` objects with a derived union type — not loose string
  literals sprinkled through the code.
- Conditions compare against the const (`status === AppealStatus.Pending`), never `=== 'pending'`.
- Per-module route paths live in a `RoutePath` const (referenced by the routes plugin), not inline
  literals.

---

## Filters & pagination

```ts
type Pagination = { limit: number; offset?: number; cursor?: string };
type Paged<T> = { items: T[]; total?: number; hasMore: boolean };

const applyAppealFilter = (f: AppealFilter) => (qb: AppealQuery) =>
  f.statusIn ? qb.where('status', 'in', f.statusIn) : qb;   // composable, $call-able
```

- Pagination uses the shared `Pagination` type and the `paginate` helper; results are `Paged<T>`.
  Offset for small/bounded sets; cursor (`limit` + `cursor` + `hasMore`) for large stat listings.
- Filters are typed objects applied via composable `$call(applyXFilter(f))` helpers — not query
  fragments hand-built inside each repository method.
- `orderBy` is a typed union with an explicit default, never a raw client-supplied string.

---

## Config / env

```ts
// src/config/env.ts — validated once, at boot
export const loadConfig = () => cleanEnv(process.env, {
  DATABASE_URL: str(),
  RABBITMQ_URL: str(),
  S3_ENDPOINT: str(),
  STEAM_API_KEY: str(),
});
```

- Validate env **once at boot** with envalid and expose the result via the `config` decorator.
  Everything reads `app.config`, never `process.env` directly.
- **No config files**, **no per-environment config objects**, and **no branching on `NODE_ENV`** —
  use explicit env vars / feature flags with sensible defaults.
- **No hardcoded secrets** anywhere — not as defaults, not inline. Secrets come from env only and
  are never logged.
- No config read at module top level (it ties import order to env and breaks tests) — read inside
  `loadConfig` / a plugin.
