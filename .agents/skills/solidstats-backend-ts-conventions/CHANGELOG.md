# Changelog — solidstats-backend-ts-conventions

## 2026-06-06 — Analysis fixes (see .planning/SKILLS-ANALYSIS.md)
- Corrected row→domain validation: TypeBox has no `.parse()` — use `Value.Parse(Schema, x)` from
  `@sinclair/typebox/value` (was Zod's API).
- Reworked the `AppError` example: ctor takes message + `ErrorOptions` and forwards `{ cause }` to
  `super` (was dropping cause + empty message); `code`/`httpStatus` no longer `readonly`-abstract
  (compiles under ES2022 class fields).
- Fixed the 422 claim (Fastify's Ajv validation defaults to **400**; 422 is a project override).
- Named the Kysely transaction type (`Transaction<DB>`, was an undefined `Tx`); added explicit
  `pg.Pool` config rule.
- Added a **Security & runtime hardening** section (rate-limit, helmet/CORS, bodyLimit, graceful
  shutdown, auth/session+CSRF, secrets-in-responses) and a **Queue reliability** section (manual ack,
  prefetch/QoS, DLQ, idempotency).
- Dropped the bogus "§T–§AB" section range (only §Z/§AA/§AB are lettered); added repository/migration/
  Kysely/queue triggers; removed the stale "(not yet built)" note.

## 2026-06-06 — Initial
- Rebased on `estesis-backend-vc-code-review` (the team's proven backend doctrine), translated
  Python/FastAPI → TypeScript/Fastify at **full fidelity** (§A–§AB), anchored to server-2's actual
  stack: Fastify 5, TypeBox, Kysely/pg, amqplib, S3, pino, prom-client, envalid.
- **Architecture:** 4-layer model — controllers → usecases → services → repositories — with the
  usecase layer optional (only for multi-service orchestration). Downward-only dependencies;
  cross-module sharing only via a module's exported service contract.
- **Style decisions (made by Claude per the user's delegation of backend internals):**
  - DI/contracts: **functional factories** returning typed contract objects (`type X` +
    `createX(deps): X`), no classes, no `I`-prefix — lowest ceremony, easiest to test, cleanest with
    Fastify decoration.
  - Module layout: **flat role-files** (`appeal.service.ts`, `appeal.repository.ts`, …).
- **Scope:** server-2 (Fastify) is the primary subject; a shared baseline (layering, naming, errors,
  async, logging, config, TS strictness) also binds the `replays-fetcher` CLI. Fastify/TypeBox/HTTP
  sections are tagged `[HTTP]` and do not bind the CLI.
- **Structure:** `SKILL.md` spine (architecture, module layout, naming) + `references/`:
  - `layers.md` — controllers, usecases, services, repositories, Fastify-plugin DI, with an
    exhaustive per-layer checklist (full estesis granularity).
  - `schemas-and-data.md` — typed error system, TypeBox schema discipline, Kysely data access,
    enums/filters/pagination, transactions, envalid config.
  - `correctness-and-quality.md` — full §T–§AB (LSP, async safety, security depth, SOLID, DRY,
    schema quality, observability, log diagnosability, resource lifecycle) + code-quality, comments,
    imports/lint. Each rule notes the severity the code-review skill maps it to.
- Absorbs `fastify-best-practices`, `nodejs-backend-patterns`, `api-design-principles` — those
  generic skills are not installed separately; their guidance lives here, tuned to SolidStats.
- The design/correctness rules are stated as conventions; the separate
  `solidstats-backend-ts-code-review` skill operationalizes them into hunts with
  evidence gates, the OpenAPI conformance gate, and the severity table.
