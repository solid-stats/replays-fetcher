# V2 Implementation Research: Full-Corpus Ingest Resilience

**Reader:** the engineer writing the v2 `REQUIREMENTS.md` and roadmap for `replays-fetcher`.
**Action:** turn each section below into concrete requirements and phases. This is the *implementation* layer on top of `.planning/research/v2-full-run-findings.md` (the *domain* layer — the 2026-05-11 incident) and `plans/replays-fetcher/briefs/v2-backend-parity-and-full-run.md` (the milestone phases). It does not re-derive the incident; it answers *how* to build each phase inside the real seams in `src/` and the prescriptive `solidstats-backend-ts-conventions` (factory functions returning typed contracts, no classes; downward-only layering; typed error system; Zod config validated before any I/O; pino structured logging; strict TS). The HTTP/Fastify/TypeBox sections of those conventions do **not** apply — this is a `commander` CLI.

## Convention-fit baseline (read once, applies to every section)

The shared baseline in `solidstats-backend-ts-conventions` binds this CLI even though it is not Fastify. Two project-wide gaps and one naming note shape every recommendation:

1. **No typed error hierarchy yet.** `SourceFetchError` (`src/discovery/source-client.ts`) and `ReplayByteFetchError` (`src/storage/replay-byte-client.ts`) are bare `class … extends Error` with a `code` field. The conventions mandate an `AppError`-style base (`isOperational`, `code`, `details`, `cause` preserved). v2 adds enough new error surface (retry-exhausted, checkpoint-conflict, contract-violation) that Phase 1 should introduce a small shared `src/errors/` base these extend, rather than growing more ad-hoc classes. Keep the existing `code` string unions — they already drive the diagnostics taxonomy.
2. **No pino yet.** Every command emits one `JSON.stringify` blob via `writeJson` in `src/cli.ts`; there is no logger. The conventions require structured pino logging, and findings area 4 (compact progress events) *cannot* be built without it. Introduce a single injected pino logger (a `createLogger` factory, child loggers keyed by `runId`/`page`) as foundational v2 work. This is the one genuinely new infra dependency v2 needs.
3. **Factory + injected-seam discipline already holds.** `discoverReplaysDryRun`, `storeRawReplay`, `stageRawReplay`, `createSourceClient`, the `SourceClient` interface, and the `BuildCliDependencies` injection map in `src/cli.ts` are all already factory/seam-shaped. Every v2 addition must extend these seams (add a field to `SourceClient`, a dependency to the CLI map, a field to the existing diagnostic/summary types) rather than introduce a parallel structure.

---

## 1. Source-failure diagnostics + bounded retry/backoff

**Recommended approach.** Split the current monolithic `SourceClient.fetchText` into three concerns: (a) a low-level fetch that *classifies* the failure into a typed error carrying full evidence, (b) a retry wrapper that decides transient-vs-permanent and applies backoff, (c) the existing paced wrapper. The retry wrapper lives between the paced wrapper and the raw client — both `createSourceClient` (`src/discovery/source-client.ts`) and `createReplayByteClient` (`src/storage/replay-byte-client.ts`) get wrapped, because the incident failed on *both* list-page and detail/byte reads.

**Classification (transient vs permanent).** With native `fetch` (undici) on Node 25, network failures surface as `TypeError: fetch failed` with the real cause on `error.cause.code`. Classify:

| Class | Signal | Action |
|-------|--------|--------|
| Transient — network | `error.cause?.code` ∈ `ECONNRESET`, `ENOTFOUND` (DNS), `EAI_AGAIN`, `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_SOCKET`, `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT` | retry with backoff |
| Transient — TLS | `error.cause?.code` starting `ERR_TLS_` / `ERR_SSL_` | retry (bounded; TLS errors are sometimes permanent, so cap low) |
| Transient — HTTP | status `429`, `500`, `502`, `503`, `504` | retry; honor `Retry-After` on 429/503 |
| Transient — Cloudflare | status `502/503/520..527` or HTML body containing a Cloudflare challenge marker (`cf-mitigated`, `Just a moment`, `Attention Required`) | retry; note the live source already returns 403 to a naive fetch UA — Cloudflare gating is real here |
| Permanent — HTTP | status `400`, `401`, `403` (non-Cloudflare), `404`, `410` | do **not** retry; surface as permanent |
| Permanent — contract | body is not valid for the page kind (list with no table, detail with no filename input, JSON endpoint returning HTML), missing external id | do **not** retry; this is malformed source data, the existing `missing_filename`/`malformed_row` family |

