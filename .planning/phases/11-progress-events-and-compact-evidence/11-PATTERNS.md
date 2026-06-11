# Phase 11: Progress Events and Compact Evidence - Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 11 (new + modified)
**Analogs found:** 11 / 11

Backend-only TypeScript/Node CLI ingest service. No frontend. Every Phase 11 capability mirrors a verified in-repo precedent (checkpoint S3 store, Zod `s3.*Prefix` knob, commander `--resume` flag, pure summary builder, child pino logger). This is a re-wiring phase: reuse the exact existing pattern, do not invent a parallel mechanism.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/evidence/s3-evidence-store.ts` (new) | service/store | file-I/O (S3 PutObject) | `src/checkpoint/s3-checkpoint-store.ts` | exact (write-only subset) |
| `src/evidence/object-key.ts` (new) | utility | transform (pure key builder) | `src/checkpoint/object-key.ts` | exact |
| `src/evidence/s3-evidence-store.test.ts` (new) | test | — | `src/checkpoint/s3-checkpoint-store.test.ts` | exact |
| `src/evidence/s3-evidence-store.integration.test.ts` (new) | test | — | `src/checkpoint/s3-checkpoint-store.integration.test.ts` | exact |
| `src/evidence/object-key.test.ts` (new) | test | — | `src/checkpoint/object-key.test.ts` | exact |
| `src/run/summary.ts` (modify) | utility | transform (pure projection) | self (`buildRunSummary` + `withRunStatus`/`withRunMetrics`) | exact |
| `src/run/types.ts` (modify) | model | — | self (`RunSummary` interface) | exact |
| `src/run/run-once.ts` (modify) | controller/orchestrator | event-driven (NDJSON emit) + file-I/O | self (`emitPageRateLine`, checkpoint `try/catch -> warn`) | exact |
| `src/source/retry.ts` (modify) | utility | event-driven | self (`buildRetryEvent` additive spreads) | exact |
| `src/config.ts` (modify) | config | transform (Zod parse) | self (`checkpointPrefix` knob) | exact |
| `src/cli.ts` (modify) | controller/route | request-response (commander) | self (`--resume` option, `writeJson`, flush) | exact |
| `src/cli.test.ts` (modify, mandatory D-09) | test | — | self (run-once stdout assertions) | exact |
| `docs/integration-contract.md` (modify, mandatory D-09) | docs | — | self (§Scheduled Operation Contract) | exact |
| `README.md` / `.env.example` (modify) | docs/config | — | self (`S3_CHECKPOINT_PREFIX` docs) | exact |

## Pattern Assignments

### `src/evidence/s3-evidence-store.ts` (new — service/store, S3 file-I/O)

**Analog:** `src/checkpoint/s3-checkpoint-store.ts`

Mirror the **write half only** — strip the read path, the CAS loop, `mergeCheckpoints`, the `IfMatch`/`IfNoneMatch` conditional header, and the precondition retry. Evidence is **write-once per unique `runId`** (no concurrent writers → plain unconditional `PutObjectCommand`, D-10).

**Imports / sender seam** (`s3-checkpoint-store.ts:25-66`):
```typescript
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AppConfig } from "../config.js";

