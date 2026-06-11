# Phase 11: Progress Events and Compact Evidence - Research

**Researched:** 2026-06-11
**Domain:** CLI observability — structured pino NDJSON progress events, a compact stdout summary projection, an opt-in S3 evidence artifact, and a synchronous flush-before-exit guarantee (TypeScript/Node scheduled-job ingest service)
**Confidence:** HIGH

## Summary

Phase 11 reshapes how `run-once` reports progress. It promotes the phase-7/phase-10 placeholder
`log.debug`/`emitPageRateLine` events to real levels (`run_start`, `page_complete`, `retry`,
`page_failed`/`source_unavailable`, `run_complete`/`run_partial`), emitted as greppable pino NDJSON
on **stderr**; reduces the **stdout** document to a compact `CompactRunSummary` (run id, timestamps,
source url, discovered range, aggregate counts, failure categories, status, resume command); and
moves the heavy per-candidate arrays (`candidates`/`rawStorage`/`staging`/`diagnostics`) into an
opt-in durable S3 artifact at `runs/<runId>/evidence.json`. PROG-04 adds an awaited `log.flush()`
before exit and re-asserts secret-/boundary-safety.

This is an **almost entirely internal-refactor phase** that reuses existing, well-factored seams:
the injected `child({ runId })` pino logger (Phase 7), the `create*FromConfig` + injectable-`sender`
S3 store pattern (Phase 9 checkpoint / Phase 3 raw storage), the Zod `s3.*Prefix` env-knob pattern
(Phase 9 `checkpointPrefix`), commander `.option()` flags (the `--resume` precedent), and the pure
`buildRunSummary` builder. No new external library is required. The single new third-party touch is
`node:fs` (the dev-only `--evidence-file`). The CONTEXT.md decisions (D-01..D-16) are tightly aligned
with the actual code; this research **verified each anchor file** and found no contradictions, only a
small confirmation about the D-06 `httpStatus` seam (see Pitfall 4).

**Primary recommendation:** Mirror the existing checkpoint store/object-key/config patterns exactly
for the evidence artifact; keep the projection (`toCompactSummary`) and the evidence body (full
`RunSummary`) as pure functions in `src/run/summary.ts`; route every event through the existing
`input.log` child logger on stderr; and implement PROG-04 as an awaited `flush()` Promise wrapper —
no `process.exit()`. Do **not** add a new package, a transport/worker, prom-client, or an HTTP server.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-page/lifecycle progress events (NDJSON) | CLI run orchestration (`src/run/run-once.ts`) | Logging factory (`src/logging/create-logger.ts`) | Events are emitted from the orchestrator that owns the page loop and the injected `child({ runId })` logger; the factory owns redaction + the stderr destination. |
| Compact stdout summary projection | Pure summary builder (`src/run/summary.ts`) | CLI print boundary (`src/cli.ts` `writeJson`) | Projection is a pure transform of the in-memory `RunSummary`; the CLI applies it only at the single stdout write. |
| Opt-in evidence artifact write | Storage adapter (`src/storage/` or `src/run/` evidence store) | S3 (durable object) | Write-once durable object keyed by `runId`; mirrors the checkpoint S3 store's `FromConfig`+`sender` seam. |
| Dev-only local evidence file | CLI / run orchestration (`node:fs`) | Local disk | First local-disk write in the project; operator owns cleanup; never a default path. |
| Secret/boundary redaction | Logging factory `redact` + identifiers-only discipline | — | Existing `REDACT_PATHS` + the "log identifiers only" rule already cover every Phase 11 payload shape. |
| Flush-before-exit | CLI / run orchestration | pino destination (`sync: true`) | Awaited `flush()` Promise before `process.exitCode` is set; no `process.exit()`. |

**Tier-correctness note for the planner:** All Phase 11 capabilities live in the **CLI / run-orchestration
tier** of this single-process scheduled job. There is no browser, frontend-server, API, or database tier
involved. Any task that proposes an HTTP server, prom-client metrics endpoint, Fastify, or a `server-2`
table write is a tier violation and out of scope (see CONTEXT.md "Out of scope" and the integration contract).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Stdout/stderr shape (operator decision — load-bearing):**
- **D-01:** Progress events stream to **stderr** as NDJSON via the run-once `child({ runId })` logger;
  **stdout carries exactly one compact JSON document** (the projected summary). Conventional CLI split
  (result → stdout, progress → stderr), chosen over a unified stdout-NDJSON stream. PROG-01's literal
  "events to stdout" wording is satisfied in **intent** — greppable per-page NDJSON, no multi-MB blob —
  routed to stderr; PROG-02's compact stdout summary is the single stdout document.
- **D-02:** The existing `writeJson(...)` stdout write in `cli.ts` **survives**, but its input becomes
  `toCompactSummary(summary)` rather than the full `RunSummary`. Full lifecycle events (incl.
  `run_complete`/`run_partial`) are still emitted on stderr; the compact document is the machine-readable
  result on stdout.

**Event taxonomy & emission (PROG-01):**
- **D-03:** All events emitted from `src/run/run-once.ts` (not `cli.ts`), reusing the injected
  `child({ runId })` logger: `run_start` (info) at the top of `runOnce` (replacing the current
  `log.debug` stub); `page_complete` (info) replacing `emitPageRateLine`; `page_failed`/`source_unavailable`
  (error) on the `!pageReport.ok` break path; `run_complete` (info) / `run_partial` (warn) in
  `assembleResult` once `status` is derived.
- **D-04:** Each event carries a stable `event:<name>` discriminator field and structured, identifiers-only
  payload (`runId`/`page`/`counts`/...), never string concatenation. Levels: info = milestone, warn =
  unexpected-but-handled, error = failure.
- **D-05:** `page_complete` reuses `derivePagesPerMinute` (the single rate source); its payload is the page
  `counts` (`MutablePageCounts`) plus `pagesPerMinute` and `candidatesPerMinute`. The phase-10 per-page rate
  line is upgraded in place, not duplicated.
