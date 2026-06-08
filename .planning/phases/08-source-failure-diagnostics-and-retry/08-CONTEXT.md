# Phase 8: Source Failure Diagnostics and Retry - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (grey areas auto-decided per recommended answers — see [[feedback-autonomous-no-questions]])

<domain>
## Phase Boundary

Replace the generic `source_unavailable` / "Source request failed" collapse with rich, auditable failure diagnostics and bounded automatic retry. Requirements DIAG-01..04:

- **DIAG-01** — failed source requests surface HTTP status, low-level `cause.code`/`cause.message`, page number, request URL, fetch phase (`list` | `detail` | `bytes`), and attempt count.
- **DIAG-02** — a failure classifier routes transient signals (network codes `ECONNRESET`/`ENOTFOUND`/`EAI_AGAIN`/`ETIMEDOUT`/`UND_ERR_*`, TLS errors, HTTP 429/5xx, Cloudflare challenge bodies incl. status-200 HTML traps) to retry, and permanent signals (non-CF 4xx/404/410, malformed body, missing external id/filename) to immediate failure. `AggregateError` (happy-eyeballs dual-stack) is unwrapped before classification.
- **DIAG-03** — bounded retry with exponential backoff (full jitter, base≈500ms, cap≈30s) + `Retry-After` honoring on list/detail/byte reads; permanent failures never retried; attempts operator-configurable; backoff composes UNDER the existing pacing delay; per-request `AbortSignal` threads through retry rounds.
- **DIAG-04** — diagnostics contain no secrets, raw replay bytes, or large bodies — only a short Cloudflare-marker boolean, status, cause code/message, page, url, phase, attempts. Verified by a unit test asserting no body content in the payload.

Builds on Phase 7 (`AppError` base for typed errors; `createLogger` pino for retry warn events).
</domain>

<decisions>
## Implementation Decisions

### Retry configuration (DIAG-03)
- Default **3 retry attempts** (4 total tries), operator-configurable.
- Config lives as a **new optional field in the Zod config schema** (`src/config.ts`) with an **env-var override** — consistent with the existing s3/staging/source config pattern (validated, discoverable).
- Backoff parameters (base≈500ms, cap≈30s, full jitter) are **fixed constants** matching the success criteria; only the attempt count is operator-configurable. Keep it simple.

### Failure classifier scope (DIAG-02) — closes Phase 7 WR-03
- Extract a **single shared classifier module** reused by `source-client.ts` AND `replay-byte-client.ts`.
- **Unify the bytes path now:** widen `ReplayByteFetchError`'s `code` union so the bytes phase also distinguishes transient/`rate_limited`/permanent (closes the deferred Phase 7 WR-03; removes the SSH-scaffold duplication noted in IN-02 where practical).
- Classification consumes the typed `cause` preserved by the Phase 7 `AppError` base.

### Retry surface (DIAG-03)
- Apply retry + backoff to **all source reads (list, detail, bytes) in every command** — `discover --dry-run`, `--store-raw`, and `run-once`. Transient failures occur during discovery too; dry-run benefits from the same resilience.

### Retry observability (DIAG-01)
- Emit a **pino `warn` event per retry attempt** via the Phase 7 `runId` child logger (defaults to **stderr**, so the stdout JSON summary contract stays intact) with phase/page/attempt/delay/`cause.code`.
- Include the **final attempt count + classification** in the structured run summary / `DiscoveryDiagnostic` payload.

### Secrets / payload hygiene (DIAG-04)
- Diagnostic payload carries only: a short Cloudflare-marker boolean, HTTP status, `cause.code`/`cause.message`, page, url, phase, attempts. No response bodies, no raw bytes, no secrets. Unit test asserts no body content leaks.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SourceFetchError` (`src/discovery/source-client.ts:17`) — already `extends AppError<"rate_limited" | "source_unavailable">`; HTTP 429 → `rate_limited`; existing `classifySshFailure` (line 140) is the seed for the shared classifier.
- `ReplayByteFetchError` (`src/storage/replay-byte-client.ts`) — `extends AppError<"fetch_failed">`; must widen union for transient/rate_limited (WR-03).
- `createLogger` (`src/logging/create-logger.ts`) — pino factory, `child({ runId })`, defaults to stderr (Phase 7).
- `AppError` (`src/errors/app-error.ts`) — preserves `cause`; classifier reads it.
- Existing `AbortSignal`/timeout in source-client (`controller.signal`, line 56-61).

### Established Patterns
- Pacing: `defaultRequestDelayMs = 2000` with injectable `sleep` in `src/discovery/discover.ts:78,129,135` — retry backoff composes UNDER this (does not replace it).
- Config: Zod schemas in `src/config.ts` (`sourceConfigSchema`, `s3`, `staging`); retry config follows this shape with redaction posture intact.
- Diagnostics: `DiscoveryDiagnostic` + `ok` boolean + diagnostics array in `src/discovery/discover.ts`; extend with the rich failure fields.
- Tests colocated `*.test.ts`; deterministic via injected `sleep`.

### Integration Points
- `source-client.ts` (list/detail HTTP + SSH) and `replay-byte-client.ts` (bytes) both call the source — both wrap reads in the shared retry+classify helper.
- `discover.ts` orchestrates paced reads; retry wraps each read, backoff under the pacing sleep.
- `cli.ts` run summary surfaces final attempts/classification.

</code_context>

<specifics>
## Specific Ideas

- Make the retry helper's `sleep`/jitter injectable for deterministic tests (mirror the existing `sleep` seam) — full-jitter randomness must be testable without flakiness.
- Cloudflare detection: inspect body for CF markers (e.g. `cf-ray`, "Just a moment", challenge HTML) including status-200 traps → set CF-marker boolean + classify transient.

</specifics>

<deferred>
## Deferred Ideas

- WR-04 (fragile `import.meta.url` entrypoint guard) — remains deferred (pre-existing, unrelated to diagnostics/retry). Candidate for a later quick task.
- Per-host circuit breaker / global rate budgeting — out of scope; Phase 10 (Dynamic Source Range and Rate Limiting) owns pacing/rate concerns.

</deferred>