The current code collapses everything except 429 into `source_unavailable` with the literal message `"Source request failed"` — that is the exact loss of evidence the incident flagged. The classifier must preserve, on the thrown error's `details`: `httpStatus` (when there was a response), low-level `cause.code` and `cause.message`, the `page` number, the `detailUrl`/request URL, and the `phase` (`list` | `detail` | `bytes`). Never put response bodies or bytes in `details` (brief Phase 1 acceptance: no secrets, no raw bytes, no large HTML — keep only a short Cloudflare-marker boolean, not the body).

**Backoff.** Full jitter is the agreed best practice: `delay = random(0, min(cap, base * 2^attempt))`, `base ≈ 500ms`, `cap ≈ 30s`, bounded attempts (operator-configurable, default ~5). On `429`/`503` with a `Retry-After` header, wait that value plus small jitter (±10%) instead of the computed backoff. Backoff must compose *under* the existing pacing delay, not replace it — pacing keeps the steady-state polite; backoff handles spikes.

**Library decision: `p-retry` (vetted) over hand-rolled.** `p-retry` (sindresorhus, ESM-native, ~the standard) gives bounded attempts, exponential factor, min/max timeout, an `onFailedAttempt` hook (perfect for emitting a pino retry event), and `AbortError` to stop retrying on a permanent classification — which maps cleanly onto the transient/permanent split above (throw `AbortError` for permanent, throw normally for transient). It does **not** natively do full-jitter or `Retry-After`; supply those by computing the delay yourself in a small wrapper and using `p-retry` only for the attempt loop, OR hand-roll a ~30-line `retryWithBackoff(fn, opts)` helper. Recommendation: **hand-roll the tiny helper** rather than add a dependency — the policy (full jitter + `Retry-After` + the transient classifier) is the actual logic, `p-retry`'s loop is the trivial part, and a hand-rolled helper keeps the classifier, jitter, and `Retry-After` in one auditable typed unit with no new supply-chain surface. (If the team prefers a dependency, `p-retry` is the right one.) Either way the helper threads an `AbortSignal` from the per-request timeout (already present as the `AbortController` in both clients) so a retry can be cancelled.

**Pitfalls.**
- `error.cause` can itself be an `AggregateError` (happy-eyeballs dual-stack) — inspect `cause.errors[*].code`, not just `cause.code`, or you misclassify IPv6/IPv4 races as unknown.
- A 200 response with a Cloudflare challenge *body* is a false success — the JSON byte endpoint returning HTML is both a Cloudflare symptom and the exact contract regression Phase 5 guards. Classify by body shape, not status alone.
- The SSH transport (`createSshSourceClient`) classifies by string-matching `error.message` — keep that path but feed it the same typed-error shape so diagnostics are uniform across transports.
- Do not retry permanent contract failures — retrying a `missing_filename` 5× just multiplies source load for nothing and delays the run.

