---
phase: 12-source-contract-guards
plan: 01
status: complete
completed: 2026-06-12
requirements: [GUARD-01, GUARD-02, GUARD-04]
---

# Plan 12-01 Summary — Source-side contract guards

## What was built

A bounded one-shot source contract probe plus its deterministic fixture tests,
and the `toRawReplayUrl` export the golden test depends on.

- **`src/discovery/discover.ts`** — `toRawReplayUrl` is now `export`ed (one-word
  change; body and the in-file call site unchanged) so the GUARD-02 golden test
  can assert it directly.
- **`src/contract-check/contract-check.ts`** — new pure-async `runContractCheck`
  probe. Fetches list page 1 → first detail page → raw JSON data endpoint, each
  as a single attempt (no retries). Returns a discriminated-union
  `ContractCheckResult`. Negative live cases (empty list, missing external id,
  missing filename) are warnings with `ok:true`; only a structural contract
  violation (HTML where JSON bytes are expected) or source unreachability yields
  `ok:false`. Reuses the Phase 8 DIAG `classifyFailure` to split
  `contract_broken` (permanent) from `source_unreachable` (transient/rate-limited).
  Per DIAG-04, the raw-bytes check is a boolean `JSON.parse` outcome only — the
  response body never enters `message`/`details`.
- **`src/contract-check/contract-check.test.ts`** — 16 deterministic unit tests:
  GUARD-01 fixture coverage (happy path + every warning case + a multi-row parser
  substrate assertion for changed-metadata/duplicate), GUARD-02 golden raw-URL
  identity + JSON-vs-HTML swap regression, the full transient/permanent
  classification matrix at list/detail/raw fetch points, and the GUARD-04
  source-side no-mutation static guard (split-string tokens, mirrors cli.test.ts).

## Requirements satisfied

| Req | Where |
|-----|-------|
| GUARD-01 | `contract-check.test.ts` fixture cases (no live source) |
| GUARD-02 | `toRawReplayUrl` export + golden/swap-regression tests |
| GUARD-04 (source half) | static-analysis test asserts no S3/staging/retry tokens in `contract-check.ts` |

GUARD-03 (the `contract-check` CLI command + its no-mutation behaviour test) is
Plan 12-02.

## Verification

- `pnpm exec tsc --noEmit` — clean (strict TS, no `any`/`as`).
- `pnpm exec eslint` on both new files — clean (ESLint 10 `all`).
- `pnpm exec vitest run` — full unit suite green (35 files, 434 tests).
- Scoped V8 coverage of `contract-check.ts` — 100% statements/branches/functions/lines.

## Deviations

- The frozen executor wrote `contract-check.ts` and committed Tasks 1–2, then
  stalled before the tests. The orchestrator salvaged the work, applied a small
  lint-driven refactor (extracted `tryFetch`/`probeRawEndpoint`/`warn` helpers,
  reordered imports, removed an unreachable branch) to satisfy ESLint `all`
  (max-statements/max-params/no-ternary/import order), and authored Task 3.
- Local `pnpm run verify` (integration + 100% aggregate coverage) is deferred to
  CI — Docker is unavailable locally (consistent with phases 7/11).

## Commits

- `e3d8cc6` feat(12-01): export toRawReplayUrl from discover.ts
- `2b6499a` + `daca777` feat(12-01): runContractCheck bounded one-shot probe
- `b1851ce` test(12-01): GUARD-01/02/04 contract-check unit tests + lint refactor
