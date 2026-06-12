# Phase 8: Source Failure Diagnostics and Retry - Pattern Map

**Mapped:** 2026-06-08
**Files analyzed:** 9 (3 new modules + 3 new tests + 3 modified)
**Analogs found:** 9 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/source/classify-failure.ts` (NEW) | utility | transform | `classifySshFailure` in `src/discovery/source-client.ts:140-156` | exact (extracted from) |
| `src/source/retry.ts` (NEW) | utility | request-response (wrapper) | injectable `sleep` seam in `src/discovery/discover.ts:125-143` | role-match + seam-match |
| `src/source/classify-failure.test.ts` (NEW) | test | transform | `src/discovery/source-client.test.ts` | exact |
| `src/source/retry.test.ts` (NEW) | test | request-response | `src/discovery/source-client.test.ts` (timer/seam tests) | exact |
| `src/source/classify-failure.test.ts` (no-leak assert) | test | transform | `src/errors/app-error.test.ts` (details assertions) | role-match |
| `src/config.ts` (MODIFY) | config | transform | `sourceConfigSchema` Zod field at `src/config.ts:29-54` | exact (same file) |
| `src/discovery/source-client.ts` (MODIFY) | service | request-response | self (`createDirectSourceClient` :52-90) | exact (same file) |
| `src/storage/replay-byte-client.ts` (MODIFY) | service | request-response/file-I/O | `src/discovery/source-client.ts` (mirror twin) | exact |
| `src/discovery/discover.ts` (MODIFY) | service | event-driven (orchestration) | `createPacedSourceClient` :125-143 + diagnostic builders :361-387 | exact (same file) |
| `src/cli.ts` (MODIFY) | controller | request-response | run summary `report` object `src/cli.ts:440-449` | exact (same file) |

## Pattern Assignments

### `src/source/classify-failure.ts` (NEW — utility, transform)

**Analog:** `classifySshFailure` (`src/discovery/source-client.ts:140-156`). This is the explicit seed. The new module generalizes it to a tri-state classification (`transient` | `rate_limited` | `permanent`) and unwraps `AggregateError` before inspection (DIAG-02).

**Seed pattern to generalize** (`src/discovery/source-client.ts:140-156`):
```typescript
function classifySshFailure(error: unknown): SourceFetchError["code"] {
  let message = "";
  /* v8 ignore next -- defensive guard for non-Error promise rejections. */
  if (error instanceof Error) {
    message = error.message.toLowerCase();
  }
  if (
    message.includes(String(httpTooManyRequestsStatus)) ||
    message.includes("rate limit") ||
    message.includes("cloudflare")
  ) {
    return "rate_limited";
  }
  return "source_unavailable";
}
```

**Cause-reading source** — classifier consumes the typed `cause` preserved by `AppError` (`src/errors/app-error.ts:34-38`):
```typescript
if (options?.cause === undefined) {
  super(message);
} else {
  super(message, { cause: options.cause });
}
```

**HTTP 429 mapping pattern to reuse** (`src/discovery/source-client.ts:15,63-67`):
```typescript
const httpTooManyRequestsStatus = 429;
// ...
let code: SourceFetchError["code"] = "source_unavailable";
if (response.status === httpTooManyRequestsStatus) {
  code = "rate_limited";
}
```

**Classifier contract to produce (planner guidance):**
- Input: `unknown` error (unwrap `AggregateError.errors[*]` first — happy-eyeballs dual-stack).
- Inspect: `cause.code` (`ECONNRESET`/`ENOTFOUND`/`EAI_AGAIN`/`ETIMEDOUT`/`UND_ERR_*`, TLS), HTTP status (429 → `rate_limited`; 5xx → `transient`; non-CF 4xx/404/410 → `permanent`), and a short Cloudflare-marker check (`cf-ray`, "Just a moment", status-200 challenge HTML → `transient` + CF boolean).
- Output: a small struct `{ classification, cloudflareMarker, status?, causeCode?, causeMessage? }` — identifiers only, no body (DIAG-04).

---

### `src/source/retry.ts` (NEW — utility, request-response wrapper)

**Analog:** the injectable-`sleep` paced-client seam (`src/discovery/discover.ts:125-143`). Mirror its injectable-async-dependency shape so backoff is deterministic in tests.

**Injectable seam pattern to mirror** (`src/discovery/discover.ts:128-141`):
```typescript
const requestDelayMs = options.requestDelayMs ?? defaultRequestDelayMs;
const sleep = options.sleep ?? defaultSleep;
let requestCount = 0;
return {
  async fetchText(url: URL): Promise<string> {
    if (requestCount > 0 && requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }
    requestCount += 1;
    return options.sourceClient.fetchText(url);
  },
};
```

**Default sleep adapter to copy** (`src/discovery/discover.ts:559-564`):
```typescript
/* v8 ignore next 5 -- tested through injected sleep to avoid real timer delay. */
async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
```

**Factory shape to mirror** (`create*(config|fn, options)` with defaulted deps — `src/discovery/source-client.ts:37-50`):
```typescript
export function createSourceClient(
  config: SourceConfig,
  options: CreateSourceClientOptions = {},
): SourceClient {
  // options.execFile ?? defaultExecFile ; options.sleep ?? defaultSleep
}
```

**AbortSignal threading pattern to thread through retry rounds** (`src/discovery/source-client.ts:55-61`):
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => { controller.abort(); }, config.sourceTimeoutMs);
// fetch(url, { signal: controller.signal })
```