interface S3EvidenceSender {
  send(command: PutObjectCommand): Promise<{ readonly ETag?: string }>;
}
interface CreateS3EvidenceStoreOptions {
  readonly bucket: string;
  readonly prefix: string;
  readonly sender: S3EvidenceSender;
}
```

**Core put pattern** — strip CAS from `putCheckpoint` (`s3-checkpoint-store.ts:176-192`); body is the full in-memory `RunSummary` per D-12:
```typescript
async function putEvidence(options, input): Promise<void> {
  const key = toEvidenceObjectKey(options.prefix, input.runId);
  await options.sender.send(
    new PutObjectCommand({
      Body: JSON.stringify(input.summary), // full RunSummary (D-08/D-12)
      Bucket: options.bucket,
      ContentType: "application/json",
      Key: key,
      // NO conditionalHeader(...) — write-once, no CAS (D-10)
    }),
  );
}
```

**`FromConfig` factory** — copy verbatim from `createS3CheckpointStoreFromConfig` (`s3-checkpoint-store.ts:219-235`), swapping the prefix source to `config.evidencePrefix`:
```typescript
export function createS3EvidenceStoreFromConfig(config: AppConfig["s3"]): S3EvidenceStore {
  return createS3EvidenceStore({
    bucket: config.bucket,
    prefix: config.evidencePrefix, // new knob, default "runs" (D-11)
    sender: new S3Client({
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
    }),
  });
}
```

> Do NOT copy: `readCheckpoint`, `writeCheckpoint` CAS loop, `conditionalHeader`, `isPreconditionFailed`, `isNotFound`, `mergeCheckpoints`, `fullJitterDelay`, `CheckpointConflictError`. None applies to a write-once artifact.

---

### `src/evidence/object-key.ts` (new — utility, pure transform)

**Analog:** `src/checkpoint/object-key.ts`

Same validated-pure-builder shape, but key on the **`runId`** instead of the source-URL slug. CRITICAL (Pitfall 3): `createRunId` produces `run-<ISO8601>-<uuid>` whose ISO timestamp contains `:`, which is NOT in `[a-z0-9._/-]`. The helper must sanitize the `runId` exactly as `toSourceSlug` sanitizes the URL, or the validator throws.

**Pattern** (mirror `toCheckpointObjectKey` `object-key.ts:16-46` + `toSourceSlug` `object-key.ts:52-57`):
```typescript
const unsafeRunPattern = /[^a-z0-9._-]+/gu;       // from unsafeSlugRunPattern
const leadingTrailingDashPattern = /^-+|-+$/gu;
const s3SafeKeyPattern = /^[a-z0-9._/-]+$/u;

