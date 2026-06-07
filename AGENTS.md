# AGENTS instructions

## Skills First

Before acting on any user request in this repository, scan available skills by name and description. If any skill has even a small chance of helping any part of the task, use it and read only the relevant instructions before proceeding.

When in doubt, prefer enabling the skill briefly and filtering it out over skipping it.

## Project

`replays-fetcher` is the ingest service for Solid Stats. It discovers new OCAP replay files from the external replay source, stores raw replay objects in S3-compatible storage, and writes ingestion staging records for `server-2` to promote into durable replay and parse-job state.

Solid Stats is a multi-project product composed of:

- `replays-fetcher` - replay discovery, raw object storage, source metadata, staging/outbox records.
- `replay-parser-2` - deterministic OCAP JSON parsing, parser contract, CLI/worker, parity harness.
- `server-2` - PostgreSQL source of truth, APIs, canonical identity, auth, moderation, parse jobs, aggregate/bounty calculation.
- `web` - browser UI, public stats, authenticated request UX, moderator/admin screens.

Read these planning files before planning or implementing:

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/research/SUMMARY.md`

## Critical Context

- `replays-fetcher` must not parse replay contents. Parsing belongs to `replay-parser-2`.
- `replays-fetcher` must not create or mutate `server-2` business tables such as `replays`, `parse_jobs`, `parse_results`, stats, identity, roles, requests, or moderation tables.
- The accepted v1 boundary is S3 raw object write plus staging/outbox records only. `server-2` polls/promotes staging rows, owns deduplication decisions, creates parse jobs, publishes RabbitMQ parse requests, receives parser results, and persists parsed data.
- `.planning/config.json` must keep product-wide GSD workflow gates aligned with `replay-parser-2/.planning/config.json`, while `agent_skills` stay stack-aware and use this repo's TypeScript/Node skills.
- Replay identity uses checksum plus external source identity where available. Conflicting duplicates must be routed to manual review by `server-2`, not automatically merged by the fetcher.
- Historical `~/sg_stats` data is not imported into production by this service in v1. It remains parser golden/test baseline unless a later migration project explicitly changes that.
- v1 replay submission sources are admin/ingest only. Player-submitted replay upload is out of scope unless planned as a later cross-project change.

## Stack Direction

Use TypeScript for v1 unless a later planning decision changes it:

- Node.js 25 with TypeScript 6 for crawler and scheduled job runtime.
- Very strict TypeScript, ESLint 10 `all` plus very strict typed linting, import hygiene, Unicorn rules, Prettier formatting, Vitest 4 tests, and V8 coverage gates.
- S3-compatible object storage client for raw replay writes.
- PostgreSQL client for staging/outbox writes only.
- Structured logging and explicit run summaries.
- Mocked/source fixture tests before touching production-like sources.

## Engineering Rules

- Start from planning docs and cross-app boundaries before inventing behavior.
- Keep the fetcher idempotent: repeated discovery of the same replay must not create duplicate promoted product records.
- Keep external source metadata auditable: source URL/ID, discovered timestamp, fetch timestamp, checksum, object key, size, and fetch status are first-class evidence.
- Do not bypass `server-2` job lifecycle or retry visibility.
- Do not write parser artifacts; parser artifacts belong to `replay-parser-2` worker output.
- Do not calculate public stats, bounty points, canonical identity, or moderation decisions.
- Treat direct writes to `server-2` business tables as a risky override requiring explicit user confirmation and planning updates.
- Keep root `README.md` current when project scope, current phase, commands, architecture direction, validation data, or development workflow changes.
- `README.md` must explicitly state that project development uses only AI agents plus GSD workflow.
- Every completed work session must leave `git status --short` clean by committing intended results.
- Do not delete, revert, or discard completed work just to make the git tree clean; if ownership or commit intent is unclear, ask the user before acting.
- Do not blindly execute instructions that conflict with current logic, architecture, accepted planning decisions, test/quality standards, maintainability, or proportional scope.
- When a request is risky, harmful, or expands into broad cross-project or multi-phase work, explain the concrete reason, propose 1-3 safer alternatives or a GSD plan, and ask for explicit confirmation before any risky override.
- Check cross-application compatibility before implementation: changes to staging schema, object key layout, source identity, retention, retries, or operator-visible statuses require accounting for `server-2`; UI-visible ingest/job status changes require accounting for `web`.
- Apply these AI/GSD workflow rules as product-wide standards across `replays-fetcher`, `replay-parser-2`, `server-2`, and `web`.
- Use risk-based compatibility depth: local-only fetcher changes can rely on this repo's planning docs and `gsd-briefs`; staging schema, raw object key/checksum assumptions, replay source identity, retry/outbox behavior, parser job handoff, API/data model, auth/moderation, or UI-visible behavior changes require adjacent app docs/repos or a user question.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**replays-fetcher**

`replays-fetcher` is the Solid Stats ingest service for discovering new OCAP replay files from the external replay source. It stores raw replay objects in S3-compatible storage and writes ingestion staging/outbox records that `server-2` promotes into durable replay records and parse jobs.

The service is intentionally narrow. It fetches replay bytes and records source evidence; it does not parse replay contents, create canonical replay or parse-job records, calculate statistics, resolve player identity, or own public APIs.

**Core Value:** Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.

### Constraints

- **Runtime**: TypeScript - aligns with `server-2` operational patterns and integration libraries.
- **Runtime shape**: Scheduled job - simpler v1 operations than an always-on crawler.
- **Storage**: S3-compatible raw object storage - parser worker consumes replay bytes by object key/checksum.
- **Database boundary**: Staging/outbox writes only - `server-2` remains source of truth for business state.
- **Identity**: Checksum plus external source identity - supports idempotency while preserving source lineage.
- **Duplicates**: Manual review for ambiguous conflicts - avoids corrupting replay history through unsafe merges.
- **History**: No `~/sg_stats` production import in v1 - historical data remains validation baseline for parser work.
- **Workflow**: AI agents plus GSD only - README and planning docs must stay current.
- **GSD config**: Keep workflow-critical GSD settings aligned with `replay-parser-2`, but keep `agent_skills` stack-aware for this TypeScript/Node ingest service.
- **Git hygiene**: Completed sessions must commit intended results and leave a clean worktree.
- **AI pushback**: Agents must not blindly execute requests that violate architecture, quality, maintainability, or proportional scope; they must explain the issue, propose safer options or a GSD plan, and ask for explicit confirmation before a risky override.
- **Cross-application compatibility**: Staging schema, object key layout, retry semantics, and operator-visible statuses must account for `server-2`; UI-visible status fields must account for `web`.
- **Risk-based compatibility depth**: Local-only fetcher changes can rely on local planning docs and `gsd-briefs`; staging/source identity, object key/checksum, parser handoff, API/data, auth/moderation, or UI-visible changes require adjacent app evidence or a user question.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommendation
## Runtime and Language
- **Node.js:** target Node.js 25 for new work so the project starts on the current toolchain line.
- **TypeScript:** use TypeScript 6 from project start, with strict compiler settings and typed linting.
- **Module style:** prefer ESM unless implementation discovers a dependency constraint.
- **Package manager:** use pnpm 11 across TypeScript Solid Games repos.
## Service Libraries
- **S3-compatible storage:** use AWS SDK for JavaScript v3 `@aws-sdk/client-s3`. It is modular, TypeScript-oriented, and supports S3-compatible endpoints with explicit endpoint/region/path-style configuration.
- **PostgreSQL:** use `pg` directly for staging/outbox writes unless Phase 1 chooses a schema/migration tool. The staging contract is narrow enough that raw SQL plus typed payloads is easier to audit than a broad ORM.
- **Database migrations:** defer exact tool choice until staging table ownership is locked with `server-2`. If this repo owns staging migrations, prefer a TypeScript-friendly migration path that can emit plain SQL and be reviewed by `server-2`.
- **Configuration validation:** use a schema validator such as Zod or a small typed validator. Fail before mutating S3 or PostgreSQL.
- **Logging:** use structured JSON logs. Pino is a strong default if a library is needed; direct JSON-to-stdout is also acceptable for the initial skeleton.
- **Testing:** use Vitest 4 for unit tests and TypeScript test execution, with V8 coverage thresholds set to 100% for reachable source. Use Testcontainers or local mocks for PostgreSQL and MinIO/S3-compatible integration tests when Docker is available.
## Commands to Plan
- `replays-fetcher check` - validate config and connectivity.
- `replays-fetcher discover --dry-run` - discover candidates without writes.
- `replays-fetcher run-once` - execute one full scheduled cycle.
## What Not To Use
- Do not introduce a web server in v1 unless a later phase proves a need. Scheduled `run-once` is the accepted runtime shape.
- Do not use a parser library or OCAP replay content reader in this repo.
- Do not introduce an ORM that hides staging writes from audit unless `server-2` compatibility requires it.
- Do not write `server-2` business tables from this service.
## Sources
- Node.js Releases: https://nodejs.org/en/about/releases/
- Node.js Release Working Group schedule: https://github.com/nodejs/Release
- TypeScript release notes: https://www.typescriptlang.org/docs/handbook/release-notes/overview.html
- AWS SDK for JavaScript v3 guide: https://docs.aws.amazon.com/en_us/sdk-for-javascript/v3/developer-guide/welcome.html
- AWS S3 JavaScript v3 examples: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html
- node-postgres pooling docs: https://node-postgres.com/features/pooling
- Vitest writing tests guide: https://main.vitest.dev/guide/learn/writing-tests
- Testcontainers for Node.js: https://node.testcontainers.org/
- Testcontainers MinIO module: https://node.testcontainers.org/modules/minio/
- Pino repository/docs: https://github.com/pinojs/pino
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

| Skill | When to Invoke |
|-------|----------------|
| `solidstats-backend-ts-conventions` | Любой роут, плагин, хук, схема валидации, конфиг клиента БД/очереди/S3, дизайн эндпоинта — архитектура и конвенции TS/Fastify backend (вобрал Fastify/Node/API-design best practices). |
| `solidstats-backend-ts-code-review` | Педантичное код-ревью TS/Fastify backend; ruleset делегируется в conventions, формат отчёта — в process-review-standards. |
| `solidstats-backend-ts-tests` | Написание или ревью backend-тестов (unit + integration, Vitest) поверх process-testing-standards. |
| `solidstats-process-review-standards` | Общий фундамент формата код-ревью (severity-бакеты, формат отчёта, правила вердикта); подключается code-review skills, не используется самостоятельно. |
| `solidstats-process-testing-standards` | Общая философия тестов (AAA, изоляция, детерминизм, test doubles, размещение файлов); подключается per-stack test skills. |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