- **D-06:** `retry` (warn) reuses the existing `buildRetryWarnEmitter → onRetry → withRetry` seam; only the
  message/event name is set to `retry`. To satisfy PROG-01's "attempt/httpStatus/causeCode", `httpStatus` is
  added **additively** to `RetryAttemptEvent` / `buildRetryEvent` from the classifier (a small,
  backward-compatible phase-8 seam change); `causeCode` and `attempt` already exist.

**Compact summary projection (PROG-02):**
- **D-07:** A new **pure** `toCompactSummary(summary): CompactRunSummary` lives in `src/run/summary.ts`. It
  strips `candidates`, `rawStorage`, `staging`, and `diagnostics`, keeping `runId`, `startedAt`/`finishedAt`,
  `sourceUrl`, `discoveredRange`, `counts`, `failureCategories`, `status`, `sourceFailure`, and
  `resumeInvocation` (when resumable).
- **D-08:** `buildRunSummary` is unchanged and still assembles the **full** `RunSummary` in memory (returned
  in `RunOnceResult`), so the evidence artifact can serialize the full object; projection happens only at the
  stdout print boundary.
- **D-09:** `docs/integration-contract.md` (§Scheduled Operation Contract) and the run-once stdout assertions
  in `cli.test.ts` **must** be updated — operator-facing, cross-app-visible contract change; mandatory,
  in-scope work, not optional.

**Evidence artifact (PROG-03):**
- **D-10:** `runs/<runId>/evidence.json` written by a new `createS3EvidenceStoreFromConfig` mirroring
  `createS3CheckpointStoreFromConfig` — injectable `sender` seam, a plain unconditional `PutObjectCommand`
  (**no CAS**; write-once per unique `runId`), and a pure object-key helper mirroring `toCheckpointObjectKey`.
- **D-11:** Prefix is a new operator-configurable Zod knob `s3.evidencePrefix` (env `S3_EVIDENCE_PREFIX`,
  default `"runs"`), mirroring `checkpointPrefix`, sharing the existing bucket.
- **D-12:** Evidence-write failure is **log-and-continue (warn)** — never fails the run or changes the exit
  code (mirrors the checkpoint try/catch → warn pattern). Body is the full in-memory `RunSummary`, serialized
  with `JSON.stringify`.
- **D-13:** `--emit-evidence` (boolean, S3) and `--evidence-file <path>` (string, local `node:fs` write,
  **dev-only**) are **independent** commander `.option()` flags on run-once (mirroring `--resume`), surfaced
  via `RunOnceOptions` and threaded into `RunOnceInput`. Not mutually exclusive (both/either/neither).
  `--evidence-file` introduces the first local-disk write; the operator owns its cleanup.
- **D-14:** Retention (§AB): the opt-in-only write is sufficient control. Bulk pruning of `runs/` is delegated
  to **infra-owned S3 lifecycle rules** (documented), not app-side pruning — deliberately contrasting the
  checkpoint's single-rolling-object design, keeping the fetcher narrow.

**Secret-safety & synchronous flush (PROG-04):**
- **D-15:** Existing `redact` paths in `create-logger.ts` are sufficient; every Phase 11 payload is
  identifiers-only and `sourceUrl` is already userinfo-stripped. A unit test asserts no secret/body/HTML
  string appears in any event, the compact summary, or the evidence payload (mirroring the DIAG-04 no-body test).
- **D-16:** Flush-before-exit is an **awaited `log.flush()`** (callback wrapped in a Promise) at the end of
  `runOnce`/cli before `process.exitCode` is set. `process.exit()` is not used (streams drain naturally); the
  awaited flush is the explicit PROG-04 guarantee. Production destination uses pino's synchronous mode
  (`pino.destination({ sync: true })`), consistent with the factory's documented posture.

### Claude's Discretion

- Exact module layout for the evidence store and the compact projection, the precise `CompactRunSummary`
  field names, the event-discriminator field name (`event` vs reusing the pino `msg`), and the internal DI
  seams — at Claude's discretion, consistent with existing conventions (Zod env config,
  `create*FromConfig` + injectable sender/clock, identifiers-only evidence, colocated tests, 100% V8 coverage).

### Deferred Ideas (OUT OF SCOPE)

- App-side evidence retention/pruning — delegated to infra-owned S3 lifecycle rules, not built in the fetcher.
- Source contract fixtures and the no-write `contract-check` command — **Phase 12 (Source Contract Guards)**.
- prom-client metrics, an HTTP server, Fastify — `server-2`-only; never in this CLI.
- Parsing, parser artifacts, `server-2` business tables, staging schema, raw object key layout — product
  boundary unchanged.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROG-01 | Compact per-page/batch progress events as pino NDJSON (child logger keyed by `runId`): `run_start`, `page_complete` (counts+rates), `retry` (warn, attempt/httpStatus/causeCode), `page_failed`/`source_unavailable` (error), `run_complete`/`run_partial` — one line per page, greppable. | Existing `input.log` child logger threads through `runOnce`; `emitPageRateLine`/`derivePagesPerMinute` is the upgrade-in-place site for `page_complete`; `deriveSourceFailure` already classifies the `!ok` break for `page_failed`/`source_unavailable`; `deriveRunStatus` already derives `complete`/`partial` for `run_complete`/`run_partial`; `httpStatus` exists on `FailureClassification` and only needs additive threading into `RetryAttemptEvent` (Pitfall 4). |