export function toEvidenceObjectKey(prefix: string, runId: string): string {
  if (prefix.length === 0) throw new Error("Evidence object-key prefix must not be empty");
  const safeRunId = runId.toLowerCase()
    .replaceAll(unsafeRunPattern, "-")
    .replaceAll(leadingTrailingDashPattern, "");
  if (safeRunId.length === 0) throw new Error("Evidence runId slug must not be empty");
  const key = `${prefix}/${safeRunId}/evidence.json`;
  if (!s3SafeKeyPattern.test(key)) {
    throw new Error("Evidence object key must match the S3-safe pattern [a-z0-9._/-]");
  }
  return key;
}
```

**Test must assert** (Pitfall 3): a colon-bearing `runId` (e.g. `run-2026-06-11T13:27:38.774Z-<uuid>`) produces a valid `[a-z0-9._/-]` key.

---

### `src/run/summary.ts` (modify — utility, pure projection)

**Analog:** self — `buildRunSummary` (`summary.ts:77-109`) stays **unchanged** (D-08, still assembles the full `RunSummary` returned via `RunOnceResult`). Add a new pure `toCompactSummary` colocated here.

**Critical idiom — additive conditional spread (Pitfall 5, `exactOptionalPropertyTypes`):** copy `withRunStatus` (`summary.ts:117-132`) / `withRunMetrics` (`summary.ts:141-169`). Optional fields are OMITTED, never assigned `undefined`:
```typescript
export function toCompactSummary(summary: RunSummary): CompactRunSummary {
  let compact: CompactRunSummary = {
    counts: summary.counts,
    failureCategories: summary.failureCategories,
    finishedAt: summary.finishedAt,
    mode: summary.mode,
    ok: summary.ok,
    runId: summary.runId,
    startedAt: summary.startedAt,
  };
  if (summary.discoveredRange !== undefined) compact = { ...compact, discoveredRange: summary.discoveredRange };
  if (summary.sourceUrl !== undefined) compact = { ...compact, sourceUrl: summary.sourceUrl };
  if (summary.status !== undefined) compact = { ...compact, status: summary.status };
  if (summary.sourceFailure !== undefined) compact = { ...compact, sourceFailure: summary.sourceFailure };
  if (summary.resumeInvocation !== undefined) compact = { ...compact, resumeInvocation: summary.resumeInvocation };
  return compact;
}
```
Strips: `candidates`, `rawStorage`, `staging`, `diagnostics` (D-07). Keeps scalars + the five optionals.

---

### `src/run/types.ts` (modify — model)

**Analog:** self — `RunSummary` (`types.ts:46-69`). Add `CompactRunSummary` reusing `RunSummaryCounts`, `RunStatus`, `RunSourceFailure`, and the inline `discoveredRange` shape already defined on `RunSummary`. All `?:` fields stay optional (exact-optional). (Colocating the interface in `summary.ts` is equally acceptable per discretion.)

---

### `src/run/run-once.ts` (modify — orchestrator, NDJSON event-driven + opt-in file-I/O)

**Analog:** self.

**Event emission (D-03/D-04)** — the events reuse the injected `input.log` child logger; structured object + static message, identifiers-only, never string-interpolated:
- `run_start` (info): replace the `log.debug` stub at the top of `runOnce` (analog: the `input.log?.info(...)` calls at `run-once.ts:467/473`).
- `page_complete` (info): **upgrade `emitPageRateLine` in place** (`run-once.ts:299-308`). Reuse `derivePagesPerMinute` (the single rate source, `run-once.ts:319-331`); payload = the already-computed `MutablePageCounts` + `pagesPerMinute` + `candidatesPerMinute`:
```typescript
input.log?.info(
  { event: "page_complete", page, counts: pageCounts, pagesPerMinute, candidatesPerMinute },
  "page complete",
);
```
- `page_failed` / `source_unavailable` (error): on the `!pageReport.ok` break path (`run-once.ts:144-147`), reuse `deriveSourceFailure(pageReport)` (`summary.ts:280`) for identifiers-only failure fields.
- `run_complete` (info) / `run_partial` (warn): in `assembleResult` once `status` is derived (`run-once.ts:577`), driven by the existing `deriveRunStatus`.

**Evidence write — log-and-continue (D-12):** mirror the checkpoint `try/catch -> input.log?.warn(...)` exactly (`writePageCheckpoint` `run-once.ts:524-542` and `writeFinalCheckpoint` `run-once.ts:675-689`). An evidence-write failure NEVER fails the run or changes the exit code.

**Discriminator field:** use a dedicated `event: "<name>"` field (greppable as `grep '"event":"page_complete"'`) plus a static human `msg`.

**Source-URL safety:** `sanitizeSourceUrl` (`run-once.ts:343-349`) already strips userinfo before any durable surface — keep using the sanitized slug in events/evidence.

---

### `src/source/retry.ts` (modify — utility, event seam)

**Analog:** self — `buildRetryEvent` (`retry.ts:111-131`). Additively thread `httpStatus` (Pitfall 4). `RetryAttemptEvent` (`retry.ts:24-30`) currently has `attempt`/`causeCode`/`delayMs`/`page`/`phase` but NOT `httpStatus`; `FailureClassification.httpStatus` exists (`classify-failure.ts:24`). Same conditional-spread idiom already used for `page`/`causeCode`:
```typescript
// in RetryAttemptEvent: add `readonly httpStatus?: number;`
if (classification.httpStatus !== undefined) {
  event = { ...event, httpStatus: classification.httpStatus };
}
```
Backward-compatible (optional, additive). Do NOT read a `Response` for the status — the classifier already carries it.

---

### `src/config.ts` (modify — config, Zod knob)

**Analog:** self — `checkpointPrefix` (`config.ts:89` in the `s3` object + `config.ts:137` env mapping). Add the mirror knob:
```typescript
// in configSchema.s3 (config.ts:89):
evidencePrefix: z.string().min(1).default("runs"),
// in loadConfig() s3 input mapping (config.ts:137):
evidencePrefix: source["S3_EVIDENCE_PREFIX"],
```

---

### `src/cli.ts` (modify — controller, commander request-response)

**Analog:** self — `registerRunOnceCommand` (`cli.ts:330-398`), `--resume` is the exact flag precedent.

**Flags (D-13)** — independent, not mutually exclusive (mirror `--resume` `cli.ts:337-340`):
```typescript
.option("--emit-evidence", "write a durable per-candidate evidence artifact to S3")
.option("--evidence-file <path>", "also write the evidence artifact to a local file (dev only)")
```
Extend `RunOnceOptions` (`cli.ts:113-115`): add `readonly emitEvidence?: boolean;` and `readonly evidenceFile?: string;`. Thread through `RunOnceInput` like `resume: options.resume === true` (`cli.ts:382`). Build the evidence store from config alongside `createS3CheckpointStoreFromConfig(config.s3)` (`cli.ts:540`); inject it as a `BuildCliDependencies` factory mirroring `createS3CheckpointStoreFromConfig` (`cli.ts:86`).

**Compact projection at the stdout boundary (D-02):** swap the single `writeJson(result.summary)` (`cli.ts:395`) to `writeJson(toCompactSummary(result.summary))`. Stdout stays exactly one compact JSON document. Events go to stderr via `log`.

**Awaited flush before exit (D-16, Pitfall 7):** own the flush in the cli action (single owner — it owns `rootLogger` and the `process.exitCode` write `cli.ts:344/396`), AFTER `writeJson(compact)` and BEFORE `process.exitCode`. Never `process.exit()`:
```typescript
async function flushLogger(log: Logger): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    log.flush((error) => (error ? reject(error) : resolve()));
  });
}
// ...
writeJson(toCompactSummary(result.summary));
await flushLogger(rootLogger);
process.exitCode = result.exitCode;
```
Flush exactly once; flushing the root logger drains child output (shared destination — assert in a test, Assumption A3).

---

### `src/cli.test.ts` (modify — MANDATORY, D-09)

**Analog:** self. UPDATE the run-once stdout assertions: stdout is now the **compact** document (no `candidates`/`rawStorage`/`staging`/`diagnostics` arrays). Phase 7's byte-stable stdout invariant is intentionally broken here (Pitfall 1). Add tests for the `--emit-evidence`/`--evidence-file` matrix (both/either/neither, D-13), the evidence-write-failure → warn path, and the awaited-flush-before-exit ordering.

---

### `docs/integration-contract.md` (modify — MANDATORY, D-09)

**Analog:** self — §Scheduled Operation Contract. Update the "exactly one JSON run summary to stdout" statement + field enumeration: stdout = compact `CompactRunSummary`; per-page NDJSON progress on stderr; heavy per-candidate arrays moved to the opt-in S3 `runs/<runId>/evidence.json` artifact. Operator-/`server-2`-visible contract change.

---

### `README.md` / `.env.example` (modify — docs)

Document `S3_EVIDENCE_PREFIX` (default `runs`), `--emit-evidence`, `--evidence-file`, and the infra-owned S3 lifecycle retention note (D-14). Mirror the existing `S3_CHECKPOINT_PREFIX` documentation.

## Shared Patterns

### Structured pino event (identifiers-only, discriminator field)
**Source:** `src/cli.ts:412-418` (`buildRetryWarnEmitter`) + `src/run/run-once.ts:304-308` (`emitPageRateLine`)
**Apply to:** every Phase 11 event in `run-once.ts`
```typescript
log.warn(event, "source read retry"); // structured object, static message, NO interpolation
```
Levels carry meaning (§Z): info = milestone, warn = unexpected-but-handled, error = failure. Never put server/source data in the message string.

### `create*FromConfig` + injectable `sender` seam
**Source:** `src/checkpoint/s3-checkpoint-store.ts:219-235`
**Apply to:** the evidence store. Unit tests inject a fake `sender`; a MinIO integration test mirrors `s3-checkpoint-store.integration.test.ts`.

### Optional-artifact write = log-and-continue
**Source:** `src/run/run-once.ts:524-542` (checkpoint `try/catch -> input.log?.warn`)
**Apply to:** the evidence S3 write and the dev-only `--evidence-file` write. Never fails the run; exit code unchanged (D-12).

### Additive conditional spread (exactOptionalPropertyTypes)
**Source:** `src/run/summary.ts:117-169` (`withRunStatus`/`withRunMetrics`), `src/source/retry.ts:122-130` (`buildRetryEvent`)
**Apply to:** `toCompactSummary`, the new `httpStatus` retry field, every new optional payload. Omit absent optionals — never assign `undefined`.

### Zod env knob + redaction
**Source:** `src/config.ts:89/137` (`checkpointPrefix` + `S3_CHECKPOINT_PREFIX`)
**Apply to:** `evidencePrefix` / `S3_EVIDENCE_PREFIX`. `evidencePrefix` carries no secret, so no `redactConfig` change is needed; `REDACT_PATHS` in `create-logger.ts:30-39` already cover every logged secret shape (D-15 — `create-logger.ts` unchanged).

### Secret/boundary safety
**Source:** `src/logging/create-logger.ts:30-64` (`REDACT_PATHS`, stderr default) + `src/run/run-once.ts:343-349` (`sanitizeSourceUrl`)
**Apply to:** all events, the compact summary, and the evidence payload. A no-leak unit test (mirror DIAG-04) asserts no secret/body/HTML string appears in any of the three surfaces (PROG-04).

## No Analog Found

None. Every file maps to an exact or self analog.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | — |

## Metadata

**Analog search scope:** `src/checkpoint/`, `src/run/`, `src/source/`, `src/storage/`, `src/logging/`, `src/cli.ts`, `src/config.ts`
**Files scanned:** 9 source files read in full or in targeted ranges
**Pattern extraction date:** 2026-06-11