**Retry helper contract to produce (planner guidance):**
- Signature like `withRetry(operation, { attempts, classify, sleep?, random?, signal? })`.
- Inject `sleep` AND `random` (RNG) so full-jitter is deterministic in tests (mirror the `sleep` seam; add `random` the same way).
- Backoff fixed constants: `base ≈ 500ms`, `cap ≈ 30_000ms`, full jitter `delay = random() * min(cap, base * 2**attempt)`. Honor `Retry-After` when present (takes precedence over computed backoff).
- Re-classify each thrown error; stop immediately on `permanent`; retry `transient`/`rate_limited` up to `attempts`.
- Emit one pino `warn` per retry via `createLogger().child({ runId })` (`src/logging/create-logger.ts:52-63`) with `{ phase, page, attempt, delayMs, causeCode }` — stderr keeps stdout summary clean.
- Return value carries final `attempts` + `classification` for the diagnostic payload.

---

### `src/config.ts` (MODIFY — config, transform)

**Analog:** existing Zod field + env override in the same file.

**Zod field pattern to copy** (`src/config.ts:31-40`):
```typescript
sourceMaxPages: z.coerce.number().int().positive().default(1),
// ...
sourceTimeoutMs: z.coerce.number().int().positive().default(defaultSourceTimeoutMs),
```
Add `sourceRetryAttempts: z.coerce.number().int().nonnegative().default(3)` (default 3 per DIAG-03). Place a `const defaultSourceRetryAttempts = 3;` near `defaultSourceTimeoutMs` (`src/config.ts:27`).

**Env-override wiring to copy** (`src/config.ts:159-176`):
```typescript
sourceTimeoutMs: source["REPLAY_SOURCE_TIMEOUT_MS"],
```
Add `sourceRetryAttempts: source["REPLAY_SOURCE_RETRY_ATTEMPTS"],` to `readSourceConfigInput` return object + its type. Attempt count is a plain integer — NOT a secret, so it must NOT be added to `redactConfig` (`src/config.ts:144-157`) or `RedactedAppConfig` omit list; redaction posture stays intact precisely by leaving it visible.

---

### `src/discovery/source-client.ts` (MODIFY — service, request-response)

**Analog:** self. Both `createDirectSourceClient` (:52-90) and `createSshSourceClient` (:92-127) catch-and-wrap; route both through the shared classifier + retry helper.

**Current direct catch/wrap to replace with classifier** (`src/discovery/source-client.ts:76-87`):
```typescript
} catch (error) {
  if (error instanceof SourceFetchError) { throw error; }
  throw new SourceFetchError("source_unavailable", "Source request failed");
}
```