| PROG-02 | Final stdout summary reduced to run id, timestamps, source url, discovered range, aggregate counts, failure categories, `status`, and (when resumable) the next command; full `candidates`/`rawStorage`/`staging` arrays absent from stdout. | Pure `toCompactSummary` added to `src/run/summary.ts`; `buildRunSummary` unchanged; `writeJson` input swapped at the single `cli.ts` stdout boundary; all kept fields already exist on `RunSummary` (`runId`, `startedAt`, `finishedAt`, `sourceUrl`, `discoveredRange`, `counts`, `failureCategories`, `status`, `sourceFailure`, `resumeInvocation`). |
| PROG-03 | Detailed per-candidate evidence written only to an opt-in durable artifact — S3 `runs/<runId>/evidence.json` when enabled, with a local file as a dev-only convenience — never to stdout by default. | `createS3EvidenceStoreFromConfig` mirrors `createS3CheckpointStoreFromConfig` (plain `PutObjectCommand`, no CAS); `toEvidenceObjectKey` mirrors `toCheckpointObjectKey`; `s3.evidencePrefix` Zod knob mirrors `checkpointPrefix`; `--emit-evidence`/`--evidence-file` mirror the `--resume` commander flag; body is the full in-memory `RunSummary` (returned by `buildRunSummary` per D-08). |
| PROG-04 | Events, summary, and artifact preserve secret-/boundary-safety: pino `redact`, no raw bytes/HTML, synchronous/awaited flush before exit, no new write surfaces beyond raw+staging+checkpoint+opt-in-artifact. | `REDACT_PATHS` in `create-logger.ts` + identifiers-only discipline cover all payloads; `sanitizeSourceUrl` already strips userinfo; pino 10.3.1 supports `flush(cb)` + `destination({ sync: true })` (verified); awaited-flush Promise wrapper before `process.exitCode`; the evidence object is the only new write surface and it is opt-in. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pino` | 10.3.1 (installed) | NDJSON structured progress events + `flush(cb)` + `destination({ sync: true })` | Already the project logging substrate (CORE-02, Phase 7); the factory is flush-ready by design. [VERIFIED: `require('pino/package.json').version` → 10.3.1] |
| `commander` | 14.0.3 (installed) | `--emit-evidence` / `--evidence-file <path>` run-once flags | Already the CLI parser; `--resume` is the exact precedent. [VERIFIED: package.json] |
| `@aws-sdk/client-s3` | installed | `PutObjectCommand` for the evidence artifact | Already used by the checkpoint + raw storage stores; the evidence store mirrors them. [VERIFIED: imported in `s3-checkpoint-store.ts` / `s3-raw-storage.ts`] |
| `zod` | installed (v4 API: `z.url()`, `z.coerce.number()`) | `s3.evidencePrefix` env knob | Already the config validator; `checkpointPrefix` is the exact pattern to mirror. [VERIFIED: `src/config.ts`] |
| `node:fs` | Node 24 stdlib | Dev-only `--evidence-file` local write | First local-disk write in the project; stdlib, no dependency. [CITED: CONTEXT.md D-13] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` `randomUUID` | stdlib | `runId` generation | Already used in `cli.ts createRunId`; unchanged this phase. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pino NDJSON on stderr | A unified stdout NDJSON stream | Operator explicitly rejected (D-01/Specifics): a unified stream loses the "stdout = result, stderr = diagnostics" split that `jq`/cron tooling relies on. |
| Awaited `flush()` Promise | `process.exit()` after writes | `process.exit()` truncates buffered streams; the factory deliberately avoids it (`create-logger.ts` WR-05 note). Awaited flush is the verified PROG-04 guarantee. |
| App-side `runs/` pruning | infra S3 lifecycle rules | App-side pruning expands the fetcher's responsibility surface; D-14 delegates to infra (documented). |

**Installation:** None required — no new package is added in this phase. (`pino`, `commander`,
`@aws-sdk/client-s3`, `zod` are already dependencies; `node:fs`/`node:crypto` are stdlib.)

## Package Legitimacy Audit

> No external package is installed in this phase. All capabilities use already-installed dependencies
> (verified present in `package.json` / `node_modules`) plus Node stdlib. No legitimacy gate applies.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none — no new installs) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                         run-once CLI action (cli.ts)
                                  │
                  createLogger().child({ runId })  ──────────────► stderr (NDJSON)
                                  │                                  ▲  ▲  ▲  ▲
                                  ▼                                  │  │  │  │
                          runOnce(input)  ── emits ─────────────────┘  │  │  │
   ┌──────────────────────────────────────────────────────────┐       │  │  │
   │  run_start (info) ───────────────────────────────────────────────┘  │  │
   │  for each page:                                            │          │  │
   │    discoverReplays → pageReport                            │          │  │
   │    if !ok: page_failed / source_unavailable (error) ──────────────────┘  │
   │    else:  processPage (store→stage fan-out, allSettled)    │             │
   │           page_complete (info, counts+rates) ────────────────────────────┘
   │    writePageCheckpoint  (existing — checkpoints/<slug>/latest.json, CAS)
   │  assembleResult:                                           │
   │    deriveRunStatus → status                               │
   │    run_complete (info) / run_partial (warn)  ── stderr     │
   │    buildRunSummary → FULL RunSummary (in memory) ──────────┼──────► RunOnceResult.summary
   └──────────────────────────────────────────────────────────┘             │
                                  │                                          │
              ┌───────────────────┼──────────────────────────────┐          │
              ▼                   ▼                               ▼          │
   toCompactSummary(summary)   evidence store (opt-in)     evidence file (opt-in, dev)
              │              --emit-evidence                --evidence-file <path>
              ▼              S3 PutObject                    node:fs write
   writeJson(compact) ──► stdout    runs/<runId>/evidence.json
   (exactly one JSON document)      (full RunSummary body)
                                  │
                          await log.flush()  ──► process.exitCode = runExitCode(summary)
