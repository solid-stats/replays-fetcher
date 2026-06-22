---
phase: 19-contracts-home-config-import-fix-orphan-cleanup
verified: 2026-06-20T12:36:00Z
status: passed
score: 4/4
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 19: Contracts Home + Config Import Fix + Orphan Cleanup — Verification Report

**Phase Goal:** Cross-band data contracts live in one leaf module (`src/types/`) at the bottom of the dependency graph, no band imports a type upward, and the orphan module is gone — a pure type-move with zero runtime change.
**Verified:** 2026-06-20T12:36:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `ReplayCandidate`, `RawReplayStorageEvidence`, `RunSummary`/`CompactRunSummary`, `IngestStagingPayload` declared in `src/types/`; builders stay in their bands; `src/types/` imports nothing upward | VERIFIED | `src/types/replay-candidate.ts:1` declares `ReplayCandidate`; `src/types/raw-replay.ts:15` declares `RawReplayStorageEvidence`; `src/types/staging.ts:10` declares `IngestStagingPayload`; `src/types/run-summary.ts:51,83` declares `RunSummary`/`CompactRunSummary`. `grep -rE 'from "\.\.\/(discovery\|staging\|storage)\/' src/types/` returns 0 matches. |
| 2 | `config.ts` imports `SourceTransport` from `./types/source-transport.js` and nothing from any capability band | VERIFIED | `src/config.ts:5`: `import type { SourceTransport } from "./types/source-transport.js"`. `grep -cE 'from "\.\/(discovery\|storage\|staging)/' src/config.ts` returns 0. |
| 3 | `src/run/no-leak.ts` is deleted; `knip.jsonc` has no ignore entry for it; `pnpm run knip` reports zero orphans; `src/run/no-leak.test.ts` exists and passes | VERIFIED | `test ! -f src/run/no-leak.ts` exits 0. `grep -c 'no-leak' knip.jsonc` = 0. `pnpm run knip` exits 0 with no output (zero orphans). `src/run/no-leak.test.ts` exists; included in the 495/495 passing unit tests. |
| 4 | `pnpm run verify` exits 0; golden oracle `pnpm run test:integration` exits 0 (6/6); 100% V8 coverage; depcruise 0 errors (9 pre-existing warnings remain warn-level) | VERIFIED | `pnpm run verify` exits 0 — format, lint, typecheck, 495/495 unit tests, 100% coverage (1811/1811 stmts, 782/782 branches, 338/338 funcs), build, depcruise, knip all green. `pnpm run test:integration` exits 0 — 6/6 tests passed. `grep -c 'downward-only\|band-skip\|write-scope\|no-parser' .dependency-cruiser.cjs` = 0 (no fence enforcement added — deferred to Phase 23). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types/replay-candidate.ts` | Declares `ReplayCandidate` cross-band DTO | VERIFIED | Exists; line 1: `export interface ReplayCandidate {` |
| `src/types/raw-replay.ts` | Declares `RawReplayObjectIdentity`/`RawReplayStorageEvidence`; imports `ReplayCandidate` intra-types only | VERIFIED | Exists; line 1: `import type { ReplayCandidate } from "./replay-candidate.js"`; line 15: `export interface RawReplayStorageEvidence`. No `../discovery` or `../storage` import. |
| `src/types/staging.ts` | Declares `IngestStagingPayload`/`IngestStagingResult` | VERIFIED | Exists; line 10: `export interface IngestStagingPayload {` |
| `src/types/run-summary.ts` | Declares `RunSummary`/`CompactRunSummary`; imports nothing from capability bands | VERIFIED | Line 51: `export interface RunSummary {`; line 83: `export interface CompactRunSummary {`. `grep -cE 'from "\.\.\/(discovery\|staging\|storage)\/' src/types/run-summary.ts` = 0. |
| `src/types/source-transport.ts` | Declares `SourceTransport = "direct" \| "ssh"` | VERIFIED | Exists; sole content: `export type SourceTransport = "direct" \| "ssh";` |
| `src/types/discovery-diagnostic.ts` | Declares `DiagnosticCode`/`DiscoveryDiagnostic` (moved to keep `run-summary.ts` leaf) | VERIFIED | Exists (listed in `ls src/types/`) |
| `knip.jsonc` | No `no-leak` ignore entry; `ignoreExportsUsedInFile` retained | VERIFIED | `grep -c 'no-leak' knip.jsonc` = 0. File verified — only `entry`, `project`, `ignoreExportsUsedInFile` remain. |
| `src/run/no-leak.ts` | Must not exist (deleted) | VERIFIED | `test ! -f src/run/no-leak.ts` exits 0. |
| `src/run/no-leak.test.ts` | Must still exist and pass | VERIFIED | File exists. Passes as part of 495/495 unit suite. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/discovery/types.ts` | `src/types/replay-candidate.ts` | `export type { ReplayCandidate } from "../types/replay-candidate.js"` | WIRED | Confirmed at `src/discovery/types.ts:10` |
| `src/discovery/types.ts` | `src/types/source-transport.ts` | `export type { SourceTransport } from "../types/source-transport.js"` | WIRED | Confirmed at `src/discovery/types.ts:11` |
| `src/storage/types.ts` | `src/types/raw-replay.ts` | `export type { RawReplayObjectIdentity, RawReplayStorageEvidence, RawReplayStorageStatus } from "../types/raw-replay.js"` | WIRED | Confirmed at `src/storage/types.ts:3-7` |
| `src/staging/types.ts` | `src/types/staging.ts` | `export type { ExistingStagingEvidence, IngestStagingPayload, IngestStagingResult, IngestStagingStatus, StagingOutcomeStatus } from "../types/staging.js"` | WIRED | Confirmed at `src/staging/types.ts:4-10` |
| `src/storage/store-raw-replay.ts` | `src/types/raw-replay.ts` | `export type { RawReplayFetchFailureEvidence, StoreRawReplayResult } from "../types/raw-replay.js"` | WIRED | Confirmed at `src/storage/store-raw-replay.ts:11-14` |
| `src/config.ts` | `src/types/source-transport.ts` | `import type { SourceTransport } from "./types/source-transport.js"` | WIRED | Confirmed at `src/config.ts:5` |
| `src/run/no-leak.test.ts` | `src/logging/create-logger.ts` + `src/run/summary.ts` | Tests `REDACT_PATHS`/`toCompactSummary` redaction contract directly | WIRED | Test retained; passes; does not import deleted `no-leak.ts` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit suite green | `pnpm test` | 495/495 passed, 39/39 test files | PASS |
| 100% V8 coverage | `pnpm run test:coverage` | 1811/1811 stmts, 782/782 branches, 338/338 funcs | PASS |
| Golden integration oracle | `pnpm run test:integration` | 6/6 passed (Docker available) | PASS |
| `pnpm run verify` (aggregate gate) | `pnpm run verify` | exit 0 — all steps green | PASS |
| knip zero orphans | `pnpm run knip` | exit 0, no output (zero orphans) | PASS |
| depcruise no errors | `pnpm run depcruise` | exit 0; 9 pre-existing warnings, 0 errors | PASS |
| No band-fence enforcement added | `grep -c 'downward-only\|band-skip\|write-scope\|no-parser' .dependency-cruiser.cjs` | 0 | PASS |
| `no-leak.ts` deleted on disk | `test ! -f src/run/no-leak.ts` | exit 0 | PASS |
| `src/types/` no upward imports | `grep -rE 'from "\.\.\/(discovery\|staging\|storage)\/' src/types/` | no matches | PASS |
| `config.ts` no band imports | `grep -cE 'from "\.\/(discovery\|storage\|staging)/' src/config.ts` | 0 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| ARCH-01 | 19-01-PLAN.md | Cross-band DTOs in `src/types/`; no upward imports; builders stay in bands | SATISFIED | All 4 DTOs declared in `src/types/`; zero upward imports from `src/types/`; band `types.ts` files shimmed; builders untouched in bands |
| ARCH-02 | 19-02-PLAN.md | `config.ts` upward import of `SourceTransport` from `discovery/` removed; `config.ts` depends on nothing upward | SATISFIED | `src/config.ts:5` imports from `./types/source-transport.js`; `grep -cE 'from "\.\/(discovery\|storage\|staging)/' src/config.ts` = 0 |
| ARCH-03 | 19-03-PLAN.md | `no-leak.ts` orphan removed; knip reports zero orphans | SATISFIED | File deleted; `knip.jsonc` cleaned; `pnpm run knip` exits 0 with zero output; `no-leak.test.ts` retained and passing |

### Anti-Patterns Found

No anti-patterns found. The phase is a pure compile-time type-move:
- No `TBD`, `FIXME`, or `XXX` markers in modified files.
- No empty implementations or stubs introduced.
- No hardcoded empty data. `IngestStagingPayload`'s on-wire JSONB shape moved verbatim (golden oracle confirms behavior unchanged).

### Human Verification Required

None. All success criteria are mechanically verifiable and confirmed green.

### Gaps Summary

No gaps. All 4 phase success criteria are VERIFIED against the live codebase with command evidence.

---

_Verified: 2026-06-20T12:36:00Z_
_Verifier: Claude (gsd-verifier)_
