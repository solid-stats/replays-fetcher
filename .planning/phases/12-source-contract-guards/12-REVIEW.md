---
phase: 12-source-contract-guards
reviewed: 2026-06-12T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/discovery/discover.ts
  - src/contract-check/contract-check.ts
  - src/contract-check/contract-check.test.ts
  - src/cli.ts
  - src/cli.test.ts
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: resolved
resolution: All 3 info findings fixed in a9713e8 — typed ContractCheckWarning.code union; removed dead generatedAt option; added withRetry to the cli.test.ts GUARD-04 token list. Re-verified eslint/tsc clean, 60 tests pass, contract-check.ts 100% covered.
---

# Review — Phase 12: Source Contract Guards

**Scope:** `baed81e..HEAD` — 5 files: `src/discovery/discover.ts` (export only), `src/contract-check/contract-check.ts` (new), `src/contract-check/contract-check.test.ts` (new), `src/cli.ts` (new command), `src/cli.test.ts` (new GUARD-03/04 cases)
**Gates:** API contract — N/A (CLI). TypeScript typecheck — pass (0 errors). No retries in contract-check confirmed. S3/staging instantiation guard — confirmed at implementation level.

## API contract
N/A (CLI — `replays-fetcher` has no public HTTP API). Phase 1 gate skipped.

---

## Blockers 🔴
_none_

## High 🟠
_none_

## Medium 🟡

1. `src/contract-check/contract-check.ts:64` [dead-api] — `generatedAt?: string` is declared in `RunContractCheckOptions` but never destructured or read in `runContractCheck`, and `ContractCheckResult` carries no `generatedAt` field. The option is accepted by the type, exercised in a test (`generatedAt: "2026-06-12T..."` — test line 64 in contract-check.test.ts), but silently discarded. A caller who sets it expecting deterministic timestamping in the output will observe nothing.
   **Fix:** either remove the field, or destructure it and include it in the ok:true result shape (following the `discover.ts` pattern where `generatedAt ?? new Date().toISOString()` is propagated).

2. `src/contract-check/contract-check.ts:37` [types] — `ContractCheckWarning.code` is typed as `string`. The three codes emitted by this module (`"empty_list_page"`, `"missing_external_id"`, `"missing_filename"`) are stable, known identifiers. A `string` type means callers that switch/compare on `code` get no compiler exhaustiveness check. This diverges from the established `DiagnosticCode` union pattern (`src/discovery/types.ts:7`).
   **Fix:**
   ```ts
   export type ContractCheckWarningCode =
     | "empty_list_page"
     | "missing_external_id"
     | "missing_filename";

   export interface ContractCheckWarning {
     readonly code: ContractCheckWarningCode;
     readonly message: string;
   }
   ```
   [conv: solidstats-process-ts-standards §B — typed unions over `string` for known values]

3. `src/cli.test.ts:2014–2022` [tests] — The GUARD-04 source-scan token list in `cli.test.ts` is missing the `"withRetry"` token present in the parallel `contract-check.test.ts` guard (contract-check.test.ts, last describe block). A future `withRetry` import in `contract-check.ts` would pass the `cli.test.ts` scan but fail the `contract-check.test.ts` scan. The two guards are inconsistent — the weaker one provides false assurance.
   **Fix:** add `["with", "Retry"].join("")` to `contractCheckMutationTokens` in `cli.test.ts` (line 2022, mirror the contract-check.test.ts token list exactly).

## Low 🔵
_none_

---

## Non-Findings Checked

- **GUARD-01 boundary:** `runContractCheck` imports nothing from `storage/`, `staging/`, or `checkpoint/`. No `storeRawReplay`/`stageRawReplay` call path exists. The implementation-level boundary is clean, independent of the test-level scan.
- **No-retry invariant:** `context.sourceClient.fetchText(url)` is called without options — `attempts` defaults to 0 (one try per `SourceFetchOptions` contract in `types.ts:37`). No retry wrapper or `withRetry` import present.
- **Config-before-source ordering:** `registerContractCheckCommand` calls `loadDryRunSourceConfig` (which uses `loadSourceConfig`, not `loadConfig`) before constructing the source client or calling the probe. S3/PostgreSQL env vars are not required for this command. GUARD invariant honoured.
- **DIAG-04 compliance:** All failure messages in `makeFetchFailureResult` and `probeRawEndpoint` are static strings. No body text, response content, or error `.message` leaks into `message` or `details`. The HTML-vs-JSON check in `isJson` reduces to a boolean.
- **`makeFetchFailureResult` classification completeness:** All three `SourceFetchCode` values are handled. `source_unavailable` is correctly delegated through `classifyFailure`: 5xx → `transient` → `source_unreachable`; 4xx non-retryable → `permanent` → `contract_broken`; 429 → `rate_limited` → `source_unreachable`. Non-`SourceFetchError` → `contract_broken`. No gap.
- **`warnings` aliasing:** `warn()` returns `{ ..., warnings: context.warnings }` (live array reference). All `warn()` calls are early returns — no further mutations follow. Probing does not continue after `warn()`. Safe in current control flow, fragile if refactored.
- **`toRawReplayUrl` export:** Adding `export` to the function is the only change. The internal call at line 412 is unaffected. No callers inside or outside the module are broken.
- **`interface` vs `type` in `contract-check.ts`:** `interface` is the pervasive existing pattern across `src/` (cli.ts, staging, storage, run/summary.ts). Not phase-12-introduced debt; out-of-scope pre-existing.

## Out of scope (pre-existing)

- `pnpm run verify` red state (prettier/eslint on `src/run/*`, coverage gaps in `cli.ts:200,486-487` and `run-once.ts:360,722`) — all blamed to `f5a6450c`, pre-phase-12.

---

## Verdict

**REQUEST CHANGES** — findings 1, 2, 3 are all 🟡. Mandatory fix: none (all three are negotiable). Recommended before merge: fix 2 (`code: string` → union type) and fix 3 (GUARD-04 token parity) as they tighten the type safety and test integrity that this phase exists to establish. Finding 1 (`generatedAt`) can be resolved either by removal or by wiring it through — clarify intent first.

_Reviewed: 2026-06-12T00:00:00Z_
_Reviewer: Claude (solidstats-backend-ts-code-review)_
_Depth: standard_