```

Data flow: one `run-once` invocation produces (a) a stream of NDJSON lifecycle events on **stderr**,
(b) exactly one compact JSON document on **stdout**, and (c) optionally one full-evidence object in S3
and/or one local file. The full `RunSummary` is assembled once in memory and feeds all three outputs;
projection to compact happens only at the stdout boundary.

### Component Responsibilities

| File | Responsibility (this phase) |
|------|------------------------------|
| `src/run/run-once.ts` | Emit `run_start`/`page_complete`/`page_failed`/`source_unavailable`/`run_complete`/`run_partial`; call the evidence store/file writer (log-and-continue); await flush if flush is owned here (or in cli — discretion). |
| `src/run/summary.ts` | New pure `toCompactSummary` + `CompactRunSummary` type; `buildRunSummary` unchanged. |
| `src/run/types.ts` | New `CompactRunSummary` interface (or colocate in summary.ts — discretion). |
| `src/cli.ts` | Swap `writeJson(result.summary)` → `writeJson(toCompactSummary(result.summary))`; add `--emit-evidence`/`--evidence-file` options + `RunOnceOptions`; thread into `RunOnceInput`; build evidence store from config; awaited flush before `process.exitCode`. |
| `src/storage/` (or `src/run/`) evidence store | New `createS3EvidenceStore` + `createS3EvidenceStoreFromConfig` + `toEvidenceObjectKey` (plain PutObject, no CAS). |
| `src/config.ts` | Add `s3.evidencePrefix` Zod knob + `S3_EVIDENCE_PREFIX` env mapping. |
| `src/source/retry.ts` | Additively thread `httpStatus` from `FailureClassification` into `RetryAttemptEvent`/`buildRetryEvent` (Pitfall 4). |
| `src/logging/create-logger.ts` | Unchanged (redact paths already sufficient — D-15). |
| `docs/integration-contract.md` | Update §Scheduled Operation Contract for the stdout/stderr split + the opt-in evidence artifact (D-09). |
| `README.md` / `.env.example` | Document `S3_EVIDENCE_PREFIX`, `--emit-evidence`, `--evidence-file`. |

### Pattern 1: Mirror the checkpoint S3 store for the evidence store (plain PutObject, no CAS)

**What:** A `createS3EvidenceStore({ bucket, prefix, sender })` + `createS3EvidenceStoreFromConfig(config.s3)`
factory and a pure `toEvidenceObjectKey(prefix, runId)` helper. Unlike the checkpoint store, evidence is
**write-once per unique `runId`** — there are no concurrent writers to the same key — so it uses a plain
unconditional `PutObjectCommand` with **no** `IfMatch`/`IfNoneMatch`, no CAS loop, and no merge.

**When to use:** PROG-03 evidence write.

**Example (mirror this shape — checkpoint store is the verified reference):**
```typescript
// Source: src/checkpoint/s3-checkpoint-store.ts (VERIFIED — putCheckpoint + createS3CheckpointStoreFromConfig)
async function putEvidence(options, input): Promise<void> {
  const key = toEvidenceObjectKey(options.prefix, input.runId);
  await options.sender.send(
    new PutObjectCommand({
      Body: JSON.stringify(input.summary), // full in-memory RunSummary (D-12)
      Bucket: options.bucket,
      ContentType: "application/json",
      Key: key,
      // NO conditionalHeader(...) — write-once, no CAS (D-10)
    }),
  );
}

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

### Pattern 2: Object-key helper mirroring `toCheckpointObjectKey`

**What:** A pure, side-effect-free key builder that validates against the S3-safe pattern and throws on
invalid input. Checkpoint keys on `host+pathname` slug; evidence keys on `runId`. The existing `runId`
shape is `run-<ISO8601>-<uuid>` (from `createRunId`) which contains `:` characters from the ISO timestamp —
**these are not in the `[a-z0-9._/-]` S3-safe set used by `toCheckpointObjectKey`**, so the evidence key
helper must sanitize/replace them (e.g. replace unsafe runs with `-`) exactly as the checkpoint slug helper
does, or the key validator will throw. See Pitfall 3.

**Example:**
```typescript
// Source: src/checkpoint/object-key.ts (VERIFIED — toCheckpointObjectKey validates [a-z0-9._/-])
const s3SafeKeyPattern = /^[a-z0-9._/-]+$/u;
const unsafeRunPattern = /[^a-z0-9._-]+/gu;

export function toEvidenceObjectKey(prefix: string, runId: string): string {
  if (prefix.length === 0) throw new Error("Evidence object-key prefix must not be empty");
  const safeRunId = runId.toLowerCase().replaceAll(unsafeRunPattern, "-").replace(/^-+|-+$/gu, "");
  if (safeRunId.length === 0) throw new Error("Evidence runId slug must not be empty");
  const key = `${prefix}/${safeRunId}/evidence.json`;
  if (!s3SafeKeyPattern.test(key)) throw new Error("Evidence object key must match [a-z0-9._/-]");
  return key;
}
```

### Pattern 3: Pure projection at the stdout boundary

**What:** `toCompactSummary(summary): CompactRunSummary` strips the four heavy arrays and keeps scalars.
It is pure (no I/O), colocated in `summary.ts`, and applied **only** at `cli.ts`'s `writeJson`. The full
`RunSummary` continues to flow through `RunOnceResult.summary` to feed the evidence artifact (D-08).

**Example:**
```typescript
// Source: src/run/summary.ts shape (VERIFIED — RunSummary fields) + src/run/types.ts (RunSummary interface)
export interface CompactRunSummary {
  readonly counts: RunSummaryCounts;
  readonly discoveredRange?: { readonly firstPage: number; readonly lastPage: number };
  readonly failureCategories: readonly RunFailureCategory[];
  readonly finishedAt: string;
  readonly mode: "run-once";
  readonly ok: boolean;
  readonly resumeInvocation?: string;
  readonly runId: string;
  readonly sourceFailure?: RunSourceFailure;
  readonly sourceUrl?: string;
  readonly startedAt: string;
  readonly status?: RunStatus;
}
// Build with the existing additive-spread idiom (withRunStatus/withRunMetrics) so exactOptional fields
// are OMITTED, never assigned `undefined`.
```

### Pattern 4: Awaited flush before exit (PROG-04)

**What:** Wrap `log.flush(cb)` in a Promise and await it before setting `process.exitCode`. Never call
`process.exit()`. In production the destination is `pino.destination({ sync: true })` (already the documented
posture); the awaited flush is a defensive guarantee that holds in both sync and async modes.

**Example:**
```typescript
// Source: pino 10.x docs (CITED: docs/api.md logger.flush([cb])) + create-logger.ts WR-05 note (VERIFIED)
async function flushLogger(log: Logger): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    log.flush((error) => (error ? reject(error) : resolve()));
  });
}
// ... at the end of the run-once action, AFTER writeJson(compact) and BEFORE process.exitCode = ...:
await flushLogger(rootLogger);
process.exitCode = result.exitCode;
```

### Pattern 5: Structured event with discriminator field (PROG-01 / D-04)

