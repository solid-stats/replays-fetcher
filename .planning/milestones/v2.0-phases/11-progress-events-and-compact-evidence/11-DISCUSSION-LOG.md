# Phase 11: Progress Events and Compact Evidence - Discussion Log (Assumptions Mode)

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the analysis.

**Date:** 2026-06-11
**Phase:** 11-progress-events-and-compact-evidence
**Mode:** assumptions
**Areas analyzed:** Event taxonomy & emission, Compact summary projection, Evidence artifact, Secret-safety & flush

## Assumptions Presented

### Event taxonomy & emission (PROG-01)
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Full taxonomy emitted from run-once via the injected `child({ runId })` logger (run_start/page_complete/page_failed/run_complete placement) | Confident | `run-once.ts` `RunOnceInput.log`, `emitPageRateLine` (~252), `assembleResult` (~571-608); `cli.ts:351` debug stub |
| `page_complete` reuses `derivePagesPerMinute`; payload = page `counts` + pagesPerMinute + candidatesPerMinute | Confident | `run-once.ts:319` single rate source; `MutablePageCounts` at `pages[page].counts` |
| `retry` already wired via `onRetry` seam; rename to `retry`; add `httpStatus` additively to `RetryAttemptEvent` | Likely | `cli.ts:412-418`, `retry.ts:24-30,111-131,183`; `httpStatus` absent today |

### Compact summary projection (PROG-02)
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Pure `toCompactSummary` in `summary.ts` strips arrays, keeps compact fields; full RunSummary stays in memory for evidence | Likely | `types.ts:46-69` field split; `summary.ts:77-109` builder; `run-once.ts:77-80` returns full summary |
| Stdout destination/summary shape (unified NDJSON vs events-stderr + compact-doc-stdout) | Unclear (load-bearing) | `create-logger.ts:57-61` default stderr; `cli.ts:347-350,395,693-695` writeJson |
| `cli.test.ts` stdout assertions + `docs/integration-contract.md` (51-69) must update — cross-app contract | Confident | `cli.ts:693-695` pretty JSON; `integration-contract.md:55,83-85` |

### Evidence artifact (PROG-03)
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| `createS3EvidenceStoreFromConfig` mirrors checkpoint store, no CAS, `s3.evidencePrefix` env default "runs" | Likely | `s3-checkpoint-store.ts:219-235`, `s3-raw-storage.ts:108-123`, `object-key.ts:28-46`, `config.ts:81-90` |
| Evidence-write failure = log-and-continue (warn), never fails run; body = full RunSummary | Likely | `s3-checkpoint-store.ts:16-19`; `run-once.ts:524-541,675-688`; `types.ts:47,61,66` |
| `--emit-evidence` (S3 bool) + `--evidence-file <path>` (local fs, dev-only) — independent commander flags | Likely | `cli.ts:334-341`, `--resume` at 337-340, `RunOnceOptions` 113-115; no `node:fs` usage yet |
| §AB retention: opt-in-only sufficient; bulk pruning → infra S3 lifecycle, no app pruning | Likely | `object-key.ts:9-11` checkpoint retention-by-construction contrast |

### Secret-safety & synchronous flush (PROG-04)
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Existing `redact` paths sufficient; all payloads identifiers-only; add no-secret/body unit test | Confident | `create-logger.ts:30-39`; `run-once.ts:343-349` userinfo strip; `types.ts:27-32` |
| Awaited `log.flush()` before `process.exitCode`; sync destination; no `process.exit()` | Likely | `pino/lib/proto.js:246-256`; `create-logger.ts:9,48-50,11-13`; no `process.exit()` in src |

## Corrections Made

### Stdout/stderr shape
- **Original assumption (recommended):** Unified NDJSON to stdout — move the run-once logger
  to stdout, emit all events + the final `run_complete`/`run_partial` (carrying the compact
  summary) as NDJSON lines, and remove the separate `writeJson` document.
- **User correction:** Events stream to **stderr** (greppable via `2>`); stdout carries
  **exactly one compact JSON document** (the projected summary). `writeJson` survives with a
  `toCompactSummary` input. Conventional CLI split chosen over unified-stdout-NDJSON.
- **Reason:** Preserve the phase-7 separation (stdout = the machine-readable result, `jq`-
  friendly; stderr = progress/diagnostics); PROG-01's intent (greppable per-page NDJSON, no
  multi-MB blob) is met on stderr.

No other corrections — all remaining assumptions were confirmed as-is ("write as is").

## External Research

None — pino 10.x `flush`/destination behavior was verified directly from installed
`node_modules/pino/lib/proto.js` and `src/logging/create-logger.ts`. One non-blocking
implementation-time confirmation noted for the planner: `pino.destination({ sync: true })` on
fd 1 vs a plain stream for the run-once destination (both flush synchronously).
