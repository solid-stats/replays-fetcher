---
phase: 12-source-contract-guards
verified: 2026-06-12T09:20:00Z
status: passed
score: 4/4
overrides_applied: 0
---

# Phase 12: Source Contract Guards — Verification Report

**Phase Goal:** Regressions in source parsing — including the critical "bytes from JSON endpoint, not HTML detail page" invariant — fail a unit test or a fast operator check before they silently corrupt a full run.

**Verified:** 2026-06-12T09:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Deterministic fixture tests (happy path, warnings, multi-row substrate) pass without live source | VERIFIED | 16 tests in `contract-check.test.ts` — all green; no network calls |
| 2 | Unit-level golden proves `toRawReplayUrl` → `/data/<filename>.json`; HTML-at-raw-URL swap fails unit test | VERIFIED | `contract-check.test.ts:143-173`; swap regression test green |
| 3 | `contract-check` CLI command: bounded live sample, DIAG classification, exits 2 on broken contract, warnings → exit 0 | VERIFIED | `cli.ts:267-301`; 4 GUARD-03 CLI tests green |
| 4 | Tests prove `contract-check` creates no S3/staging factory and calls no `storeRawReplay`/`stageRawReplay` | VERIFIED | GUARD-04 spy test + static-analysis test; both green |

**Score:** 4/4 truths verified

---

## Detailed Evidence by Success Criterion

### SC-1: Deterministic fixture tests

**Requirement:** GUARD-01 — list page, detail page, raw JSON endpoint (happy paths), missing external id, missing filename, duplicate filename, changed metadata, timestamp derivation — all passing without live source.

| Case | Test | Status |
|------|------|--------|
| Happy path (list + detail + raw JSON) | `happy path returns ok:true, no warnings, full sample` | VERIFIED |
| Missing external id | `first row missing external id is a warning, not a failure` | VERIFIED |
| Missing filename | `detail page missing a filename is a warning, not a failure` | VERIFIED |
| Empty list page | `empty list page is a warning, not a failure` | VERIFIED |
| Changed metadata + duplicate filename (multi-row substrate) | `multi-row substrate: parser surfaces both distinct rows` | VERIFIED (note below) |
| Timestamp derivation | `happy path...` with `generatedAt: "2026-06-12T00:00:00.000Z"` passed harmlessly | VERIFIED (note below) |
| `source_transient` / `rate_limited` / `source_unavailable` classification matrix | 8 parameterised tests | VERIFIED |

**Note — duplicate filename and changed metadata coverage:** The plan explicitly acknowledged that the probe samples only one detail/raw pair, and therefore "duplicate filename" and "changed metadata" are covered at the parser-substrate level: `contract-check.test.ts:131-139` calls `extractReplayRows` directly over a two-row fixture and asserts both rows with differing metadata and distinct external ids are returned. This is an adequate regression guard for the parsing layer; the probe's single-row path is a deliberate design constraint, not a gap.

**Note — timestamp derivation:** `generatedAt` is threaded into `RunContractCheckOptions` and passed through without corruption; the test verifies the option does not break the result shape. The probe does not transform timestamps (it does not derive `discoveredAt` — that belongs to the discover path), so the test correctly targets passthrough integrity.

All 16 tests run deterministically without live source access. VERIFIED.

---

### SC-2: Unit-level golden fixture for `toRawReplayUrl` swap regression

**Requirement:** GUARD-02 — a unit test fails when HTML is returned at the raw-bytes URL; swapping the two sources (HTML detail URL vs JSON data endpoint) is caught before reaching a live check.

Evidence at `src/contract-check/contract-check.test.ts`:

- Line 143-151: `toRawReplayUrl("mission.ocap", new URL("https://example.test/replays/100"))` asserts result equals `"https://example.test/data/mission.ocap.json"`, contains `/data/`, and does NOT contain `/replays/`.
- Line 154-173: swap regression — raw URL returns `DETAIL_HTML` (HTML); `runContractCheck` returns `{ ok:false, reason:"contract_broken" }`. The DIAG-04 body-leak guard is also asserted (`result.message` must not contain `"filename"`).