```typescript
// Source: src/cli.ts buildRetryWarnEmitter (VERIFIED — structured object, static message, no interpolation)
// page_complete (info), identifiers-only, discriminator field:
input.log?.info(
  { event: "page_complete", page, counts: pageCounts, pagesPerMinute, candidatesPerMinute },
  "page complete",
);
// page_failed / source_unavailable (error) on the !ok break path — reuse deriveSourceFailure(pageReport):
input.log?.error(
  { event: "source_unavailable", page, ...sourceFailureFields },
  "source unavailable",
);
```

### Anti-Patterns to Avoid
- **Emitting events to stdout.** Stdout must stay exactly one compact JSON document (D-01/D-02). All events go
  through `input.log` which the factory routes to stderr.
- **String-interpolating server/source data into the message.** D-04 / T-08-03: pass data as structured fields;
  keep the message a static string (the `buildRetryWarnEmitter` precedent).
- **Using `process.exit()`.** Truncates the final lines; defeats PROG-04. Use awaited `flush()` + `process.exitCode`.
- **Adding CAS / IfMatch to the evidence write.** Evidence is write-once per `runId`; CAS is unnecessary
  complexity (D-10). Failure is log-and-continue, never fatal (D-12).
- **Putting the heavy arrays back on stdout under any flag.** Even with `--emit-evidence`, stdout stays compact
  (PROG-02 success criterion 3; D-02).
- **Failing the run on an evidence-write error.** It is an optimization layered on idempotent raw/staging
  writes; warn-and-continue, exit code unchanged (D-12, mirrors checkpoint).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NDJSON serialization + level filtering | Custom `JSON.stringify` + `console.error` lines | Existing `input.log` pino child logger | pino already owns NDJSON, levels, redaction, and the stderr destination; a hand-rolled writer would bypass `REDACT_PATHS`. |
| Flush-before-exit | Manual `stream.write` + `drain` listeners | pino `flush(cb)` wrapped in a Promise | Verified pino API; the factory is already flush-ready (no async transport). |
| S3 PutObject plumbing | Raw `fetch`/XML signing | `@aws-sdk/client-s3` `PutObjectCommand` via the existing `sender` seam | The checkpoint/raw stores already encapsulate the client; mirror them. |
| S3-safe key derivation | Ad-hoc string concat | A `toEvidenceObjectKey` mirroring `toCheckpointObjectKey` (validated regex) | `runId` contains `:` from ISO timestamps; an unvalidated key risks an invalid S3 key (Pitfall 3). |
| Env-var parsing/validation | `process.env[...]` reads | Zod `s3.evidencePrefix` knob mirroring `checkpointPrefix` | The config module is the single validated source; a bare env read bypasses redaction/defaults. |
| Per-minute rate math | New rate function | Existing `derivePagesPerMinute` / `deriveRunRate` | D-05: one rate source; the per-page line is upgraded in place, not duplicated. |
| Run-status taxonomy | New status logic | Existing `deriveRunStatus` (Phase 9) | `complete`/`partial`/`failed`/`resumable` already drives `run_complete`/`run_partial`. |

**Key insight:** This phase is a re-wiring of already-built, well-factored seams. The highest-value
discipline is *reuse the exact existing pattern* (checkpoint store, config knob, commander flag, summary
builder, rate deriver) rather than inventing a parallel mechanism — every "build new" temptation here has
a verified in-repo precedent to mirror.

## Common Pitfalls

### Pitfall 1: Breaking the byte-stable stdout contract that Phase 7 deliberately preserved
**What goes wrong:** Phase 7 kept the run-once stdout summary byte-for-byte stable so `cli.test.ts`
stdout assertions passed with zero edits. PROG-02 intentionally **changes** that contract (compact projection).
If the planner treats the stdout assertions as immutable, the phase cannot ship.
**Why it happens:** The byte-stability invariant from Phase 7 is the opposite of Phase 11's intent.
**How to avoid:** D-09 makes updating `docs/integration-contract.md` §Scheduled Operation Contract **and** the
`cli.test.ts` run-once stdout assertions explicit, mandatory, in-scope work. Plan a task for each.
**Warning signs:** A plan that omits a `cli.test.ts` / integration-contract update task.

### Pitfall 2: `CONVENTIONS.md` §Logging is STALE
**What goes wrong:** `.planning/codebase/CONVENTIONS.md` §Logging predates Phase 7 and says "No logging library."
Trusting it would regress to ad-hoc `JSON.stringify` and contradict CORE-02.
**Why it happens:** Doc drift; the doc was not updated when pino landed.
**How to avoid:** The authoritative logging source is `src/logging/create-logger.ts` (VERIFIED this session).
CONTEXT.md `<canonical_refs>` flags this explicitly. Ignore the stale §Logging section.
**Warning signs:** Any task that says "no logging library" or proposes a custom JSON writer.

### Pitfall 3: `runId` contains `:` — invalid in the checkpoint key's S3-safe charset
**What goes wrong:** `createRunId` returns `run-<ISO8601>-<uuid>` and the ISO timestamp contains `:` (e.g.
`2026-06-11T13:27:38.774Z`). `toCheckpointObjectKey`'s validator only accepts `[a-z0-9._/-]`. A naive
`runs/${runId}/evidence.json` would either throw the validator or produce an awkward key.
**Why it happens:** The checkpoint slug helper sanitizes the *source URL*; the evidence helper keys on the
*runId*, which has different unsafe characters.
**How to avoid:** Sanitize the `runId` in `toEvidenceObjectKey` (lowercase + replace `[^a-z0-9._-]+` runs with
`-` + trim dashes), mirroring `toSourceSlug`. A unit test should assert a colon-bearing `runId` produces a
valid key.
**Warning signs:** An evidence object-key helper that interpolates the raw `runId` without sanitization.

