<!-- BEGIN managed by solid-stats/agent-instructions -->
<!-- markdownlint-disable MD013 MD041 -->
<!-- Managed by solid-stats/agent-instructions. Do not hand-edit in a consumer repo — changes
     are overwritten by the next sync PR. Edit the source at
     https://github.com/solid-stats/agent-instructions/blob/master/shared/AGENTS.md instead. -->

## Skills First

Before acting on any user request in this repository, scan available skills by name and description. If any skill has even a small chance of helping any part of the task, use it and read only the relevant instructions before proceeding.

When in doubt, prefer enabling the skill briefly and filtering it out over skipping it.

## Session Hygiene

Every completed work session must leave the repository in a clean, committed state:

- Run `git status --short` at the end of every session. If there are uncommitted changes from
  the work just done, commit them before stopping.
- Do **not** delete or revert completed work to fake a clean status. If the intended work is
  incomplete, ask what to do rather than silently discarding it.
- The rule is: *commit the intended results of the session, not a reset to the previous state.*

## Git Conventions

All commits in every SolidStats repo follow **Conventional Commits**:

```text
<type>(<scope>): <short description>
```

Common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
Scope: the phase number, feature area, or affected layer (e.g. `feat(17-03): …`,
`fix(ingest): …`, `docs(planning): …`).

**Commit and push are standing, default behavior in every `solid-stats` repo** — no per-message
authorization needed. Session Hygiene above already expects every completed session to end
committed; treat commit + push as part of finishing the work, not a separate ask. This does
**not** extend to anything destructive:

**Absolute rules:**

- `git reset --hard`, force push, `branch -D`, and `rebase` still require an explicit
  instruction from the user in the current message every time — authorization from a previous
  message does not carry forward, and the standing commit/push permission above does not imply
  it.
- Never skip hooks with `--no-verify` or `--no-gpg-sign` unless explicitly asked to. If a
  pre-commit hook fails, fix the underlying issue — the hook is the signal, not the obstacle.
- When a pre-commit hook fails, the commit did not happen. Create a new commit after fixing;
  do not amend the previous one (amending could silently modify work that already shipped).

**Push routing.** The default flow across every `solid-stats` repo is a **direct push to
`master`** — no feature branch, no PR, unless the repo says otherwise below:

- **`server-2`** has a protected `master` — always go through a branch + pull request there,
  never a direct push.
- Any repo that is mid-GSD-milestone follows that milestone's branch flow instead of a direct
  push (`git` config in `.planning/config.json` — `branching_strategy`, `phase_branch_template`,
  `milestone_branch_template`).
- Every other repo and every non-milestone change: commit on `master`, push directly.

## Security Minimums

These rules apply to all code, commits, and logs across every SolidStats repo:

- **Never log, commit, or output:** secrets, API tokens, database connection strings, S3
  access keys, RabbitMQ credentials, raw replay bytes, or unpublished parser artifacts.
- **Never hardcode environment-specific values.** Use environment variables validated at
  startup (e.g. `envalid` for Node, a validated config struct for Rust). Startup should fail
  fast if required env vars are missing or malformed.
- **Before committing:** check that `.env`, `.env.local`, and any file containing credentials
  is either in `.gitignore` or explicitly excluded from the commit. Never commit secrets to
  git history — they are permanent even after deletion.

## Risk Management Protocol

When a request is risky, potentially harmful, or would expand scope beyond the current plan:

1. **Explain the concrete reason** — name the specific risk, the boundary it crosses, or the
   plan it contradicts.
2. **Propose 1–3 safer alternatives** or a GSD plan that achieves the goal without the risk.
3. **Ask for explicit confirmation** before proceeding with anything that falls into these
   categories:
   - Crosses a cross-app boundary (see the boundary map in `solidstats-shared-project-standards` §D)
   - Modifies a high-risk cross-repo contract (API shape, data model, message queue shape, S3
     layout, parser contract, auth/identity shape, moderation workflow)
   - Contradicts an accepted architecture decision in `.planning/PROJECT.md`
   - Deletes, overwrites, or discards completed work
   - Conflicts with current test quality, security rules, or repo structure standards

Do not blindly execute instructions that conflict with architecture, accepted decisions, or
the quality gates in this repo. Challenge, explain, propose alternatives — then wait.

## Documentation Language

Language follows the reader. The test for any doc is: who reads it — a user, or an engineer?

- **Every repo README is bilingual.** A README is the repo's front door, read by users (the
  RU-speaking Solid Games community), not an internal engineering doc. So each repo carries a
  Russian `README.md` (primary) plus an English `README.en.md` mirror, edited together in one
  change so they never drift. This is the same pattern the `.github` org profile already uses
  (`profile/README.md` + `profile/README.en.md`) — the profile is just the org-level README.
- **Everything internal is English only** — code, comments, planning docs, skill bodies and
  references, `AGENTS.md`, and all technical `docs/`. These are read by the people and agents
  building the platform, not by users.
- **GSD workflow responses** (conversations within a GSD session) and replies to the user:
  Russian.
