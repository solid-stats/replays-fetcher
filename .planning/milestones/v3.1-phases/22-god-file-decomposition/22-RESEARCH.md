# Phase 22: God-File Decomposition - Research

**Researched:** 2026-06-20
**Domain:** Pure structural refactor — splitting four `max-lines`-suppressed TypeScript modules into cohesive within-band siblings, zero behavior change
**Confidence:** HIGH (all findings grounded in the live source tree read in full this session)

## Summary

Four files carry exactly one `/* oxlint-disable max-lines */` each and must drop under the
300-line threshold with the suppression removed: `run-once.ts` (1043L), `discover.ts` (701L),
`source-client.ts` (534L), `replay-byte-client.ts` (489L). Each file is internally cohesive but
oversized — the helper clusters within each are clean candidates for extraction into sibling
modules **in the same band directory** (`run/`, `discovery/`, `storage/`). No extraction needs to
cross a band or touch a shared `adapters/` dir, so every split already satisfies the Phase 23
fences by construction. [VERIFIED: read all four files + band dirs + `.dependency-cruiser.cjs` + conventions §A]

The single most important parallel-safety fact: **all four files expose their public exports to
exactly one runtime consumer — `src/commands/shared.ts`** (plus `contract-check.ts` for two
discovery symbols). If each split keeps its public export(s) where callers already import them
(parent file re-exports the moved internals), then **no caller file is edited by any split**, and
the `files_modified` sets are pairwise disjoint. Under that rule, **all four splits are
file-disjoint and may run concurrently** — including `discover.ts` and `source-client.ts`, which
share the `discovery/` band but would each touch only their own parent + new siblings.
[VERIFIED: grep of all importers]