### Pitfall 4: D-06's `httpStatus` is on the classifier but NOT yet on the retry event
**What goes wrong:** PROG-01 requires the `retry` event to carry `httpStatus`. `RetryAttemptEvent`
(`src/source/retry.ts`) currently has `attempt`, `causeCode`, `delayMs`, `page`, `phase` — **but not
`httpStatus`**. The classifier (`FailureClassification`) *does* expose `httpStatus`. The seam change is to
copy it from the classification into the event in `buildRetryEvent`, additively (optional field).
**Why it happens:** The retry seam was built (Phase 8) before PROG-01 required `httpStatus` on the event.
**How to avoid:** Add an optional `httpStatus?: number` to `RetryAttemptEvent` and spread it in
`buildRetryEvent` from `classification.httpStatus` (which is already on the in-scope `classification`).
Backward-compatible (optional, additive). VERIFIED: `classification.httpStatus` exists; `buildRetryEvent`
already does conditional additive spreads for `page`/`causeCode`, so this is the same idiom.
**Warning signs:** A plan that assumes `httpStatus` is already on the retry event, or that reads a `Response`
to obtain it (the classifier is transport-agnostic and already has it).

### Pitfall 5: exactOptionalPropertyTypes — never assign `undefined` to optional fields
**What goes wrong:** The project uses very strict TS (`exactOptionalPropertyTypes`). Assigning
`{ discoveredRange: undefined }` is a type error; the field must be *omitted*.
**Why it happens:** Strict optional semantics differ from the common `field?: T = undefined` habit.
**How to avoid:** Build `CompactRunSummary` (and any new optional payload) with the existing additive-spread
idiom (`withRunStatus`/`withRunMetrics`/`buildSourceFailure`/`buildRetryEvent` all do this). VERIFIED pattern
throughout `summary.ts`.
**Warning signs:** A `toCompactSummary` that assigns optional fields unconditionally.

### Pitfall 6: 100% V8 coverage gate on new branches
**What goes wrong:** Every new branch (evidence flag set/unset, file flag set/unset, evidence-write
success/failure, key-sanitization edge) must be covered or `pnpm run verify` fails the coverage gate.
**Why it happens:** The project enforces 100% reachable-source V8 coverage.
**How to avoid:** Mirror the checkpoint store tests (success + failure + integration MinIO) and the
`maxPagesOption`/`resumeInvocationOption` conditional-spread tests. Plan unit tests for each flag combination
(both/either/neither per D-13) and the log-and-continue warn path. Use `/* v8 ignore ... */` only for the
genuinely-unreachable defensive guards, as the codebase already does.
**Warning signs:** A plan without tests for the `--emit-evidence`/`--evidence-file` matrix or the
evidence-write-failure warn path.

### Pitfall 7: Flush ownership / double-flush across cli ↔ run-once
**What goes wrong:** If both `runOnce` and the cli action flush (or neither), final lines may be dropped or the
flush may run before the compact summary is written.
**Why it happens:** D-16 says "end of `runOnce`/cli" — ownership is at discretion but must be singular and
ordered after the stdout write.
**How to avoid:** Pick one owner (recommend the cli action, since it owns the root logger and the
`process.exitCode` write) and flush exactly once, after `writeJson(compact)` and before `process.exitCode`.
The child logger shares the root destination, so flushing the root logger flushes child output.
**Warning signs:** A `flush()` call inside `runOnce` *and* in `cli.ts`, or a flush before the stdout write.

## Code Examples

### Adding the `evidencePrefix` Zod knob (mirror `checkpointPrefix`)
```typescript
// Source: src/config.ts (VERIFIED — checkpointPrefix knob + S3_CHECKPOINT_PREFIX mapping)
// in configSchema.s3:
checkpointPrefix: z.string().min(1).default("checkpoints"),
evidencePrefix: z.string().min(1).default("runs"),   // NEW (D-11)
// in loadConfig() s3 input mapping:
checkpointPrefix: source["S3_CHECKPOINT_PREFIX"],
evidencePrefix: source["S3_EVIDENCE_PREFIX"],         // NEW
```

### Threading `httpStatus` into the retry event (D-06)
```typescript
// Source: src/source/retry.ts buildRetryEvent (VERIFIED — additive conditional spreads)
let event: RetryAttemptEvent = { attempt: round + 1, delayMs, phase: options.phase };
if (options.page !== undefined) event = { ...event, page: options.page };
if (classification.causeCode !== undefined) event = { ...event, causeCode: classification.causeCode };
if (classification.httpStatus !== undefined) event = { ...event, httpStatus: classification.httpStatus }; // NEW
```