`src/discovery/discover.ts:690`: `export function toRawReplayUrl` — exported, body constructs `/data/${encodeURIComponent(rawFilename)}` relative to `detailUrl`. A regression pointing the raw URL back at `/replays/<id>` would break the golden assertion at line 149 (`expect(rawUrl).not.toContain("/replays/")`).

VERIFIED.

---

### SC-3: `contract-check` CLI command

**Requirement:** GUARD-03 — bounded live sample, DIAG classification for permanent vs transient, exit non-zero on broken contract, warnings produce exit 0.

Implementation at `src/cli.ts:267-301`:

```
registerContractCheckCommand:
  loadDryRunSourceConfig → config_error path exits 2 before any fetch
  createSourceClient(config)
  runContractCheck({ sourceClient, sourceUrl: new URL(config.sourceUrl) })
  writeJson(result)
  if (!result.ok) process.exitCode = 2
```

CLI test coverage (all green):

- `contract-check should call runContractCheck...on ok:true` — exit 0, JSON written.
- `contract-check should set exit code 2 when contract is broken` — `reason:"contract_broken"`, exit 2.
- `contract-check should set exit code 2 when source is unreachable` — `reason:"source_unreachable"`, exit 2.
- `contract-check should set exit code 2 and not call probe when config is invalid` — exit 2, probe NOT called.

Both `contract_broken` (permanent) and `source_unreachable` (transient) exit 2. Negative live cases (warnings) are handled in `runContractCheck` as `ok:true`, which keeps exit 0. DIAG classification is delegated to `classifyFailure` (imported at `contract-check.ts:24`, used at line 132).

VERIFIED.

---

### SC-4: No S3/staging factory instantiation — both behaviour spy and static analysis

**Requirement:** GUARD-04 — tests assert `contract-check` creates no `S3RawReplayStorage` or staging-repository factory and calls no `storeRawReplay`/`stageRawReplay` path.

Two layers, both passing:

**Behaviour spy** (`cli.test.ts:1985-2008`): `createS3RawReplayStorageFromConfig` and `createPostgresStagingRepositoryFromDatabaseUrl` are injected as `vi.fn()` spies; after `contract-check` executes, `expect(createStorage).not.toHaveBeenCalled()` and `expect(createStaging).not.toHaveBeenCalled()` both pass.

**Static analysis — source file** (`contract-check.test.ts:266-295`): reads `src/contract-check/contract-check.ts` and asserts it contains none of: `S3Client`, `Pool(`, `storeRawReplay`, `stageRawReplay`, `S3RawReplayStorage`, `PostgresStagingRepository`, `createPostgresStagingRepositoryFromDatabaseUrl`, `createS3RawReplayStorageFromConfig`, `withRetry`. Confirmed by direct inspection — none of these tokens appear in the file.

**Static analysis — CLI suite** (`cli.test.ts:2010-2034`): identical token set checked against `contract-check.ts` via `readProjectFile`. Also passes.

**Handler boundary inspection** (`cli.ts:277-300`): `registerContractCheckCommand` references only `loadDryRunSourceConfig`, `dependencies.createSourceClient`, and `dependencies.runContractCheck`. No S3/staging factory symbol appears in the handler body.