**Primary recommendation:** Split by extracting the labelled cohesive clusters below into new
same-band sibling files; keep every current public export in its original parent (move helpers
out, re-export nothing the parent doesn't already export). Run `verify` + the golden run-once
oracle after EACH extraction commit. Splits are parallelizable; sequence `discover.ts` before/with
`source-client.ts` only if the planner chooses to also relocate the shared `SourceFetchError`
contract (see Pitfall 2 — recommended: do NOT relocate it in Phase 22).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| run-once page-loop orchestration | Orchestration (`run/`) | — | one ingest cycle; sequencing + checkpoint live here |
| discovery candidate assembly | Capability (`discovery/`) | — | returns validated domain data from source HTML/fixtures |
| source-text fetch (HTTP/SSH) | Adapter (`discovery/source-client.ts`) | — | only code that talks to the HTTP/SSH source for list/detail reads |
| replay-byte fetch (HTTP/SSH) | Adapter (`storage/replay-byte-client.ts`) | — | only code that fetches raw replay bytes |

All four splits stay within their owning band; adapters stay **inside their capability dir** (never
a shared `adapters/`), per conventions §A. [CITED: solidstats-fetcher-ts-conventions §A]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- The four files carrying `oxlint-disable max-lines` are split into cohesive modules strictly
  within their own bands; suppressions removed for good; pure structural refactor, no behavior change.
- No split crosses a band or lands in a shared `adapters/` dir.
- `pnpm run verify` (incl. depcruise + knip) green after EACH extraction, not only at phase end;
  commits read as pure moves.
- Docker golden run-once oracle (`src/run/golden-e2e.integration.test.ts`) + 100% V8 coverage stay
  green after every extraction.
- `parallel` is ENABLED. File-disjoint splits in the same wave run concurrently in isolated
  worktrees (merge back per executor). CAUTION: `discover.ts` + `source-client.ts` share the
  `discovery/` band — if their `files_modified` overlap they MUST run sequentially.

### Claude's Discretion
- max-lines threshold = 300 (oxlint base preset). Each parent AND every new sibling must end < 300
  with the suppression removed.
- Splits extract COHESIVE internal helper groups into sibling modules in the SAME band dir
  (e.g. `discovery/source-client.ts` → `discovery/source-client-*.ts`). Public exports stay where
  callers import them (or re-export to avoid churn).
- Pure structural moves: no logic/identifier/signature change. Behavior oracle is the golden
  run-once oracle, NOT just coverage.

### Deferred Ideas (OUT OF SCOPE)
None — discuss skipped.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SPLIT-01 | `src/run/run-once.ts` split within band; `max-lines` removed | Cohesion map + 3-sibling proposal below; highest-risk (orchestration core) |
| SPLIT-02 | `src/discovery/discover.ts` split within band; `max-lines` removed | Cohesion map + 2-sibling proposal; `toRawReplayUrl` public export stays in parent |
| SPLIT-03 | `src/discovery/source-client.ts` split within band; `max-lines` removed | Cohesion map + 2-sibling proposal; `SourceFetchError` + `createSourceClient` stay in parent |
| SPLIT-04 | `src/storage/replay-byte-client.ts` split within band; `max-lines` removed | Cohesion map + 1–2-sibling proposal; mirrors source-client structure |
</phase_requirements>

## Per-File Extraction Plans

> Line counts below are the current parent file totals. After each extraction the parent shrinks
> by the moved block plus retains its imports of the new sibling. The planner must re-measure each
> file with `wc -l` after every move and confirm < 300 before removing the suppression line.

### SPLIT-01 — `src/run/run-once.ts` (1043L → parent + 3 siblings) — HIGHEST RISK

Public exports (must stay importable from `run-once.ts`): `runOnce` (used by `commands/shared.ts`),
`RunOnceResult` (type), `derivePagesPerMinute` (exported; consumed only inside this file — knip
keeps it via `ignoreExportsUsedInFile`). [VERIFIED: grep importers]

Cohesive clusters (all pure, no I/O of their own beyond injected seams):

| New sibling | Symbols to move | Lines (approx) |
|-------------|-----------------|----------------|
| `run/run-once-checkpoint.ts` | `ResumeState`, `startFresh`, `resumeFrom`, `resolveResumeState`, `LoopState`, `buildLoopState`, `BuildCheckpointInput`, `buildCheckpoint`, `WritePageCheckpointInput`, `writePageCheckpoint`, `writeFinalCheckpoint`, `writeInput`, `aggregatePageCounts`, `discoveredRangeOption`, `sourceFailureOption`, `resumeInvocationOption`, `RESUME_INVOCATION` | ~230 |
| `run/run-once-summary.ts` (or fold into existing `run/summary.ts` callers) | `derivePagesPerMinute`, `deriveCandidatesPerMinute`, `EmitPageRateLineInput`, `emitPageRateLine`, `derivePageFailureEventName`, `derivePageFailureMessage`, `emitPageFailureEvent`, `AssembleResultInput`, `assembleResult`, `writeEvidence`, `deriveDiscoveredLastPage`, constants `MS_PER_MINUTE`/`LAST_TIMESTAMP_INDEX` | ~260 |
| `run/run-once-page.ts` | `RunRuntime`, `buildRunRuntime`, `defaultPacer`, `CONCURRENCY_FLOOR`, `MutablePageCounts`, `ProcessPageInput`, `processPage`, `applyRateLimitThrottle`, `CompleteOkPageInput`/`Result`, `completeOkPage`, `PageLoopContext`, `runPageLoop`, `MutableDiscoveryReport`, `emptyDiscoveryReport`, `appendDiscoveryReport`, `buildDiscoverInput`, `toPageUrl`, `FIRST_PAGE` | ~330 → may need to split into two if still > 300 |

Parent `run-once.ts` retains: `RunOnceInput` type, `RunOnceResult`, `sanitizeSourceUrl`, the
`runOnce` entry function, and `derivePagesPerMinute` re-exported from the summary sibling so its
existing export site is preserved. After extraction the parent is ~120L. [VERIFIED: structure read in full]

**Risk note (CONTEXT specifics):** run-once is the orchestration core; a dropped branch here passes
coverage but the golden oracle catches it. The `runPageLoop` stop-reason logic (cap / empty /
all_duplicate / page_failed) and the `require-atomic-updates` suppressions on `state.etag` /
`state.lastCompletedPage` must move verbatim with their inline comments. The page-loop cluster is
the largest; if `run-once-page.ts` lands > 300, split the rate/emit helpers (`emitPageRateLine`,
`deriveCandidatesPerMinute`) into the summary sibling and keep only the loop driver + page
completion in `run-once-page.ts`. Plan this file as its own wave (or its own sequential sub-step)
with `verify` + golden oracle after each of its internal moves.

### SPLIT-02 — `src/discovery/discover.ts` (701L → parent + 2 siblings)

Public exports (must stay importable from `discover.ts`): `discoverReplaysDryRun` (used by
`commands/shared.ts`), `toRawReplayUrl` (used by `contract-check/contract-check.ts`). [VERIFIED: grep]

| New sibling | Symbols to move | Lines (approx) |
|-------------|-----------------|----------------|
| `discovery/discover-candidate.ts` | `SourceCandidateFixture`, `SourceFixture`, `MutableReplayMetadata`, `MutableReplaySource`, `CandidateFixtureResult`, `CandidateRegistryEntry`, `parseSourceFixture`, `isValidFixtureUrl`, `toReplayCandidate`, `toReplayCandidateFromHtmlRow`, `hasChangedMetadata`, `collectCandidateDiagnostics`, `discoverRowCandidate`, `collectFixtureCandidates`, `discoverPageCandidates`, `DiscoverPageCandidatesResult`, `ReadOptions` | ~310 → may need a further split |
| `discovery/discover-diagnostics.ts` | `attachNumber`, `attachString`, `attachPhase`, `attachCfChallenge`, `withSourceFailureEvidence`, `detailUrlOrSource`, `buildSourceFailureDiagnostic`, `diagnosticEvidence`, `withOptionalDiagnosticEvidence`, `buildReadOptions`, `buildReport`, `BuildReportOptions` | ~180 |

Parent `discover.ts` retains: `DiscoverReplaysDryRunOptions`, `toRawReplayUrl` (public), `toPageUrl`,
`defaultRequestDelayMs`, `defaultSleep`, `createPacedSourceClient`, and the `discoverReplaysDryRun`
entry. After extraction ~140L. The `collectCandidateDiagnostics` + `discoverPageCandidates` cluster
is the heaviest; if `discover-candidate.ts` exceeds 300, move the dedup/registry helpers
(`hasChangedMetadata`, `collectCandidateDiagnostics`, `CandidateRegistryEntry`) into a third sibling
`discovery/discover-dedup.ts`. [VERIFIED: structure]

### SPLIT-03 — `src/discovery/source-client.ts` (534L → parent + 2 siblings)

Public exports (must stay importable from `source-client.ts`): `SourceFetchError` class (used by
`discover.ts` AND `contract-check.ts`), `createSourceClient` (used by `commands/shared.ts` +
`check/source-connectivity.ts` + `contract-check.ts`). [VERIFIED: grep]

| New sibling | Symbols to move | Lines (approx) |
|-------------|-----------------|----------------|
| `discovery/source-client-error.ts` | `BuildErrorInput`, `buildSourceFetchError`, `toFetchCode`, `DirectHttpErrorInput`, `buildDirectHttpError`, `reclassifyDirect`, `classifyDirect`, `classifySsh`, `DirectFetchErrorInput`, `toDirectFetchError`, `SshFetchErrorInput`, `toSshFetchError`, `buildPageInput`, `directRetryAfter`, `detectCloudflareChallenge`, `CloudflareChallengeError`, `isCloudflareChallengeError`, `cfBodyMarkers`, `httpHeaderRetryAfter`, `resolvePhase` | ~270 |
| `discovery/source-client-retry.ts` | `RetryWiring`, `runWithRetry`, `totalTries`, `noRetryAttempts`, `initialTry` | ~70 |

Parent `source-client.ts` retains: `SourceFetchError` (public class — see Pitfall 2: keep here),
`ExecFile`/`ExecFileOptions` types, `defaultExecFile`, `CreateSourceClientOptions`,
`createDirectSourceClient`, `createSshSourceClient`, `createSourceClient` entry. After extraction
~230L. NOTE: `source-client-error.ts` imports `SourceFetchError` from the parent — this is a
**same-band sibling↔parent import**, which depcruise's no-circular rule permits as long as the
parent does not also import a *value* from the error sibling at module-eval time that creates a
cycle. Because `createDirectSourceClient`/`createSshSourceClient` call the error-builders at
runtime (inside async closures), the parent imports the builders from the sibling and the sibling
imports the `SourceFetchError` class from the parent — **this is a circular import** and will trip
`no-circular`. **Mitigation:** move `SourceFetchError` itself into `source-client-error.ts` and
**re-export it from the parent** (`export { SourceFetchError } from "./source-client-error.js"`),
so the class lives in the sibling, the parent re-exports it for `discover.ts`/`contract-check.ts`,
and there is no cycle. [VERIFIED: import direction analysis — this is the one non-trivial graph hazard in the phase]

### SPLIT-04 — `src/storage/replay-byte-client.ts` (489L → parent + 1–2 siblings)

Public exports (must stay importable from `replay-byte-client.ts`): `ReplayByteClient` (type),
`ReplayByteFetchError` (class), `ByteFetchOptions` (type), `createReplayByteClient`. Consumers:
`commands/shared.ts`, `run/run-once.ts`, `run/ingest-page.ts`, `run/watch-loop.ts`. [VERIFIED: grep]

This file mirrors `source-client.ts` almost exactly. Same extraction shape and same circular-import
hazard for `ReplayByteFetchError`:

| New sibling | Symbols to move | Lines (approx) |
|-------------|-----------------|----------------|
| `storage/replay-byte-client-error.ts` | `ReplayByteFetchError` (move here, re-export from parent), `BuildErrorInput`, `buildByteFetchError`, `toByteCode`, `DirectHttpErrorInput`, `buildDirectHttpError`, `reclassifyDirect`, `classifyDirect`, `classifySsh`, `DirectByteErrorInput`, `toDirectByteError`, `SshByteErrorInput`, `toSshByteError`, `buildPageInput`, `directRetryAfter`, `httpHeaderRetryAfter`, `bytesPhase` | ~230 |
| `storage/replay-byte-client-retry.ts` | `RetryWiring`, `runWithRetry`, `totalTries`, `noRetryAttempts`, `initialTry` | ~70 |

Parent `replay-byte-client.ts` retains: `ReplayByteClient` + `ByteFetchOptions` types, the
re-exported `ReplayByteFetchError`, `ExecFile`/`ExecFileOptions`, `defaultExecFile`,
`CreateReplayByteClientOptions`, `createDirectReplayByteClient`, `createSshReplayByteClient`,
`createReplayByteClient`. After extraction ~210L. If still > 300 split the two adapter factories
out; current estimate puts it safely under. [VERIFIED: structure]

## Import-Graph Safety

Every proposed sibling lives in the **same band dir** as its parent, so no extraction introduces an
upward or cross-band import. Downward imports the moved symbols already carry (all
same-or-downward):

- `run/` siblings import from `discovery/types`, `source/*`, `staging/*`, `storage/*`, `checkpoint/*`,
  `evidence/*`, `types/*` — all downward from Orchestration. [VERIFIED: run-once imports]
- `discovery/` siblings import from `source/retry`, `types/*`, and within-band `html.ts` +
  `source-client.ts` (`SourceFetchError`). [VERIFIED: discover imports]
- `source-client` / `replay-byte-client` siblings import from `config.ts`, `errors/app-error`,
  `source/*`, within-band `types.ts` — all Cross-cutting (downward). [VERIFIED: both files]

**The one hazard — same-band circular import** (SPLIT-03 and SPLIT-04): the error-builder siblings
must reference the `*FetchError` class, and the parent factories reference the error builders. Break
the cycle by **relocating the error class into the `*-error.ts` sibling and re-exporting it from the
parent**. With that move, the dependency is strictly: parent → error-sibling → (errors/app-error,
source/*); retry-sibling → source/retry; no back-edge from sibling to parent. `no-circular` stays
green. [VERIFIED: import-direction reasoning; this is the planner's must-do detail]

No helper, if moved, forces a NEW upward/cross-band import. The only symbols that MUST remain
import-reachable from their original parent path are the public exports listed per file above
(re-export from parent where the symbol physically moves).

## Parallel-Safety Verdict

`files_modified` per split, under the "keep public exports in parent, edit no callers" rule:

| Split | files_modified |
|-------|----------------|
| SPLIT-01 | `run/run-once.ts`, `run/run-once-checkpoint.ts`, `run/run-once-summary.ts`, `run/run-once-page.ts` (+ matching `.test.ts` if tests are co-split) |
| SPLIT-02 | `discovery/discover.ts`, `discovery/discover-candidate.ts`, `discovery/discover-diagnostics.ts` (+ optional `discover-dedup.ts`) |
| SPLIT-03 | `discovery/source-client.ts`, `discovery/source-client-error.ts`, `discovery/source-client-retry.ts` |
| SPLIT-04 | `storage/replay-byte-client.ts`, `storage/replay-byte-client-error.ts`, `storage/replay-byte-client-retry.ts` |

**These four sets are pairwise DISJOINT.** No split edits `commands/shared.ts`, `contract-check.ts`,
or any other caller, because public export paths are preserved. Therefore:

- **All four splits are mutually file-disjoint and parallelizable** — including SPLIT-02
  (`discover.ts`) and SPLIT-03 (`source-client.ts`), which share the `discovery/` band but touch
  only their own parent + new siblings. The CONTEXT caution ("if their `files_modified` overlap they
  MUST run sequentially") is satisfied: **they do NOT overlap.** [VERIFIED: grep — discover.ts imports SourceFetchError from source-client.ts as a TYPE/VALUE, but does not EDIT source-client.ts]

- **One ordering caveat:** `discover.ts` imports `SourceFetchError` from `source-client.ts`. If
  SPLIT-03 relocates `SourceFetchError` into `source-client-error.ts` and re-exports it from the
  parent (as recommended), the import path in `discover.ts` (`from "./source-client.js"`) is
  unchanged — so no cross-edit, parallelism holds. Only if the planner chose to make `discover.ts`
  import directly from `source-client-error.js` would the two overlap and need sequencing. **Do not
  do that** — keep the re-export so the splits stay disjoint. [VERIFIED]

**Recommended wave structure:** one wave, four concurrent executors in isolated worktrees, merge
back per executor. Within SPLIT-01's worktree, the three sub-extractions run as sequential commits
(it is the highest-risk file). Each executor runs `verify` + golden oracle after every internal
extraction commit before merge-back.

## Per-Extraction Gate

Each extraction is a pure move and can be committed independently with the full gate green:

```bash
pnpm run verify   # format:check + lint + typecheck + test + test:coverage + build + depcruise + knip
```

Plus the golden oracle (part of the integration suite):

```bash
pnpm run test:integration   # includes src/run/golden-e2e.integration.test.ts + golden-watch
```

Sequence per file: move cluster N → re-export public symbols from parent if relocated → `verify` →
golden oracle → commit ("refactor(run): extract checkpoint helpers from run-once" etc.). Remove the
`oxlint-disable max-lines` line only on the FINAL extraction of each file, once the parent is
confirmed < 300 by `wc -l`. A dropped branch in `run-once.ts` is invisible to coverage (the moved
code is still executed) but the golden run-once oracle pins the exact run summary / checkpoint
sequence and will fail — hence the per-extraction oracle run is mandatory, not optional. [VERIFIED: ROADMAP behavior-preservation gate + CONTEXT]

## shared.ts Watch

`src/commands/shared.ts` is at **296/300 (zero headroom)**. No proposed move adds a line to it: all
four splits preserve public export paths, so `shared.ts`'s existing imports
(`discoverReplaysDryRun`, `createSourceClient`, `runOnce`, `createReplayByteClient`, `ReplayByteClient`)
resolve unchanged. **Confirmed: no Phase 22 move touches `src/commands/shared.ts`.** The planner MUST
verify `wc -l src/commands/shared.ts` is unchanged after each merge as a guard. [VERIFIED: grep + line count from CONTEXT]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Confirming a file is < 300 | eyeballing | `wc -l <file>` + remove suppression last | exact, scriptable gate |
| Confirming no behavior change | reasoning about branches | golden oracle (`test:integration`) after each move | coverage misses dropped-but-still-run branches |
| Confirming no new cross-band import | manual graph trace | `pnpm run depcruise` after each move | no-circular catches the error-class cycle automatically |
| Confirming no orphan/unused after move | manual check | `pnpm run knip` | catches a re-export that silently orphans a symbol |

## Common Pitfalls

### Pitfall 1: Removing the suppression before the parent is actually < 300
**What goes wrong:** suppression removed while parent still ≥ 300 → `lint` fails the commit.
**How to avoid:** remove `oxlint-disable max-lines` only on the FINAL extraction per file, after
`wc -l` confirms < 300. Each intermediate extraction keeps the suppression.

### Pitfall 2: Same-band circular import when relocating the error class (SPLIT-03 / SPLIT-04)
**What goes wrong:** moving error-builder helpers to a `*-error.ts` sibling that imports the
`*FetchError` class FROM the parent, while the parent imports the builders FROM the sibling →
`no-circular` (error severity) fails `depcruise`.
**How to avoid:** physically move `SourceFetchError` / `ReplayByteFetchError` INTO the `*-error.ts`
sibling and re-export from the parent (`export { SourceFetchError } from "./source-client-error.js"`).
Parent → sibling only; no back-edge. Keeps `discover.ts` / `contract-check.ts` import paths
unchanged.

### Pitfall 3: Co-splitting tests changes `files_modified` and can break parallel-disjointness
**What goes wrong:** if a split also re-homes its `.test.ts` into new test files, and two splits'
test reshuffles touch a shared test helper, the sets overlap.
**How to avoid:** Phase 22 is a SOURCE structural refactor — keep the existing `*.test.ts` files in
place (they import the same public surface). Do not split test files in this phase; the test-quality
pass is Phase 26. If a moved internal symbol was imported by a test directly (not through the public
export), repoint that test import — but that is a same-file edit within the split's own band.

### Pitfall 4: knip flags a re-exported symbol as unused
**What goes wrong:** after relocating `SourceFetchError` and re-exporting, knip may see the parent
re-export as unused if nothing imports it through the parent.
**How to avoid:** `discover.ts` and `contract-check.ts` DO import `SourceFetchError` from the
parent path, so the re-export is used. Run `knip` after the move to confirm; `ignoreExportsUsedInFile`
is already on, but cross-file re-exports still need a real importer (which exists). [VERIFIED: grep]

### Pitfall 5: Sibling still > 300 after one extraction
**What goes wrong:** `run-once-page.ts` (~330) and `discover-candidate.ts` (~310) may land over the
threshold themselves.
**How to avoid:** the proposals above flag both — split the rate/emit helpers out of the page
sibling, and the dedup/registry helpers out of the candidate sibling, into a third sibling. Re-measure
with `wc -l` before declaring the file done.

## Runtime State Inventory

This is a within-process source refactor with zero behavior, schema, key-layout, or external-state
change. No stored data, live-service config, OS-registered state, secret, or build artifact embeds
any moved symbol name (the public export paths are preserved; nothing external imports the internal
helper names).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB/S3 key or value references a moved symbol | none |
| Live service config | None — no external config references these modules | none |
| OS-registered state | None | none |
| Secrets/env vars | None — `SourceConfig` field names unchanged | none |
| Build artifacts | `dist/` is rebuilt by `pnpm run build` inside `verify`; tsdown re-emits from new file layout | covered by `verify` per extraction |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 + V8 coverage |
| Config file | `package.json` scripts (`vitest run`); coverage via `vitest run --coverage` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm run verify` (+ `pnpm run test:integration` for the Docker golden oracles) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SPLIT-01 | run-once orchestration unchanged | integration (golden) | `pnpm run test:integration` (golden-e2e) | ✅ `src/run/golden-e2e.integration.test.ts` |
| SPLIT-01 | run-once unit behavior unchanged | unit | `pnpm test` (run-once.test.ts) | ✅ `src/run/run-once.test.ts` |
| SPLIT-02 | discovery output unchanged | unit | `pnpm test` (discover.test.ts) | ✅ `src/discovery/discover.test.ts` |
| SPLIT-03 | source fetch/retry/error contract unchanged | unit | `pnpm test` (source-client.test.ts) | ✅ `src/discovery/source-client.test.ts` |
| SPLIT-04 | byte fetch/retry/error contract unchanged | unit | `pnpm test` (replay-byte-client.test.ts) | ✅ `src/storage/replay-byte-client.test.ts` |
| all | no behavior drift | integration (golden) | `pnpm run test:integration` | ✅ golden-e2e + golden-watch |
| all | 100% V8 coverage maintained | coverage | `pnpm run test:coverage` | ✅ |
| all | no new cross-band/circular import | depcruise | `pnpm run depcruise` | ✅ |
| all | no orphan/unused after move | knip | `pnpm run knip` | ✅ |

### Sampling Rate
- **Per task commit (each extraction):** `pnpm run verify` + `pnpm run test:integration`.
- **Per wave merge (per executor merge-back):** full `pnpm run verify` + `pnpm run test:integration`.
- **Phase gate:** all four suppressions removed, all parents < 300, full suite green before `/gsd-verify-work`.

### Wave 0 Gaps
None — existing unit + golden integration test infrastructure covers all four splits. No new test
files are required (structural moves are validated by the existing behavior oracles). Test files are
NOT split in this phase (see Pitfall 3).

## Security Domain

> No security-relevant surface changes. This is a pure structural move with zero behavior change.

The only security-adjacent code touched is `sanitizeSourceUrl` (run-once — strips userinfo, WR-02)
and the identifiers-only diagnostic/error builders (no body/secret copied, threat T-08-01 / DIAG-04).
These move verbatim with their guard comments; the golden oracle + existing unit tests pin their
behavior. No ASVS category changes scope.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | unchanged | existing Zod config + fixture validation (not modified) |
| V7 Error/Logging | unchanged | identifiers-only `details` allowlist moves verbatim |
| V6 Cryptography | no | n/a |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Post-extraction line estimates (~120/140/230/210 parents; ~330/310 hot siblings) | Per-File plans | If a sibling lands > 300, planner adds a third sibling (already flagged); low risk |
| A2 | `derivePagesPerMinute` re-exported from a summary sibling keeps its export site valid for knip | SPLIT-01 | knip might flag; mitigated by it being used in-file (`ignoreExportsUsedInFile`) — verify post-move |

**All other claims are VERIFIED against the live source read in full this session.**

## Open Questions

1. **Should `run/run-once-summary.ts` be a new file or folded into the existing `run/summary.ts`?**
   - What we know: `run/summary.ts` (15KB) already owns `buildRunSummary`/`deriveRunStatus`/etc.;
     run-once imports from it.
   - What's unclear: folding run-once's summary-side helpers into `summary.ts` could push `summary.ts`
     over 300.
   - Recommendation: NEW sibling `run-once-summary.ts` to avoid risking `summary.ts`'s budget; keep
     `summary.ts` untouched (it is not a Phase 22 target).

2. **Exact sibling count for `run-once.ts`.**
   - What we know: three clusters cleanly identified; the page-loop cluster is the heaviest.
   - Recommendation: start with 3 siblings; if `run-once-page.ts` > 300, promote the rate/emit
     helpers into the summary sibling (a 4th boundary). Planner re-measures with `wc -l`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| pnpm | all scripts | ✓ (project standard) | 11 | — |
| Docker | golden integration oracles (`test:integration`) | assumed ✓ (used by prior phases 19–21 gates) | — | run unit + coverage + depcruise + knip; flag if Docker absent |
| oxlint/oxfmt | lint/format in `verify` | ✓ (shared toolchain) | — | — |
| dependency-cruiser | depcruise | ✓ | 17.4.3 | — |
| knip | knip | ✓ | ^6.16.1 | — |

**Missing dependencies with no fallback:** none identified. **Missing with fallback:** if Docker is
unavailable on the executor, the golden integration oracle cannot run — in that case the planner must
gate merge-back on a machine where `test:integration` runs, since coverage alone is NOT the behavior
oracle (the explicit phase rule).

## Sources

### Primary (HIGH confidence)
- Full read of `src/run/run-once.ts`, `src/discovery/discover.ts`, `src/discovery/source-client.ts`,
  `src/storage/replay-byte-client.ts`, `src/discovery/types.ts`, `src/discovery/html.ts`,
  `src/run/types.ts`, `src/run/ingest-page.ts` — this session.
- `grep` of all importers of the four files + their public exports across `src/`.
- `.dependency-cruiser.cjs` (no-circular + no-orphans enforced now; eight band fences deferred to Phase 23).
- `solidstats-fetcher-ts-conventions` §A (five-band architecture; adapters stay in capability dir).
- `package.json` (`verify` script composition), `knip.jsonc` (`ignoreExportsUsedInFile`).
- `.planning/REQUIREMENTS.md` (SPLIT-01..04), `.planning/ROADMAP.md` (Phase 22 gate), `22-CONTEXT.md`.

## Metadata

**Confidence breakdown:**
- Extraction boundaries: HIGH — derived from the actual function/type clusters read in full.
- Parallel-safety verdict: HIGH — grounded in grep of every importer; the disjoint `files_modified`
  result is a hard fact.
- Circular-import hazard (error class relocation): HIGH — the one non-trivial graph detail, verified
  by import-direction analysis; mitigation is concrete.
- Line-count estimates: MEDIUM — approximate; planner re-measures with `wc -l` per move.

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (stable refactor target; invalidated only if the four files change before planning)
