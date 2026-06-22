---
phase: 19-contracts-home-config-import-fix-orphan-cleanup
reviewed: 2026-06-20T10:30:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - src/types/replay-candidate.ts
  - src/types/raw-replay.ts
  - src/types/staging.ts
  - src/types/discovery-diagnostic.ts
  - src/types/source-transport.ts
  - src/types/run-summary.ts
  - src/discovery/types.ts
  - src/staging/types.ts
  - src/storage/types.ts
  - src/storage/store-raw-replay.ts
  - src/config.ts
  - .agents/skills/solidstats-fetcher-ts-conventions/SKILL.md
  - .dependency-cruiser.cjs
  - knip.jsonc
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Review — Phase 19: Contracts Home + Config Import Fix + Orphan Cleanup

**Scope:** branch `gsd/v3.1-convention-compliance-tech-debt-closure` vs `master`; phase 19 commits only (88bc3b5, 246d12e, 10e305b, 25a7486, c8aae57, 3fd471e); files listed above.
**Depth:** deep (three lenses: Contract Adversary, Edge / Failure Hunter, Acceptance Auditor)

---

## Ingest boundary

✅ No parser / content-decode import anywhere in the diff or in the new `src/types/` modules.
✅ No new PG write path; no touch of `server-2` business tables (`replays`, `parse_jobs`, etc.).
✅ No new S3 write path; moved types are compile-time only — no write-scope change.
✅ No new evidence write path requiring a field check (pure type-move; builders unchanged).
✅ No new staging write path; idempotency gate not triggered.

**Boundary gate: PASS (all ✅)**

---

## Blockers 🔴

_none_

## High 🟠

_none_

## Medium 🟡

_none_

## Low 🔵

_none_

---

## Non-Findings Checked

**Contract Adversary lens**

- Leaf invariant of `src/types/` — verified by grep: the only `../` imports in `src/types/` are two references to `../source/retry.js` (`run-summary.ts:1`, `discovery-diagnostic.ts:1`). `src/source/` is itself a cross-cutting leaf (no outbound parent-relative imports), so these are cross-cutting → cross-cutting references — not upward. Zero band-ward imports remain. ARCH-01 satisfied.
- `config.ts` upward import removal — `grep 'discovery/types' src/config.ts` returns 0. Import is now `./types/source-transport.js`. `SourceTransport` semantics (`"direct" | "ssh"`) and all three use-sites (`sourceTransportOrUndefined`, `readSourceConfigInput`, `SourceConfigInput.sourceTransport`) are byte-identical. ARCH-02 satisfied.
- `discovery/types.ts` shim — exports `SourceTransport`, `ReplayCandidate`, `DiagnosticCode`, `DiagnosticSeverity`, `DiscoveryDiagnostic` downward from `src/types/`. All are `export type { … } from "…"` — zero behavior. Import direction confirmed downward (to `../types/…`).
- `staging/types.ts` shim — exports `ExistingStagingEvidence`, `IngestStagingPayload`, `IngestStagingResult`, `IngestStagingStatus`, `StagingOutcomeStatus` downward from `../types/staging.js`. The pre-existing `import type { RawReplayStorageEvidence } from "../storage/types.js"` on line 1 is a pre-existing sibling-band advisory (one of the 9 depcruise warn-level items out of scope for Phase 19); not introduced by this diff.
- `storage/types.ts` shim — exports `RawReplayObjectIdentity`, `RawReplayStorageEvidence`, `RawReplayStorageStatus` downward from `../types/raw-replay.js`. Zero behavior.
- `storage/store-raw-replay.ts` shim — exports `RawReplayFetchFailureEvidence`, `StoreRawReplayResult` downward from `../types/raw-replay.js`. The function body `storeRawReplay` is unchanged; imports repointed correctly to `../types/replay-candidate.js` and `../types/raw-replay.js`.
- Circular-ref risk (`raw-replay.ts` → `RawReplayStorageEvidence.source: ReplayCandidate["source"]`) — resolved by intra-`src/types/` import: `raw-replay.ts:1` imports `ReplayCandidate` from `./replay-candidate.js`, never via the `storage/` shim. No `types/ → band/ → types/` cycle.
- `.dependency-cruiser.cjs` — inspected in full. The `forbidden` array contains no new rule with band-fence tokens (`downward-only`, `band-skip`, `write-scope`, `no-parser`). The change is a header comment block (lines 2-8) naming `src/types/` as the leaf contracts band and explicitly deferring band-fence enforcement to Phase 23. No `forbidden` rule was enabled.

**Edge / Failure Hunter lens**

- No async paths, no I/O, no checkpoint, no staging write in the diff. Pure compile-time type declarations and re-exports. Edge / failure risk: not applicable to this change.
- `storeRawReplay` function body in `store-raw-replay.ts` — unchanged line-for-line; the shim additions (`export type { … }`) are before the function and do not affect it.

**Acceptance Auditor lens**

- ARCH-01: Leaf invariant holds — `grep -rE 'from "\.\.\/(discovery|staging|storage|run|commands)/' src/types/` returns zero matches. Confirmed.
- ARCH-02: `grep -c 'discovery/types' src/config.ts` → 0. Config uses `./types/source-transport.js`. Confirmed.
- ARCH-03: `no-leak.ts` confirmed deleted on disk; `no-leak.test.ts` retained with zero import of the deleted file (imports `createLogger`, `toCompactSummary`, `runOnce` directly — redaction contract still exercised). `knip.jsonc` no-leak ignore entry confirmed removed. `pnpm run knip` reported PASS in 19-03-SUMMARY.md.
- `knip.jsonc` post-change — `ignore` array dropped entirely; remaining fields (`entry`, `project`, `ignoreExportsUsedInFile`) are unchanged. Zero risk of phantom orphan suppression.
- SKILL.md §5 — stale claim "Today `RunSummary` is in `run/types.ts` and `evidence/` imports it upward" confirmed absent. Current §5 states the completed state accurately.
- `src/cli.test.ts` colocation guard — `crossSurfaceTestFiles` allowlist added at line 1450; `no-leak.test.ts` excluded from the 1:1 sibling check. Fix is scoped and documented. No other test's colocation requirement changed.
- Gate results from SUMMARY files: typecheck ✅, depcruise 0 errors (9 pre-existing warns unchanged) ✅, knip zero orphans ✅, 495/495 unit tests ✅, 100% V8 coverage ✅, build ✅, golden integration oracle 6/6 ✅.

---

## Verdict

**APPROVE.**

This is a clean pure type-move with no semantic change. All six leaf-contract files (`replay-candidate.ts`, `raw-replay.ts`, `staging.ts`, `discovery-diagnostic.ts`, `source-transport.ts`, `run-summary.ts`) contain only type/interface declarations with no upward imports beyond the legitimate cross-cutting `../source/retry.js`. All four downward shims are `export type { … } from "…"` with zero added behavior. `config.ts` no longer imports from a capability band. The `no-leak.ts` orphan is removed with its T-11-09 contract provably intact. The depcruise file change is comment-only with no `forbidden` rule enabled.