**Fits existing code + conventions.** Extend `SourceFetchError`/`ReplayByteFetchError` into the new `AppError` base (gap #1 above) so `details` carries the evidence. Widen the existing `DiscoveryDiagnostic` (`src/discovery/types.ts`) with optional `httpStatus`, `causeCode`, `phase`, and an `attempts` count — the diagnostic shape already has `code`, `page`, `sourceUrl`, `severity`, so this is an additive widening, not a new structure. The retry helper is a new `src/discovery/retry.ts` (or `src/source/`) factory with injected `sleep` (the codebase already injects `sleep` into pacing for deterministic tests). The `onFailedAttempt`/each-retry event is a pino `warn` (per §AA: upstream failures are diagnosable — log status + cause before the final raise).

---

## 2. Checkpoint and resume — THE key architectural question

**Recommendation: an S3 checkpoint/manifest object, written with conditional-write guards. Option (a).** This is the only option that gives true resume (skip *source reads*, not just durable writes), stays inside the accepted S3+staging boundary, and survives a fresh Kubernetes pod — all without a `server-2` schema change.

### Why the alternatives lose

**Option (b) — reconcile from existing S3 objects + staging rows (idempotent re-scan).** This is what v1 *already does* implicitly, and it is precisely the behavior the incident condemned. To know a page is "done" you must re-fetch that page's list HTML and every detail page to recompute candidates, then check each against S3/staging. That repeats the source reads — the single most expensive, most failure-prone, hours-consuming part of the run. The incident's two pods *did* avoid duplicate durable writes via this idempotency, and still wasted hours. Reconciliation also can't answer "what was the last *page* I finished" because S3 keys are `raw/sha256/<sha256>.ocap` (content-addressed) and staging rows key on source/object identity — neither records page progress. **Reject as the resume mechanism** (but keep it as the durable-write safety net it already is; checkpoints are an optimization layered on top, never the sole correctness guarantee).

**Option (c) — a dedicated checkpoint store (a new table / Redis / a checkpoint DB).** A new PostgreSQL table is a `server-2` schema change → a cross-app compatibility question and a boundary risk (the repo's hard rule: no business tables beyond `ingest_staging_records`). Redis/another datastore adds an operational dependency the service deliberately avoids (scheduled job, S3 + staging only). **Reject** unless the user/`server-2` explicitly wants a shared run-status table (flagged below).

### Why S3 wins and is now safe

S3 is already a hard dependency (`@aws-sdk/client-s3`), already the durable boundary, and — critically — **S3 added conditional writes (`If-None-Match` / `If-Match` on `PutObject`) in late 2024**, supported by the v3 SDK already in use. That removes the classic "two pods clobber the checkpoint" objection:

- Write the checkpoint with `IfMatch: <previous ETag>` (optimistic concurrency). A losing concurrent writer gets `412 PreconditionFailed` (SDK error `name === "PreconditionFailed"`), so the pod can re-read and merge instead of silently overwriting.
- Resume reads the object at start; if absent (first run), start at page 1.

**Checkpoint shape (one object, e.g. `checkpoints/<runId>.json`, plus a stable `checkpoints/full-run/latest.json` pointer the operator/retry reads):**

```
{
  runId, sourceUrl, startedAt, updatedAt,
  status: "in_progress" | "complete" | "partial" | "failed",
  discoveredLastPage,            // from dynamic-range discovery (area 3)
  lastCompletedPage,             // resume = lastCompletedPage + 1
  pages: { [page]: { status, candidateCount, stored, staged, conflict, failed, finishedAt } },
  counts: { discovered, stored, staged, duplicate, conflict, failed },
  failure?: { page, code, httpStatus, causeCode }  // last source failure
}
```

**Write cadence.** Update the checkpoint **once per completed page**, not per candidate — the run is already page-streamed (`run-once.ts` discovers→stores→stages a whole page before the next). A page is the natural, cheap, resumable unit (~30 candidates). Per-candidate checkpointing would 30× the S3 writes for negligible resume benefit (re-running one page on restart is cheap; re-running 129 pages is the incident). Mark a page `complete` only after all its candidates have a terminal raw+staging outcome. On the first source failure, flush a `partial`/`failed` checkpoint with the failing page recorded, then exit.

**Resume contract.** A new `--resume` flag (or auto-resume when a non-complete checkpoint for the configured source exists) reads `latest.json`, sets the start page to `lastCompletedPage + 1`, and continues to `discoveredLastPage`. Because pages are content-addressed and staging is idempotent, even if a page was *partially* done before the crash, re-running it from the checkpoint's `lastCompletedPage + 1` is safe — and re-running the single in-flight page (the one that wasn't marked complete) costs one page, not the whole corpus.

**Pitfalls.**
- Content-addressed S3 keys mean you *cannot* derive page progress from object listing — the checkpoint is the only place page progress lives. Don't try to reconstruct it from `ListObjectsV2`.
- Without conditional writes, a slow retry pod could overwrite a newer checkpoint. Always `IfMatch` the known ETag; on `412`, re-read and take the higher `lastCompletedPage`.
- §AB (resource lifecycle): per-run checkpoint objects accumulate forever. Either write only `latest.json` (single mutable object, bounded by construction) or define a retention note for `checkpoints/`. Recommend a single rolling `latest.json` per source plus the operator-facing summary — bounded by design, satisfies §AB.
- Keep the checkpoint free of secrets/bytes/HTML (same hygiene as diagnostics).
- A checkpoint is an *optimization*: if it is missing or corrupt, the run must fall back to a clean start (page 1) — never fail the run because the checkpoint failed to parse. Log and degrade (per §AA: record why before degrading).

**Fits existing code + conventions.** A new `src/checkpoint/` module with a factory contract `CheckpointStore { read(): Promise<Checkpoint | undefined>; write(cp, ifMatch?): Promise<{etag}> }`, an S3-backed implementation reusing the same `S3Client`/sender seam pattern as `src/storage/s3-raw-storage.ts` (which already does HEAD-before-PUT and `S3ServiceException` handling — conditional writes are the same SDK surface). `run-once.ts` gains a checkpoint dependency in its `RunOnceInput` map and calls `write` at each page boundary; the start-page loop bound changes from `1` to `resumeFromPage`. Zod-validate the parsed checkpoint before trusting it (config-validated-before-I/O discipline extends to durable inputs). Errors use the new typed-error base.

> **CROSS-APP FLAG (see final section):** the brief says checkpoint metadata depends on `server-2` defining "the full-run readiness report and any required staging evidence." An S3 checkpoint owned solely by the fetcher needs **no** `server-2` change. But if `server-2` wants run status/resume state visible in *its* APIs/tables, that is a shared-contract decision the user must confirm before this phase finalizes the checkpoint schema.

---

## 3. Dynamic source-range discovery + bounded concurrency + pacing + ETA

**Dynamic range — recommendation: stop-on-first-empty-page, with optional last-page detection as a fast-path.** The robust, source-agnostic rule is: keep fetching pages until a list page yields zero replay rows (`extractReplayRows` returns `[]`), then stop. This needs no assumption about the source's pagination widget and degrades gracefully as the corpus grows — directly killing the hardcoded `REPLAY_SOURCE_MAX_PAGES`. If the live page exposes a "last page" link/number, parse it as an *upper bound* to compute ETA and to detect a truncated run, but treat the empty-page stop as the source of truth (the live source returns 403 to naive fetches/Cloudflare-gates, so don't depend on scraping a pager widget that may not render). Keep `REPLAY_SOURCE_MAX_PAGES` as an *optional cap/safety valve* for partial runs and tests, not the normal driver.

