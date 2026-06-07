---
plan_id: P1
phase: 1
status: ready
depends_on: []
files_modified:
  - package.json
  - tsconfig.json
  - vitest.config.ts
  - src/config.ts
  - src/cli.ts
  - src/index.ts
  - tests/config.test.ts
  - docs/integration-contract.md
  - README.md
---

# Plan P1: TypeScript Foundation and Contract

## Objective

Create a strict TypeScript project foundation with config validation, CLI command wiring, tests, README updates, and explicit cross-app integration contract docs.

## Tasks

1. Add package metadata, strict TypeScript config, Vitest config, and standard scripts for `typecheck`, `test`, `lint`, `format`, and `build`.
2. Implement config validation that fails before any mutating operation when source, S3, or staging database settings are missing or malformed.
3. Add a `replays-fetcher check` CLI command that validates configuration and reports a structured JSON summary without leaking secrets.
4. Add tests for config validation and secret redaction.
5. Document the ingest contract with `server-2`, `replay-parser-2`, and `web`, including forbidden business-table writes and parser boundary.
6. Update README with current phase, implemented commands, architecture direction, and AI + GSD-only workflow.

## Verification

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