**Current SSH classification call site** (`src/discovery/source-client.ts:117-123`) — delegate to the shared module instead of the local `classifySshFailure`:
```typescript
const code = classifySshFailure(error);
let message = "SSH source request failed";
if (code === "rate_limited") { message = "SSH source request was rate limited"; }
throw new SourceFetchError(code, message);
```

**Error subclass shape stays** (`SourceFetchError`, :17-31). When widening behavior, preserve `cause`/`details` (identifiers only) on construction so the classifier and diagnostics can read them. Add a transient code if the union needs it (currently `"rate_limited" | "source_unavailable"`).

---

### `src/storage/replay-byte-client.ts` (MODIFY — service, request-response/file-I/O)

**Analog:** `src/discovery/source-client.ts` (its structural twin). Apply the SAME classifier + retry helper; remove duplicated SSH catch/wrap scaffold (IN-02).

**Union to widen** (`src/storage/replay-byte-client.ts:19`) — closes Phase 7 WR-03:
```typescript
export class ReplayByteFetchError extends AppError<"fetch_failed"> {
```
Widen to e.g. `AppError<"fetch_failed" | "rate_limited" | "transient">` (align literal names with `source-client.ts` so the shared classifier maps consistently).

**Catch/wrap sites to route through classifier** (`src/storage/replay-byte-client.ts:71-79` direct, `:107-116` SSH):
```typescript
} catch (error) {
  if (error instanceof ReplayByteFetchError) { throw error; }
  throw new ReplayByteFetchError("fetch_failed", "Replay byte request failed");
}
```

---

### `src/discovery/discover.ts` (MODIFY — service, event-driven orchestration)

**Analog:** self. Surface rich diagnostic fields and compose backoff UNDER pacing.

**Diagnostic emission to enrich** (`src/discovery/discover.ts:112-117`):
```typescript
diagnostics.push({
  code: error.code,
  message: error.message,
  severity: "error",
  sourceUrl: options.sourceUrl.toString(),
});
```
Extend with DIAG-01 fields: `status`, `causeCode`, `causeMessage`, `page`, `phase` (`list`|`detail`|`bytes`), `attempts`, `cloudflareMarker`. These additions require corresponding fields on `DiscoveryDiagnostic` (`src/discovery/types.ts:33-41`) and likely a wider `DiagnosticCode` union (`src/discovery/types.ts:5-11`, add `transient`).

**Optional-field builder pattern to copy** for the new optional diagnostic fields (`src/discovery/discover.ts:338-387` — `diagnosticEvidence` + `withOptionalDiagnosticEvidence`): only attach a key when defined, preserving exact-optional-property typing.

**Backoff-under-pacing composition** — the retry helper wraps each `sourceClient.fetchText` call; the pacing `sleep` (`src/discovery/discover.ts:134-135`) remains the outer inter-request delay. Pass the injectable `sleep` from `DiscoverReplaysDryRunOptions` (`:16`) down so both pacing and retry stay deterministic in one test.

---

### `src/cli.ts` (MODIFY — controller, request-response)

**Analog:** the run summary `report` object literal (`src/cli.ts:440-449`).

**Summary object to extend** (`src/cli.ts:440-449`):
```typescript
const report = {
  ok,
  mode: storeRawMode(shouldStage),
  sourceUrl: discoveryReport.sourceUrl,
  generatedAt: discoveryReport.generatedAt,
  counts: storeRawCounts(shouldStage, rawCounts, stagingCounts),
  candidates: discoveryReport.candidates,
  diagnostics: discoveryReport.diagnostics,
  storage: storageResults,
};
```
Surface final attempts/classification: they flow from the enriched `discoveryReport.diagnostics` (no extra plumbing if diagnostics already carry `attempts`/`classification`). The dry-run path (`src/cli.ts:293-298`) and `run-once` (`:344-360`) write the same diagnostics; keep `writeJson`/stdout-summary contract intact (logs already go to stderr via `createLogger`).

---

### Test files (NEW — colocated `*.test.ts`)

**Analog:** `src/discovery/source-client.test.ts` (seam + `rejects.toMatchObject({ code, name })` assertions) and `src/errors/app-error.test.ts` (details-content assertions).