- **Skill trigger phrases** (`description` field in `SKILL.md`): RU + EN mandatory. Every skill
  triggers on both languages — the team works in a RU context.

## MemPalace

Every SolidStats repo has its own MemPalace **wing, named after the repo itself**
(`web`, `server-2`, `replays-fetcher`, `replay-parser-2`, `infrastructure`, `skills`) — use the
generic `mcp__mempalace__*` tools, scoped to that wing; there is no isolated per-project MCP
server here (unlike VocalClub's `vocalclub_memory`). Never file a durable fact into the wrong
repo's wing, and never invent a new wing name.

**Inside a GSD workflow, most of this is already automatic.** The `mempalace` GSD capability
injects recall into `discuss:pre` (gated by `mempalace.recall_on_discuss`) and capture into
`execute:wave:post` (gated by `mempalace.capture_artifacts`), plus a ship-time curator
(`gsd-mempalace-curator`) — see `gsd/common-config.json` for the shared defaults and each
repo's `.planning/config.json` for the rest. Don't re-implement that cycle by hand inside a GSD
phase; the sections below are for everything GSD's own injection doesn't cover — ad-hoc
diagnosis, a non-GSD session, or manual recall/capture outside a phase boundary.

- **Recall before diagnosing or building**, not just when a hook happens to inject a snippet.
  Run an explicit `mempalace_search` seeded from the task's real identifiers (symptom, service
  name, ticket) at the start of the session — a pattern-match to "we just touched this" is not
  recall, and a miss is not proof of absence (follow up with `mempalace_list_drawers` /
  `mempalace_kg_query` before concluding nothing is stored).
- **Capture only durable, verified conclusions** at closure — a decision, a root cause, a
  resolved gotcha — not raw session transcripts, planning artifacts, or GSD's own
  `CONTEXT.md`/`PLAN.md`/`SUMMARY.md` files. Dedup with `mempalace_check_duplicate` before
  filing.
