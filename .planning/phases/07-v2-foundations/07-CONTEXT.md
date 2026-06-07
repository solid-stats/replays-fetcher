# Phase 7: v2 Foundations - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Deliver cross-cutting typed error infrastructure and structured logging that all later v2 phases (DIAG, RETRY, RESUME, RANGE, PROG, GUARD) build on. Two requirements:

- **CORE-01** — a shared `AppError` base class in `src/errors/` with stable `code`, `isOperational`, structured `details`, and preserved `cause`. Existing `SourceFetchError` and `ReplayByteFetchError` extend it; the design leaves room for v2 error types (`retry-exhausted`, `checkpoint-conflict`, `contract-violation`) without breaking existing `code` string unions.
- **CORE-02** — a `createLogger` factory in `src/logging/` returning a pino logger with secret redaction matching the current posture, injected through the `src/cli.ts` dependency map as a child logger keyed by `runId`, replacing ad-hoc `JSON.stringify` / `writeJson` calls.

This is a structural refactor: no behavioral change, `pnpm run verify` must stay green.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — this is a pure infrastructure/refactor phase. Decisions follow the ROADMAP success criteria, existing codebase conventions, and the `solidstats-process-ts-standards` / `solidstats-backend-ts-conventions` skills (typed error system, no `any`/`as`, structured logging). Boundary rules from AGENTS.md still apply (no parsing, no `server-2` business-table writes).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConfigError` (`src/config.ts:90`) — existing `extends Error` pattern; candidate to migrate or align with `AppError`.
- `SourceFetchError` (`src/discovery/source-client.ts:15`) — `code: "rate_limited" | "source_unavailable"`; must extend `AppError` without breaking the union.
- `ReplayByteFetchError` (`src/storage/replay-byte-client.ts:17`) — `code: "fetch_failed"`; must extend `AppError`.

### Established Patterns
- No `src/errors/` or `src/logging/` directory exists yet — both are new.
- `pino` is not yet a dependency — CORE-02 introduces it.
- Ad-hoc structured output via `JSON.stringify` / `writeJson` lives in `src/discovery/discover.ts`, `src/cli.ts`, and `src/staging/postgres-staging-repository.ts` — these are the call sites to migrate to the injected logger.
- Unit tests are colocated beside source files under `src/` (per Phase 05 decision).

### Integration Points
- `src/cli.ts` owns the CLI dependency map — the logger is injected here as a child logger keyed by `runId`.
- Secret redaction posture must match what config/logging already protect (no secrets, no raw bytes in output).

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP Phase 7 success criteria (CORE-01, CORE-02) and existing codebase conventions.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase, scope is fixed by CORE-01 and CORE-02.

</deferred>