### Wiring the evidence flags through the run-once command (mirror `--resume`)
```typescript
// Source: src/cli.ts registerRunOnceCommand (VERIFIED — --resume option + RunOnceOptions + threading)
program.command("run-once")
  .option("--resume", "resume from the last completed page using the source checkpoint")
  .option("--emit-evidence", "write a durable per-candidate evidence artifact to S3")   // NEW (D-13)
  .option("--evidence-file <path>", "also write the evidence artifact to a local file (dev only)") // NEW
  .action(async (options: RunOnceOptions) => { /* thread options.emitEvidence / options.evidenceFile */ });
// RunOnceOptions interface gains: emitEvidence?: boolean; evidenceFile?: string;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full `RunSummary` (multi-MB arrays) on stdout | Compact projection on stdout; full evidence in opt-in S3 artifact | Phase 11 | Operator can `jq` the summary; detail retrievable on demand. |
| Phase-7 `log.debug` run-once stub; phase-10 minimal `page rate` line | Real-level `run_start`/`page_complete`/... NDJSON taxonomy on stderr | Phase 11 | Greppable live progress for ~786-page runs. |
| Phase-7 byte-stable stdout (debug-only logging to keep the contract) | Intentional stdout contract change (compact) + stderr events | Phase 11 | `cli.test.ts` + integration-contract doc must be updated (D-09). |

**Deprecated/outdated:**
- `.planning/codebase/CONVENTIONS.md` §Logging ("No logging library") — STALE pre-Phase-7. Authoritative
  source is `src/logging/create-logger.ts`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The dev-only `--evidence-file` write uses `node:fs` synchronously/awaited and the operator owns cleanup (no app-side deletion). | Stack / D-13 | Low — explicit operator decision in CONTEXT.md; if wrong, a stale local file accumulates (dev only). |
| A2 | `s3.evidencePrefix` shares the existing bucket and credentials (no new bucket/credential surface). | Pattern 1 / D-11 | Low — mirrors `checkpointPrefix` exactly; both stores already share the bucket. |
| A3 | Flushing the **root** logger flushes child-logger output (shared destination). | Pitfall 7 / D-16 | Low — pino child loggers share the parent destination; verified by pino architecture, but the implementer should confirm in a test. |
| A4 | `pino.destination({ sync: true })` is wired in the production CLI path (the factory defaults to `process.stderr`, which is synchronous; the doc-note posture is `sync: true`). | D-16 | Low — `create-logger.ts` documents `sync: true` as the production posture; default `process.stderr` is already synchronous. The awaited flush is safe regardless of mode. |

**Note:** A1–A4 are LOW-risk because each mirrors a verified in-repo precedent or a verified pino API; none
involves an unverified package, compliance, retention, or security target. No `checkpoint:human-verify`
gating is required, but the planner should keep A3 in mind when writing the flush test.

## Open Questions (RESOLVED)

1. **Evidence store module location (`src/storage/` vs `src/run/` vs `src/evidence/`)**
   — **RESOLVED → `src/evidence/`.**
   - What we knew: The checkpoint store lives in `src/checkpoint/`; the raw store in `src/storage/`. Both are
     valid precedents.
   - **Resolution:** The evidence-store module lives in a new **`src/evidence/`** directory (store + object-key
     + tests), keeping the run-evidence concern self-contained and mirroring the `src/checkpoint/` structure.
     Plans 01/03/04 reference `src/evidence/s3-evidence-store.ts` accordingly.

2. **Discriminator field name (`event` vs reusing pino `msg`)**
   — **RESOLVED → dedicated `event` field.**
   - What we knew: CONTEXT.md leaves this to discretion (D-04 wording suggests an `event:<name>` field).
   - **Resolution:** Every lifecycle line (and the `retry` warn line) carries a dedicated structured **`event`**
     field (e.g. `{ event: "page_complete" }`, `{ event: "retry" }`) plus a static human `msg` — greppable as
     `grep '"event":"page_complete"'` and stable regardless of message wording. The `event` field is the
     stable discriminator across the whole taxonomy (D-04/D-06).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | v24.16.0 | — |
| pino | NDJSON events + flush | ✓ | 10.3.1 | — |
| commander | run-once flags | ✓ | 14.0.3 | — |
| @aws-sdk/client-s3 | evidence PutObject | ✓ | installed | — |
| zod | evidencePrefix knob | ✓ | installed (v4 API) | — |
| node:fs / node:crypto | local evidence file / runId | ✓ | stdlib | — |
| Docker + MinIO (Testcontainers) | evidence-store integration test | ✓ (used by checkpoint integration test) | — | unit test with injected `sender` if Docker absent |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none required — all dependencies present. (Evidence-store integration
testing can fall back to the injected-`sender` unit test if Docker is unavailable, mirroring the checkpoint
store's `s3-checkpoint-store.test.ts` vs `.integration.test.ts` split.)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 + V8 coverage (100% reachable-source gate) |
| Config file | (project root — `vitest`/coverage config; `pnpm run verify` aggregates) |
| Quick run command | `pnpm run test` (unit) |
| Full suite command | `pnpm run verify` (typecheck + unit + integration + coverage + build) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROG-01 | Each lifecycle event emitted at the right level with `event` discriminator + identifiers-only payload (captured via injected stream sink) | unit | `pnpm run test src/run/run-once.test.ts` | ✅ (extend) |
| PROG-01 | `retry` event carries `httpStatus`/`causeCode`/`attempt` | unit | `pnpm run test src/source/retry.test.ts` | ✅ (extend) |
| PROG-02 | `toCompactSummary` strips the four arrays, keeps scalars, omits absent optionals | unit | `pnpm run test src/run/summary.test.ts` | ✅ (extend) |
| PROG-02 | run-once stdout is exactly one compact JSON document (no heavy arrays) | unit | `pnpm run test src/cli.test.ts` | ✅ (UPDATE assertions — D-09) |
| PROG-03 | Evidence store writes `runs/<runId>/evidence.json` (plain PutObject, no CAS); key sanitizes colon-bearing runId | unit + integration | `pnpm run test src/evidence/` + MinIO integration | ❌ Wave 0 |
| PROG-03 | `--emit-evidence`/`--evidence-file` matrix (both/either/neither); evidence-write failure → warn, exit unchanged | unit | `pnpm run test src/cli.test.ts` / `run-once.test.ts` | ✅ (extend) |
| PROG-04 | No secret/body/HTML string in any event/summary/evidence payload (mirror DIAG-04 no-body test) | unit | `pnpm run test` (new no-leak test) | ❌ Wave 0 |
| PROG-04 | Awaited flush resolves before exit; root-flush drains child output | unit | `pnpm run test src/cli.test.ts` | ✅ (extend) |

### Sampling Rate
- **Per task commit:** `pnpm run test` (quick unit run)
- **Per wave merge:** `pnpm run verify` (full suite incl. integration + coverage)
- **Phase gate:** `pnpm run verify` green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/evidence/s3-evidence-store.test.ts` (+ `.integration.test.ts`) — covers PROG-03 plain-PutObject + key sanitization
- [ ] `src/evidence/object-key.test.ts` — covers colon-bearing `runId` → valid key (Pitfall 3)
- [ ] A no-secret/body/HTML leak test over events + compact summary + evidence payload (PROG-04, mirror DIAG-04)
- [ ] UPDATE `src/cli.test.ts` run-once stdout assertions for the compact projection (D-09) — *existing file, mandatory edit*
- [ ] UPDATE `docs/integration-contract.md` §Scheduled Operation Contract (D-09) — *doc, not a test, but mandatory*

*(Framework already present — no install needed.)*

## Security Domain