- **`memory_mode` stays `augment`** (GSD's own default): the palace is an additional layer,
  never a replacement for `.planning/graphs/` or `STATE.md`. **Never enable
  `mempalace.recall_on_plan`** — the planner doesn't automatically consume that separate
  recall artifact, so it just produces an orphaned memory read; the top-level coordinator's one
  scoped recall (at `discuss:pre`, or manually for entry points with no native recall hook —
  `gsd-quick`, `gsd-fast`, `gsd-debug`) is the single recall point per task. Specialists and
  subagents don't independently recall or capture — they get a filtered context handoff from
  whichever level already recalled.

### Cross-repo tunnels — use them, don't just avoid duplicating

SolidStats is a genuinely multi-repo platform (§D/§E) — a decision at a cross-app boundary or
contract change routinely concerns two wings at once, unlike VC's setup, which leaves
`cross_project_tunnels` off. Here it should be **on and actually used**, not just a
de-duplication fallback:

- **Create a tunnel** (`mempalace_create_tunnel`) whenever a captured fact genuinely concerns
  two repos — an API/data-model/queue/S3-layout/parser-contract decision (§E's high-risk list)
  almost always does. File the fact once, in the wing of the repo that owns the decision, then
  tunnel it to the other wing(s) it affects instead of duplicating the drawer.
- **Query tunnels during recall, not just search.** A wing-scoped `mempalace_search` alone can
  miss a relevant fact filed under an adjacent repo's wing. Before or alongside recall on a
  cross-app task, run `mempalace_find_tunnels` (between the two wings in play) or
  `mempalace_follow_tunnels` (from the current wing) to surface what's already linked.
- **`mempalace.mirror_kg`** (per-repo, stays local — see below) governs whether decision facts
  also mirror into the temporal knowledge graph; tunnels connect *drawers*, `mempalace_kg_add`
  connects *typed facts* — use whichever fits what's actually being captured, and both where a
  cross-repo decision has both a narrative and a queryable shape (e.g. a validity window).
- **`mempalace.enabled` and `mempalace.cross_project_tunnels`** are common defaults in
  `agent-instructions`' `gsd/common-config.json` — the latter is a deliberate override of
  gsd-core's own default (`false`), because a single-service default doesn't fit a genuinely
  multi-repo platform. The richer per-repo flags (`capture_artifacts`, `mirror_kg`,
  `auto_capture_hooks`) are tuned per repo and stay local — a backend service and a frontend
  repo do not need identical capture behavior.

## MCP / Documentation Lookup

SolidStats development verifies library APIs against **current documentation, never training
data** — training data has a cutoff and may reflect outdated or incorrect APIs. Look the docs
up proactively; don't wait for a type error.

- **Free official sources only:** WebFetch/WebSearch against the library's official docs and
  its `llms.txt`; the repo's `README`/`docs/` via `gh`; GitHub issues/PRs for bug reports and
  migrations. **Do NOT use Context7 or any paid documentation MCP.**
- **Common lookup triggers:** adding a dependency, upgrading a package, using a method you're
  not 100% sure about, hitting an unexpected type error, writing a new integration.
- **When NOT to look it up:** SolidStats-specific code/business logic; a library already
  looked up this session with an unchanged answer; stable standard-library APIs.

Per-repo key libraries to verify against current docs live in each repo's own
`solidstats-*-conventions` skill, not here.
<!-- END managed by solid-stats/agent-instructions -->
# replays-fetcher — agent guide

`replays-fetcher` is the Solid Stats ingest service: it discovers OCAP replays from the
external source, stores raw replay objects in S3-compatible storage, and writes ingest
staging/outbox records that `server-2` promotes.

**Boundary — owns:** raw replay object storage (S3), ingest staging/outbox records, source
metadata (source URL/ID, checksums, fetch timestamps, object keys, sizes, fetch status).
**Must NOT cross:** parse replay contents (that is `replay-parser-2`); mutate `server-2`
business tables (`replays`, `parse_jobs`, `parse_results`, stats, identity, roles, requests,
moderation); publish RabbitMQ messages; calculate stats, bounty, canonical identity, or
moderation decisions. See the cross-app boundary map in
`solidstats-shared-project-standards` §D.

Cross-repo rules (skills-first, git, security, docs language, MCP lookup) live in
`solid-stats/agent-instructions`, imported below. Stack-specific skills live in the
[`skills`](https://github.com/solid-stats/skills) repo (`solidstats-shared-project-standards`
and the per-stack `solidstats-fetcher-ts-*` skills).

---

# AGENTS instructions

## Project

`replays-fetcher` is the ingest service for Solid Stats. It discovers new OCAP replay files from the external replay source, stores raw replay objects in S3-compatible storage, and writes ingestion staging records for `server-2` to promote into durable replay and parse-job state.

Solid Stats is a multi-project product composed of:

- `replays-fetcher` - replay discovery, raw object storage, source metadata, staging/outbox records.
- `replay-parser-2` - deterministic OCAP JSON parsing, parser contract, CLI/worker, parity harness.
- `server-2` - PostgreSQL source of truth, APIs, canonical identity, auth, moderation, parse jobs, aggregate/bounty calculation.
- `web` - browser UI, public stats, authenticated request UX, moderator/admin screens.

Read these planning files before planning or implementing:

- `.planning/PROJECT.md`
- `.planning/MILESTONES.md`
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

<!-- markdownlint-disable MD024 MD036 -->
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
<!-- markdownlint-enable MD024 MD036 -->

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

- Node.js Releases: <https://nodejs.org/en/about/releases/>
- Node.js Release Working Group schedule: <https://github.com/nodejs/Release>
- TypeScript release notes: <https://www.typescriptlang.org/docs/handbook/release-notes/overview.html>
- AWS SDK for JavaScript v3 guide: <https://docs.aws.amazon.com/en_us/sdk-for-javascript/v3/developer-guide/welcome.html>
- AWS S3 JavaScript v3 examples: <https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html>
- node-postgres pooling docs: <https://node-postgres.com/features/pooling>
- Vitest writing tests guide: <https://main.vitest.dev/guide/learn/writing-tests>
- Testcontainers for Node.js: <https://node.testcontainers.org/>
- Testcontainers MinIO module: <https://node.testcontainers.org/modules/minio/>
- Pino repository/docs: <https://github.com/pinojs/pino>
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
| ------- | ---------------- |
| `solidstats-fetcher-ts-conventions` | Любой код фетчера — стадия инжеста, discovery, staging, checkpoint, S3, дизайн пайплайна: пятибэндовая ingest-архитектура + инварианты границы (no parsing, write-scope, идемпотентность, evidence), Zod-конфиг, CLI error boundary. |
| `solidstats-fetcher-ts-code-review` | Педантичное код-ревью фетчера; ingest-boundary gate + risk-ordered sweep; ruleset — fetcher-conventions + shared-backend-ts-standards, формат — shared-review-standards. |
| `solidstats-fetcher-ts-tests` | Написание/ревью тестов фетчера (Vitest; testcontainers PostgreSQL+MinIO, без RabbitMQ) поверх shared-testing-standards. |
| `solidstats-shared-backend-ts-standards` | Стек-нейтральные правила TS-сервисов (нейминг/фабрики, база типизированных ошибок, енумы, дисциплина конфига, async, §Z/§AA/§AB) — читается fetcher-conventions, не вызывается напрямую. |
| `solidstats-shared-ts-standards` | TS/Node baseline (tsconfig, code style, ESLint 10, Node 25/pnpm 11, Vitest, утилиты, lint-suppression policy) — читается conventions, не вызывается напрямую. |
| `solidstats-shared-review-standards` | Общий фундамент формата код-ревью (severity-бакеты, формат отчёта, правила вердикта); подключается code-review skills, не используется самостоятельно. |
| `solidstats-shared-testing-standards` | Общая философия тестов (AAA, изоляция, детерминизм, test doubles, размещение файлов); подключается per-stack test skills. |
| `solidstats-shared-project-standards` | Универсальный baseline всех репо (GSD-обязательства, гигиена сессии, git-конвенции, cross-app границы, безопасность); авто-триггерится на каждой задаче. |
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