**Assertion pattern to copy** (`src/discovery/source-client.test.ts:37-43`):
```typescript
await expect(
  sourceClient.fetchText(new URL("https://example.test/replays")),
).rejects.toMatchObject({ code: "rate_limited", name: "SourceFetchError" });
```

**Timer/seam discipline** — tests use `vi.useRealTimers()`/`vi.unstubAllGlobals()` cleanup (`src/discovery/source-client.test.ts:20-23`); the retry helper must be driven through injected `sleep`/`random`, never real timers (mirror `discover.test.ts` injected-sleep usage).

**No-body-leak test (DIAG-04):** assert the produced diagnostic/error `details` payload contains ONLY identifier keys (`status`, `causeCode`, `causeMessage`, `page`, `url`, `phase`, `attempts`, `cloudflareMarker`) and NO response body / raw bytes — assert against a known-large/secret-bearing input that none of it appears in the serialized payload. Reference `AppError` `details` discipline note (`src/errors/app-error.ts:9-16` doc comment).

## Shared Patterns

### Failure classification (single source of truth)
**Source:** generalized from `classifySshFailure` (`src/discovery/source-client.ts:140-156`)
**Apply to:** `source-client.ts`, `replay-byte-client.ts`, `discover.ts` diagnostics. One module; both transports and the bytes path call it.

### Injectable async/random seam for determinism
**Source:** `src/discovery/discover.ts:128-141` (`sleep`) + `:559-564` (`defaultSleep`)
**Apply to:** retry helper (`sleep` + `random`/RNG), all retry/backoff tests.

### Typed-error construction preserving cause + identifier-only details
**Source:** `src/errors/app-error.ts:25-45`
**Apply to:** `SourceFetchError`, `ReplayByteFetchError` widening — never put bodies/secrets/bytes in `details` (`src/errors/app-error.ts:9-16`).

### Zod field + env override + redaction posture
**Source:** `src/config.ts:31-40` (field), `:159-176` (env), `:144-157` (redact)
**Apply to:** `sourceRetryAttempts`. Non-secret → intentionally NOT redacted.

### Structured warn logging on stderr (stdout summary contract)
**Source:** `src/logging/create-logger.ts:52-63` + `src/cli.ts:316-317` (`rootLogger.child({ runId })`)
**Apply to:** per-retry-attempt warn events. Log identifiers only.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every new file has a strong existing seed/analog in this repo. |

`Retry-After` parsing and `AggregateError` unwrapping are new sub-behaviors with no exact in-repo precedent — planner should follow RESEARCH.md / standard semantics, but the surrounding structure (classifier module, retry wrapper) is fully analog-backed.

## Metadata

**Analog search scope:** `src/discovery/`, `src/storage/`, `src/config.ts`, `src/errors/`, `src/logging/`, `src/cli.ts`
**Files scanned:** 9 source + 1 test sampled
**Pattern extraction date:** 2026-06-08

## PATTERN MAPPING COMPLETE

**Phase:** 8 - Source Failure Diagnostics and Retry
**Files classified:** 10 (3 new modules, 3 new tests, 4 modified incl. types.ts)
**Analogs found:** 9 / 9

### Coverage
- Files with exact analog: 8
- Files with role-match analog: 1
- Files with no analog: 0

### Key Patterns Identified
- Shared failure classifier generalizes the existing `classifySshFailure` (`source-client.ts:140`) into a tri-state (transient/rate_limited/permanent) module consumed by both source-client and replay-byte-client; reads `AppError.cause`.
- Retry helper mirrors the injectable `sleep` seam from `discover.ts:128-141` and the `create*(config, options)` defaulted-dependency factory shape; adds injectable RNG for deterministic full-jitter; threads `AbortSignal`; backoff composes UNDER the outer pacing `sleep`.
- Config follows the existing Zod-field + env-override pattern (`config.ts:31-40,159-176`); attempt count stays non-redacted by design.
- Diagnostics extend `DiscoveryDiagnostic` (`types.ts:33`) via the optional-field builder pattern (`discover.ts:361-387`); warn logging stays on stderr to preserve the stdout JSON summary contract.

### File Created
`.planning/phases/08-source-failure-diagnostics-and-retry/08-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns in PLAN.md files.