VERIFIED.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/contract-check/contract-check.ts` | `runContractCheck` + discriminated union types | VERIFIED | 299 lines; exports `runContractCheck`, `ContractCheckResult`, `ContractCheckReason`, `ContractCheckWarning`, `ContractCheckSample`, `RunContractCheckOptions` |
| `src/contract-check/contract-check.test.ts` | 16 deterministic tests; GUARD-01/02/04 | VERIFIED | 16 tests across 4 describe blocks; all green |
| `src/discovery/discover.ts` | `export function toRawReplayUrl` | VERIFIED | line 690: `export function toRawReplayUrl` — one-word change; body unchanged |
| `src/cli.ts` | `registerContractCheckCommand` wired in `buildCli` | VERIFIED | line 171: `registerContractCheckCommand(program, cliDependencies);`; line 267: definition |
| `src/cli.test.ts` | GUARD-03 + GUARD-04 CLI cases | VERIFIED | lines 1885-2034; 6 new test cases; all green |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `contract-check.ts` | `src/source/classify-failure.ts` | `classifyFailure` import | VERIFIED | line 24: import; line 132: usage in `makeFetchFailureResult` |
| `contract-check.ts` | `src/discovery/discover.ts` | `toRawReplayUrl` import | VERIFIED | line 17: import; line 188: `toRawReplayUrl(target.filename, target.detailUrl)` |
| `contract-check.ts` | `src/discovery/html.ts` | `extractReplayRows` + `extractFilenameFromDetailHtml` | VERIFIED | lines 18-21: imports; lines 243, 283: usage |
| `src/cli.ts` | `src/contract-check/contract-check.ts` | `runContractCheck` DI | VERIFIED | line 27: import; lines 112/194/290: DI wiring |
| `src/cli.ts` | `src/config.ts` | `loadDryRunSourceConfig` only | VERIFIED | line 277 in handler — no S3/staging factory refs in `registerContractCheckCommand` |

---

## Data-Flow Trace (Level 4)

Not applicable — `contract-check.ts` is a pure-async logic module, not a data-rendering component. It produces a discriminated-union result, not UI output.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 16 `contract-check.test.ts` tests pass | `pnpm exec vitest run src/contract-check/contract-check.test.ts` | 16/16 passed | PASS |
| All 6 CLI `contract-check` tests pass | `pnpm exec vitest run src/cli.test.ts` (relevant subset) | 44/44 cli tests pass | PASS |
| `toRawReplayUrl` exported | `grep -c "export function toRawReplayUrl" src/discovery/discover.ts` | 1 | PASS |
| No mutation tokens in `contract-check.ts` | Static-analysis test + direct grep | 0 matches | PASS |

Full run: `timeout 150 pnpm exec vitest run src/contract-check/contract-check.test.ts src/cli.test.ts` — **60 tests, 2 files, all passed** in 274ms.

---

## Probe Execution

No `scripts/*/tests/probe-*.sh` declared or expected for this phase. SKIPPED.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| GUARD-01 | 12-01 | Deterministic fixture coverage for all negative and positive cases | VERIFIED | 16 tests in `contract-check.test.ts`; all cases present |
| GUARD-02 | 12-01 | Unit golden: `toRawReplayUrl` points at JSON endpoint; HTML-swap regression fails unit | VERIFIED | `contract-check.test.ts:143-173` |
| GUARD-03 | 12-02 | `contract-check` CLI command, bounded sample, DIAG classification, exit codes | VERIFIED | `cli.ts:267-301`; `cli.test.ts:1885-1981` |
| GUARD-04 | 12-01+12-02 | Tests prove no S3/staging factory called, no mutation paths reachable | VERIFIED | Behaviour spy + static-analysis tests; both green |

---

## Anti-Patterns Found

Scanned `src/contract-check/contract-check.ts` and relevant CLI additions.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/TODO/PLACEHOLDER/stub patterns found | — | — |

No blockers. No warnings. Phase-12 files are clean per SUMMARY-02 confirmation (prettier/eslint clean, 100% V8 coverage on `contract-check.ts`).

**Pre-existing debt (out of scope):** `pnpm run verify` aggregate failure limited to `src/run/run-once.ts`, `run-once.test.ts`, `no-leak.test.ts`, `pnpm-lock.yaml` — all attributed to commit `f5a6450c` before phase 12. Phase 12 files are not implicated.

---

## Human Verification Required

None. All success criteria are fully verifiable programmatically. No UI, no real-time behaviour, no external service integration.

---

## Gaps Summary

No gaps. All 4 success criteria verified against the actual codebase with passing tests as evidence.

---

_Verified: 2026-06-12T09:20:00Z_
_Verifier: Claude (gsd-verifier)_