> `security_enforcement` treated as enabled (no explicit `false` found). This phase adds observability and one
> opt-in S3 write; the dominant risk is leaking secrets/bytes into a new durable artifact or log stream.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface in this CLI. |
| V3 Session Management | no | No sessions. |
| V4 Access Control | no | No multi-tenant access; S3 credentials are the existing operator credentials. |
| V5 Input Validation | yes | Zod-validated `evidencePrefix`; commander-typed flags; `toEvidenceObjectKey` validates the S3-safe charset and sanitizes `runId` (prevents key injection — mirrors threat T-09-05). |
| V6 Cryptography | no | No new crypto; `randomUUID` unchanged. |
| V7 Error/Logging | yes | pino `redact` + identifiers-only payloads; no secret/body/HTML in events, compact summary, or evidence artifact (D-15, PROG-04); awaited flush so audit lines are not dropped. |
| V8 Data Protection | yes | Evidence artifact body is the full `RunSummary` — must be verified free of secrets/bytes/HTML; `sourceUrl` already userinfo-stripped by `sanitizeSourceUrl`. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret/credential leak into the new durable evidence object | Information Disclosure | Full `RunSummary` is already redaction-disciplined (identifiers-only counts/categories/status); no config/candidate bytes serialized; no-leak unit test asserts it (D-15). |
| Source-URL credentials (`user:pass@host`) reaching the artifact/logs | Information Disclosure | `sanitizeSourceUrl` already strips userinfo before the URL enters any durable surface (VERIFIED in `run-once.ts`). |
| Object-key injection via operator-controlled `runId`/prefix | Tampering | `toEvidenceObjectKey` validates `[a-z0-9._/-]` and sanitizes `runId` (mirrors `toCheckpointObjectKey` / T-09-05). |
| Dropped final log lines on exit (audit gap) | Repudiation | Awaited `flush()` Promise before `process.exitCode`; no `process.exit()` (PROG-04 / D-16). |
| Unbounded `runs/` growth | Denial of Service (storage) | Opt-in-only write + infra-owned S3 lifecycle rules (D-14, documented); not app-side pruning. |
| New unintended write surface (S3/PostgreSQL) | Tampering / boundary breach | Only one new write: the opt-in evidence object. No staging-schema, raw-key, or `server-2` table change (integration-contract Compatibility Rule; CONTEXT.md out-of-scope). |

## Project Constraints (from AGENTS.md / CLAUDE.md)

- **Must NOT parse replay contents or write `server-2` business tables.** Phase 11 adds no parsing and no
  business-table write; the only new write is the opt-in S3 evidence object.
- **Accepted v1 write boundary = raw object + staging/outbox records (+ checkpoint, + now opt-in evidence).**
  PROG-04 explicitly forbids any other new write surface.
- **Stack:** Node 24 (target 25), TypeScript 6, ESM, pnpm; ESLint `all` + strict typed linting, Unicorn,
  Prettier, Vitest 4, V8 100% coverage. New code must satisfy `exactOptionalPropertyTypes` (additive-spread idiom).
- **Structured logging + explicit run summaries; mocked/fixture tests before production-like sources.** The
  evidence store uses an injectable `sender` seam for unit tests + a MinIO integration test (mirror checkpoint).
- **Cross-application compatibility:** The stdout summary is operator-/`server-2`-visible. The compact projection
  + opt-in artifact is a contract change — `docs/integration-contract.md` MUST be updated (D-09). No staging
  schema / object-key / `server-2` change, so no `server-2` sign-off beyond the documented stdout contract.
- **README must stay current** and state that development uses only AI agents + GSD. Document `S3_EVIDENCE_PREFIX`,
  `--emit-evidence`, `--evidence-file`.
- **Every session leaves `git status --short` clean.** Commit planned results.
- **Project skills to apply:** `solidstats-backend-ts-conventions` (TS/Node conventions, Zod config, DI seams),
  `solidstats-backend-ts-tests` + `solidstats-process-testing-standards` (AAA, isolation, colocated `<name>.test.ts`,
  injected seams), `solidstats-backend-ts-code-review` for review.

## Sources

### Primary (HIGH confidence)
- `src/run/run-once.ts`, `src/run/summary.ts`, `src/run/types.ts` — run loop, `buildRunSummary`/`deriveRunStatus`/
  `deriveSourceFailure`/`derivePagesPerMinute`, `RunSummary` shape (VERIFIED this session).
- `src/cli.ts` — `registerRunOnceCommand`, `--resume` precedent, `writeJson`, `buildRetryWarnEmitter`, `createRunId`,
  `process.exitCode` path (VERIFIED).
- `src/logging/create-logger.ts` — `REDACT_PATHS`, stderr default, documented `sync: true` posture, flush-ready design (VERIFIED).
- `src/checkpoint/s3-checkpoint-store.ts` + `src/checkpoint/object-key.ts` + `src/storage/s3-raw-storage.ts` —
  `sender` seam + `FromConfig` + validated object-key pattern to mirror (VERIFIED).
- `src/config.ts` — Zod `s3.checkpointPrefix` + `S3_CHECKPOINT_PREFIX` knob pattern to mirror (VERIFIED).
- `src/source/retry.ts` + `src/source/classify-failure.ts` — `RetryAttemptEvent`/`buildRetryEvent` (no `httpStatus`
  yet) and `FailureClassification.httpStatus` (present) — confirms the D-06 additive seam change (VERIFIED).
- `docs/integration-contract.md` §Scheduled Operation Contract — the stdout contract being reshaped (VERIFIED).
- pino 10.x docs (Context7 `/pinojs/pino`) — `logger.flush([cb])`, `pino.destination({ sync: true })` (CITED).
- `package.json` / `node_modules` — pino 10.3.1, commander 14.0.3, Node v24.16.0 (VERIFIED via `node -p`).

### Secondary (MEDIUM confidence)
- None required — all claims grounded in verified in-repo source or official pino docs.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already installed and verified by version; no new package.
- Architecture: HIGH — every pattern mirrors a verified in-repo precedent (checkpoint store, config knob,
  commander flag, summary builder, rate deriver); CONTEXT.md decisions match the actual code.
- Pitfalls: HIGH — each pitfall traces to a verified file fact (stale CONVENTIONS, byte-stable stdout, runId
  charset, missing event `httpStatus`, exactOptional, 100% coverage, flush ownership).
- Security: HIGH — single new write surface, redaction + userinfo-strip + key-validation precedents all verified.

**Research date:** 2026-06-11
**Valid until:** 2026-07-11 (stable — internal refactor over installed deps; pino/commander/aws-sdk versions pinned)