**Bounded concurrency — recommendation: `p-limit`, operator-configurable, default low (2–4).** `p-limit` is the right tool: ~100M weekly downloads, ESM, a single function that caps N concurrent promises — exactly "fetch up to N detail/byte requests at once while staying polite." `p-queue` (priority queue, pause/resume, built-in rate-limit) is more than needed; `Bottleneck` is for hard third-party rate limits. Use `p-limit` for the **detail/byte fan-out within a page** (the ~30 detail fetches per list page are independent and dominate runtime), while keeping **list pages sequential** (page N+1's existence depends on page N being non-empty under the stop-on-empty rule, and sequential list reads preserve checkpoint page ordering). This is the highest-leverage change for the "too slow" finding: it parallelizes the per-row detail+byte work that the current `for … await` loop does strictly one at a time.

**Concurrency × retry/backoff interaction (pitfall-critical).**
- A global limiter (one `p-limit(n)` shared across the page's detail fetches) bounds concurrency; the retry helper sits *inside* each limited task, so backoff sleeps hold a slot — fine at small N, but pair a low default concurrency with the backoff so a source hiccup doesn't fan out N simultaneous retry storms.
- On a `429`/Cloudflare signal, the polite response is to *reduce* pressure: consider an optional adaptive step (halve effective concurrency or extend pacing for the rest of the run after repeated 429s). Keep this simple/optional for v1 of v2 — the must-have is bounded concurrency + per-request backoff; adaptive throttling is a nice-to-have.
- Concurrency must not break per-page checkpoint accounting: gather the page's results (`Promise.allSettled` over the limited tasks) and only then mark the page complete and checkpoint. Do not checkpoint mid-page.

**Pacing.** Keep the existing operator-configurable delay (`requestDelayMs`, default 2000ms in `discover.ts`) but make the default sane for a full corpus and apply it as a floor *between list pages* and as a minimum spacing within the concurrency limiter, not as a blanket 2s before every single request (2s × ~23.5k detail fetches alone is ~13 hours — that is the overnight job the finding calls out).

**ETA / rates.** Track `pagesCompleted`, `candidatesProcessed`, and elapsed wall-time; emit per-page (area 4): `pagesPerMinute`, `candidatesPerMinute`, and `etaRemaining = (discoveredLastPage − lastCompletedPage) / pagesPerMinute` (fall back to a rolling average when last page is unknown until the empty-page stop). Put the final discovered range and rates in the summary.

**Pitfalls.**
- Unbounded concurrency would hammer a Cloudflare-fronted source into 429/403 and *worsen* total time — bound it and keep the default conservative.
- Stop-on-empty must distinguish "empty page" (zero rows → end of corpus) from "fetch failed" (a source error → retry/checkpoint-fail, *not* end of corpus). Misclassifying a transient failure as the end would silently truncate the corpus. This is why area 1's transient-vs-permanent classifier must run *before* the empty-page check.
- ETA before last-page discovery is an estimate — label it as such; don't promise a hard finish time.

**Fits existing code + conventions.** `discover.ts` already centralizes the page loop and pacing (`createPacedSourceClient`, `toPageUrl`); replace the `1..maxPages` bound with a stop-on-empty loop and introduce `p-limit` for the per-page detail fan-out inside `discoverPageCandidates`. The rate/ETA counters extend the existing `DiscoveryReport.counts` and the `RunSummary` counts (`src/run/types.ts`). Concurrency level and request delay become Zod-validated config (`src/config.ts`) with bounded `min`/`max` (schema-quality rule: bound numeric ranges). Keep `no-await-in-loop` discipline — `p-limit` + `Promise.allSettled` replaces the in-loop `await`, satisfying the conventions' "independent async ops run concurrently" rule the current sequential loop technically violates.

---

## 4. Compact progress events + opt-in detailed evidence artifact

**Recommended approach.** Replace the single end-of-run `writeJson(summary)` with a pino event stream during the run + a slimmed final summary, and move per-candidate detail into an opt-in artifact. This is the area that *requires* introducing pino (baseline gap #2).

**Progress event schema (one pino line per page/batch, NDJSON).** Pino already emits NDJSON with `level`/`time`/`pid`/`hostname`/`msg`; add a structured payload via a child logger bound to `{ runId }`:

```
log.info({
  event: "page_complete", runId, page, lastCompletedPage, discoveredLastPage,
  pageCounts: { candidates, stored, skipped, staged, duplicate, conflict, failed },
  rates: { pagesPerMinute, candidatesPerMinute, etaSeconds },
}, "page complete")
```

Plus lower-frequency events: `run_start` (source url, resume-from), `retry` (`warn`: page, attempt, httpStatus, causeCode), `page_failed`/`source_unavailable` (`error`: page, classification, detailUrl), `run_complete`/`run_partial`. One line per page (~786 lines for the full corpus) is trivially greppable, versus the multi-MB single JSON the incident produced.

**Final summary — counts + failure categories only.** Keep `RunSummary` (`src/run/types.ts`) but **stop embedding the full `candidates`, `rawStorage`, and `staging` arrays in stdout** — those arrays are what bloat the log to megabytes at 23.5k candidates. The summary stdout becomes: run id, timestamps, source url, discovered range, the existing `counts`, `failureCategories`, the new `status` (complete/partial/failed/resumable — see below), and the recommended next action/`--resume` command. The detailed arrays move to the artifact.

**Run status as first-class (incident "partial success" finding).** Extend the summary with `status: "complete" | "partial" | "failed" | "resumable"` derived from: source ok + zero failure categories → complete; source failed mid-run but durable work landed → partial/resumable (include the resume command); config invalid / nothing useful → failed. This is the same data the checkpoint holds (area 2) — compute once, write to both. Exit codes stay as established (0 ok, 2 operational failure); a partial-but-resumable run still exits 2 so Kubernetes treats it as needing retry, but the summary now *tells the operator it is resumable and how*.

**Detailed evidence artifact — recommendation: opt-in S3 object (default off), with stdout as the only always-on surface.** The per-candidate evidence (`StoreRawReplayResult[]`, `IngestStagingResult[]`, full `candidates[]`, all diagnostics) is valuable for forensics but must not pollute pod logs. Options under the boundary:
- **S3 artifact (recommended, opt-in):** write `runs/<runId>/evidence.json` (or NDJSON) to the same bucket when `--emit-evidence` is set. Durable, inside the S3 boundary, retrievable by operators/`infrastructure`, and the natural home given the brief's "store detailed evidence in a durable artifact only when needed." Subject to §AB retention (note a `runs/` lifecycle/retention).
- **Local file:** simplest, but a fresh Kubernetes pod's filesystem is ephemeral (confirmed: `restartPolicy: Never` → new pod, no volume) — the artifact would vanish with the pod that produced it. Only useful for local/dev runs. Acceptable as a `--evidence-file <path>` convenience, not the durable default.
- **stdout-only:** rejected for *detailed* evidence — it is the exact bloat being removed. stdout carries progress events + the slim summary only.

Recommend: stdout = progress + slim summary (always); detailed evidence = opt-in S3 (`--emit-evidence`), local file as a dev convenience.

**Pitfalls.**
- pino to a worker-thread transport can lose buffered lines if the process exits hard; for a CLI/job, log to stdout synchronously (or `await` a flush before exit) so the final summary and last progress events aren't dropped on exit. Don't add a fancy transport — stdout NDJSON is the operational interface.
- Redaction: pino `redact` for any field that could carry the SSH command or db url; reuse the existing `redactConfig` posture. Never log raw bytes/HTML (Phase 4 acceptance).
- Don't double-report: if a line is an `error` progress event it should still flow into `failureCategories`/`status` — keep one source of truth (the run accumulator), with events as a projection of it.

**Fits existing code + conventions.** Introduce `src/logging/logger.ts` (`createLogger` factory, injected into the CLI dependency map and threaded as a child logger keyed by `runId`/`page`) — satisfies §Z/§AA (structured-only, state transitions logged, identifying context). `run-once.ts` emits a `page_complete` event at the existing page boundary where it already aggregates results. The slim-summary change edits `buildRunSummary` (`src/run/summary.ts`) to omit the heavy arrays from the stdout projection while the artifact writer (a new `src/evidence/` factory, S3-backed via the same sender seam) consumes the full arrays. `status` is a new field on `RunSummary` computed alongside `failureCategories`. The evidence artifact and checkpoint can share the S3 sender seam.

---

## 5. Source-contract guard tests + no-write operator contract check

**Recommended approach — `contract-check` CLI mode.** Add a new command (`replays-fetcher contract-check`, sibling to `check`) that fetches a *bounded* sample from the live source (e.g. page 1 + the first detail page + that replay's JSON data endpoint) and asserts the contract holds, writing **neither S3 nor PostgreSQL**. It is the live-source analogue of `check` (which probes connectivity) — `check` answers "can I reach S3/PG/source?", `contract-check` answers "does the source still parse the way the code assumes?".

**What it asserts (the contract that broke before):**
- List page → `extractReplayRows` returns ≥1 row with a `/replays/<id>` link and an `externalId`.
- Detail page → `extractFilenameFromDetailHtml` returns a filename (the `#filename` input, with the `body[data-ocap]` fallback) — *not* empty.
- **Raw bytes come from the JSON data endpoint, not the HTML detail page.** Assert that `toRawReplayUrl` (`/data/<filename>.json`) returns bytes that are valid JSON (parse the first bytes / check content-type), and that fetching the *HTML detail URL* as bytes would be wrong — this is the precise regression the finding calls out ("prove raw replay bytes are fetched from the JSON data endpoint, not the HTML detail page").
- Timestamp derivation → a discovered/replay timestamp is present and parseable where the source provides it (the Phase 6 `promotionEvidence.discoveredAt` evidence path).
- Negative cases as *warnings, not failures* against live data (missing external id, missing filename, duplicate filename, changed metadata) — surfaced as diagnostics so an operator sees contract drift without the check hard-failing on one bad row.

**Fixture coverage (unit, always-on in CI).** Keep/extend deterministic fixtures for: list page, detail page, raw JSON data endpoint, missing external id, missing filename, duplicate filename, changed metadata, timestamp derivation. The codebase already has the fixture seam — `discover.ts` parses a JSON `SourceFixture` when the source text is JSON, and `html.ts` parsing is unit-tested. v2 should add explicit golden fixtures for the *byte/JSON-endpoint* path (currently the byte client is tested for status handling, not for "the JSON endpoint vs HTML detail" distinction) so a regression that swaps the two fails a unit test, not just the live check.

**No-write proof.** `contract-check` must construct **no** `S3RawReplayStorage`, **no** staging repository, and call **no** `storeRawReplay`/`stageRawReplay`. Prove it the way the repo already proves dry-run safety (per STATE.md Phase 02: "test and docs guards against S3, PostgreSQL, parser artifact … mutation surfaces"): a test asserts the command's dependency wiring never instantiates the S3/PG factories, and the command only uses `SourceClient`/`ReplayByteClient` reads. It may reuse the existing `discoverReplaysDryRun` read path (already non-mutating) plus a single byte read of the JSON endpoint.

**Pitfalls.**
- A live contract check is itself a source request → it must use the *same* retry/classification (area 1), or a transient Cloudflare 403 makes `contract-check` flap. Distinguish "contract broken" (exit non-zero, actionable) from "source transiently unreachable" (a different, retryable signal) in the output — don't report a network blip as a contract regression.
- The byte/JSON assertion should check structure cheaply (valid JSON, non-HTML), not parse the full OCAP — parsing replay contents is the hard boundary owned by `replay-parser-2`. "Is this JSON and not an HTML error page" is the line.
- Keep the live sample tiny (one page, one detail, one JSON) to stay polite and fast.

**Fits existing code + conventions.** New command registered in `src/cli.ts` alongside `registerCheckCommand`, reusing `createSourceClient`/`createReplayByteClient` and `discoverReplaysDryRun`. Assertions live in a `src/contract/` factory returning a typed `ContractCheckReport` (mirror the `DiscoveryReport`/connectivity-check shapes). Reuses the diagnostic taxonomy from area 1 for drift warnings. No new infra; it is a read-only composition of seams that already exist.

---

## 6th candidate (brief assessment): CI guard against re-introducing rollout wiring

**Belongs to this repo's CI, lightly.** The finding wants a guard that fails CI if app workflows reintroduce `kubectl`, staging-SSH, or Kubernetes-Secret mutation — because `infrastructure` now owns manifests/secrets/rollout and the app owns verify + image publish only. This is **app-repo scope** (it guards *this repo's* `.github/workflows`), and it is cheap: a small CI step (a grep/lint over workflow YAML for `kubectl`, `ssh … apply`, `kubernetes secret` patterns) that fails the build on a match. It is **not** an `infrastructure`-owned concern — infra can't guard what lands in the app repo's workflows. Keep it tiny and out of the application source (it is a CI/policy check, not a feature), and lower priority than areas 1–5. It does not touch any cross-app contract, so it needs no `server-2`/`web` coordination. Recommend: a single dedicated phase or a task folded into the Phase 5 "guards" theme, implemented as a workflow-lint CI step, not TypeScript.

---

## Open cross-app questions for the user

1. **Checkpoint ownership (highest priority — gates the Phase 2 design).** The recommended S3 checkpoint object is owned solely by the fetcher and needs **no** `server-2` change. But the brief states checkpoint metadata "depends on `server-2` defining the full-run readiness report and any required staging evidence." **Confirm:** does `server-2` need full-run status/resume state surfaced in *its* tables/APIs (which would be a shared contract and a boundary decision), or is an internal S3 checkpoint that `server-2` never reads acceptable? If the former, the checkpoint schema must be co-designed before Phase 2 finalizes — this is a risk-based-compatibility cross-app question, not a fetcher-local change.

2. **Staging evidence additions.** If v2 wants `status`/`partial`/`resume` or page-progress evidence written into `ingest_staging_records` rows (vs. only the S3 checkpoint), that mutates the staging contract and requires `server-2` sign-off. Recommendation: keep run/resume state in the S3 checkpoint and leave `ingest_staging_records` unchanged — confirm this is acceptable.

3. **S3 `runs/` and `checkpoints/` retention (§AB).** New durable artifacts (checkpoint objects, opt-in evidence artifacts) accumulate in the same bucket `infrastructure`/`server-2` manage. Confirm who owns their lifecycle/retention policy (recommend a single rolling `latest.json` per source to bound the checkpoint by construction, plus a retention note for `runs/` evidence).

4. **Concurrency politeness ceiling.** Bounded concurrency against the Cloudflare-fronted `sg.zone` source has an unknown safe ceiling (the live source already 403s naive fetches). Confirm an operator-acceptable default concurrency and whether adaptive throttling on repeated 429/403 is in scope for this milestone or deferred.

5. **Maximum acceptable full-corpus runtime.** The findings' reader-test asks "what is the maximum acceptable runtime for a full corpus?" — this is a requirement input the user must set; it drives the default concurrency, pacing floor, and whether adaptive throttling is mandatory.
