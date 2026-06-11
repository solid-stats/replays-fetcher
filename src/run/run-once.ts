/* eslint-disable max-lines -- the run-once orchestrator keeps the page loop, resume/checkpoint wiring, and the per-page checkpoint builders co-located so the ingest cycle reads as one unit. */
import { createLimiter, type LimitFunction } from "../source/concurrency.js";
import { createPacer, type Pacer } from "../source/pacing.js";
import {
  createThrottleController,
  type ThrottleController,
} from "../source/throttle.js";

import {
  buildRunSummary,
  deriveRunStatus,
  deriveSourceFailure,
  runExitCode,
} from "./summary.js";

import type { RunExitCode, RunSourceFailure, RunSummary } from "./types.js";
import type { Checkpoint, CheckpointPage } from "../checkpoint/checkpoint.js";
import type { S3CheckpointStore } from "../checkpoint/s3-checkpoint-store.js";
import type {
  DiscoveryDiagnostic,
  DiscoveryReport,
  ReplayCandidate,
  SourceClient,
} from "../discovery/types.js";
import type { RetryAttemptEvent } from "../source/retry.js";
import type { StagingRepository } from "../staging/stage-raw-replay.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { ReplayByteClient } from "../storage/replay-byte-client.js";
import type { S3RawReplayStorage } from "../storage/s3-raw-storage.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import type { Logger } from "pino";

interface RunOnceInput {
  readonly attempts?: number;
  readonly byteClient: ReplayByteClient;
  readonly checkpointStore: S3CheckpointStore;
  readonly concurrency: number;
  readonly createLimiter?: (concurrency: number) => LimitFunction;
  readonly createPacer?: (spacingMs: number) => Pacer;
  readonly createThrottle?: (options: {
    readonly baseConcurrency: number;
    readonly baseSpacingMs: number;
    readonly max: number;
    readonly min: number;
  }) => ThrottleController;
  readonly discoverReplays: (input: {
    readonly attempts?: number;
    readonly maxPages?: number;
    readonly onRetry?: (event: RetryAttemptEvent) => void;
    readonly requestDelayMs?: number;
    readonly sourceClient: SourceClient;
    readonly sourceUrl: URL;
  }) => Promise<DiscoveryReport>;
  readonly log?: Logger;
  readonly maxPages?: number;
  readonly now: () => Date;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly requestSpacingMs: number;
  readonly resume?: boolean;
  readonly runId: string;
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
  readonly stageRawReplay: (input: {
    readonly rawResult: StoreRawReplayResult;
    readonly repository: StagingRepository;
    readonly runId?: string;
  }) => Promise<IngestStagingResult>;
  readonly stagingRepository: StagingRepository;
  readonly storage: S3RawReplayStorage;
  readonly storeRawReplay: (input: {
    readonly byteClient: ReplayByteClient;
    readonly candidate: ReplayCandidate;
    readonly storage: S3RawReplayStorage;
  }) => Promise<StoreRawReplayResult>;
}

export interface RunOnceResult {
  readonly exitCode: RunExitCode;
  readonly summary: RunSummary;
}

interface MutableDiscoveryReport {
  candidates: ReplayCandidate[];
  counts: DiscoveryReport["counts"];
  diagnostics: DiscoveryDiagnostic[];
  generatedAt: string;
  mode: "dry-run";
  ok: boolean;
  sourceUrl: string;
}

const FIRST_PAGE = 1;
const CONCURRENCY_FLOOR = 1;
const MS_PER_MINUTE = 60_000;
const LAST_TIMESTAMP_INDEX = -1;
const RESUME_INVOCATION = "replays-fetcher run-once --resume";

export async function runOnce(input: RunOnceInput): Promise<RunOnceResult> {
  const startedAt = input.now().toISOString();
  // The slug is persisted in the checkpoint body and reaches promotion_evidence;
  // strip any userinfo (user:pass@host) so credentials never land in a durable
  // artifact (WR-02 / threat T-09-01).
  const slug = sanitizeSourceUrl(input.sourceUrl);
  const discoveryReport = emptyDiscoveryReport(slug);
  const rawStorage: StoreRawReplayResult[] = [];
  const staging: IngestStagingResult[] = [];
  // RANGE-01: the loop bound is now an OPTIONAL safety-valve cap. With
  // `maxPages` unset the loop is unbounded and governed by stop-on-empty (an
  // `ok` page with zero candidates) or a `!ok` page classification.
  const maxPages = input.maxPages ?? Number.POSITIVE_INFINITY;

  // The shared limiter is the single global in-flight governor (RANGE-02); the
  // AIMD throttle resizes its `.concurrency` on rate-limited/clean pages
  // (RANGE-03); the pacer enforces the inter-page floor (RANGE-04).
  const { limit, pacer, throttle } = buildRunRuntime(input);
  const pageTimestampsMs: number[] = [];

  const resumeState = await resolveResumeState(input, slug);
  const pages: Record<string, CheckpointPage> = { ...resumeState.pages };
  let lastCompletedPage = resumeState.startPage - FIRST_PAGE;
  // The ETag is a moving cursor: each write returns the object's NEW ETag, which
  // the NEXT write must use for its IfMatch precondition. Reusing the start ETag
  // for every write would 412 on page 2..N and lose the final `complete` status
  // through a merge tie-break (CR-01).
  let { etag } = resumeState;

  for (let page = resumeState.startPage; page <= maxPages; page += 1) {
    // RANGE-04 list-page floor: await the pacer's remaining floor BEFORE each
    // sequential list read (never compounded with withRetry backoff).
    // eslint-disable-next-line no-await-in-loop
    await pacer.awaitFloor();
    const pageUrl = toPageUrl(input.sourceUrl, page);
    // Each page is discovered, stored, and staged before moving on so parser work can run in parallel.
    // eslint-disable-next-line no-await-in-loop
    const pageReport = await input.discoverReplays(
      buildDiscoverInput(input, pageUrl),
    );
    appendDiscoveryReport(discoveryReport, pageReport);

    // RANGE-06: classify BEFORE the stop-on-empty decision so a transient/
    // rate-limited page is never mistaken for end-of-corpus (the 2026-05-11
    // silent-truncation trap). A `!ok` page resolves its status via
    // `deriveRunStatus` (resumable/partial/failed) and stops the loop.
    if (!pageReport.ok) {
      applyRateLimitThrottle(input, { limit, pageReport, throttle });
      break;
    }

    // RANGE-01 end-of-corpus: only an `ok` page with zero candidates stops the
    // loop as `complete`.
    if (pageReport.candidates.length === 0) {
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    etag = await completeOkPage(input, {
      candidates: pageReport.candidates,
      etag,
      limit,
      page,
      pageTimestampsMs,
      pages,
      rawStorage,
      slug,
      staging,
      startedAt,
      throttle,
    });
    lastCompletedPage = page;
  }

  return assembleResult(input, {
    discoveryReport,
    etag,
    lastCompletedPage,
    pageTimestampsMs,
    pages,
    rawStorage,
    slug,
    staging,
    startedAt,
  });
}

interface RunRuntime {
  readonly limit: LimitFunction;
  readonly pacer: Pacer;
  readonly throttle: ThrottleController;
}

/**
 * Builds the per-run rate-limiting runtime: the single shared limiter (RANGE-02),
 * the AIMD throttle that resizes it (RANGE-03), and the inter-page pacer floor
 * (RANGE-04). Each seam is injectable so tests can observe the throttle/pacer
 * interactions and the limiter's `.concurrency` lever.
 */
function buildRunRuntime(input: RunOnceInput): RunRuntime {
  const limit = (input.createLimiter ?? createLimiter)(input.concurrency);
  const throttle = (input.createThrottle ?? createThrottleController)({
    baseConcurrency: input.concurrency,
    baseSpacingMs: input.requestSpacingMs,
    max: input.concurrency,
    min: CONCURRENCY_FLOOR,
  });
  const pacer = (input.createPacer ?? defaultPacer)(input.requestSpacingMs);

  return { limit, pacer, throttle };
}

interface CompleteOkPageInput {
  readonly candidates: readonly ReplayCandidate[];
  readonly etag: string | undefined;
  readonly limit: LimitFunction;
  readonly page: number;
  readonly pageTimestampsMs: number[];
  readonly pages: Record<string, CheckpointPage>;
  readonly rawStorage: StoreRawReplayResult[];
  readonly slug: string;
  readonly staging: IngestStagingResult[];
  readonly startedAt: string;
  readonly throttle: ThrottleController;
}

/**
 * Completes a clean (`ok`, non-empty) list page: AIMD additive-increase grows the
 * shared limiter back toward base concurrency (RANGE-03), the store→stage fan-out
 * runs over the shared limiter, the injected-clock completion timestamp is
 * captured (Pitfall 7), the minimal per-page rate line is emitted (RANGE-05), and
 * the checkpoint is written only AFTER the fan-out is gathered (Phase 9 ordering).
 * Returns the new checkpoint ETag for the next write's IfMatch cursor.
 */
async function completeOkPage(
  input: RunOnceInput,
  context: CompleteOkPageInput,
): Promise<string | undefined> {
  // RANGE-03 AIMD additive-increase: a clean content page lets the throttle
  // recover and grows the shared limiter back toward its base concurrency.
  context.throttle.onCleanWindow(input.now().getTime());
  context.limit.concurrency = context.throttle.effectiveConcurrency;

  const pageCounts = await processPage(input, {
    candidates: context.candidates,
    limit: context.limit,
    rawStorage: context.rawStorage,
    staging: context.staging,
  });

  // Capture the page-completion timestamp from the injected clock (never
  // `Date.now()`) so the per-page rate and Wave-3 summary metrics are
  // deterministic (Pitfall 7).
  context.pageTimestampsMs.push(input.now().getTime());
  emitPageRateLine(input, context.page, context.pageTimestampsMs);

  // Checkpoint is written only after the per-candidate fan-out completes — never mid-page.
  context.pages[String(context.page)] = {
    counts: pageCounts,
    status: "running",
  };

  return writePageCheckpoint(input, {
    etag: context.etag,
    lastCompletedPage: context.page,
    pages: context.pages,
    slug: context.slug,
    startedAt: context.startedAt,
  });
}

/**
 * RANGE-03 multiplicative-decrease trigger. A `!ok` page whose diagnostic the
 * shared classifier (`deriveSourceFailure`) maps to `rate_limited` shrinks the
 * shared limiter's effective concurrency via the AIMD controller. Transient and
 * permanent failures do NOT resize the limiter — they only resolve the run
 * status downstream — so a single hiccup never over-throttles. The classifier
 * runs here, BEFORE the loop breaks, preserving RANGE-06 ordering.
 */
function applyRateLimitThrottle(
  input: RunOnceInput,
  context: {
    readonly limit: LimitFunction;
    readonly pageReport: DiscoveryReport;
    readonly throttle: ThrottleController;
  },
): void {
  const failure = deriveSourceFailure(context.pageReport);

  if (failure?.classification === "rate_limited") {
    context.throttle.onRateLimited(input.now().getTime());
    context.limit.concurrency = context.throttle.effectiveConcurrency;
  }
}

/**
 * Emits ONE minimal, identifiers-only per-page rate line (RANGE-05) on each
 * completed page: the page number plus the running `pagesPerMinute` derived from
 * the injected-clock timestamps. No bytes/HTML/secret/URL ever reaches this line
 * — the rich greppable `page_complete` taxonomy is deferred to Phase 11.
 */
function emitPageRateLine(
  input: RunOnceInput,
  page: number,
  pageTimestampsMs: readonly number[],
): void {
  input.log?.info(
    { page, pagesPerMinute: derivePagesPerMinute(pageTimestampsMs) },
    "page rate",
  );
}

/**
 * Pure rolling page rate: pages completed per minute over the elapsed window
 * between the first and last captured page timestamp. A single-page window has
 * no elapsed time, so it is floored to `Number.EPSILON` minutes to avoid a
 * divide-by-zero; the same derivation feeds the Wave-3 summary metric so there
 * is one rate source, not two. An empty window has no completed pages, so the
 * rate is 0 (the helper is exported so Wave 3's summary reuses this one rate
 * derivation rather than re-implementing it).
 */
export function derivePagesPerMinute(
  pageTimestampsMs: readonly number[],
): number {
  const first = pageTimestampsMs.at(0);
  const last = pageTimestampsMs.at(LAST_TIMESTAMP_INDEX);
  if (first === undefined || last === undefined) {
    return 0;
  }

  const minutes = Math.max((last - first) / MS_PER_MINUTE, Number.EPSILON);

  return pageTimestampsMs.length / minutes;
}

function defaultPacer(spacingMs: number): Pacer {
  return createPacer({ spacingMs });
}

/**
 * Normalize the source URL for durable persistence: drop any `username`/
 * `password` userinfo so an operator-supplied `https://user:pass@host/...`
 * never leaks credentials into the checkpoint body or promotion_evidence
 * (WR-02, threat T-09-01). Identity (host + path + query) is preserved.
 */
function sanitizeSourceUrl(sourceUrl: URL): string {
  const cleaned = new URL(sourceUrl);
  cleaned.username = "";
  cleaned.password = "";

  return cleaned.toString();
}

interface ProcessPageInput {
  readonly candidates: readonly ReplayCandidate[];
  readonly limit: LimitFunction;
  readonly rawStorage: StoreRawReplayResult[];
  readonly staging: IngestStagingResult[];
}

interface SettledCandidate {
  readonly index: number;
  readonly rawResult: StoreRawReplayResult;
  readonly stagingResult: IngestStagingResult;
}

/**
 * RANGE-02/06: fan the per-candidate store→stage sequence out over the single
 * shared limiter and gather with `Promise.allSettled`, then re-order the
 * fulfilled values by their captured candidate index BEFORE any tally or
 * checkpoint so evidence ordering stays deterministic and race-free regardless
 * of completion order. Operational outcomes (`failed`/`conflict`/`not_stageable`)
 * are returned as result objects and tallied; a REJECTED settle is a programmer
 * error (`storeRawReplay` rethrows non-`ReplayByteFetchError`, `repository.stage`
 * can reject on a raw DB error) and is rethrown — preserving the Phase 5
 * operational-vs-programmer boundary (A3 RESOLVED).
 */
async function processPage(
  input: RunOnceInput,
  page: ProcessPageInput,
): Promise<MutablePageCounts> {
  const pageCounts = newPageCounts(page.candidates.length);

  const settled = await Promise.allSettled(
    page.candidates.map((candidate, index) =>
      page.limit(async (): Promise<SettledCandidate> => {
        const rawResult = await input.storeRawReplay({
          byteClient: input.byteClient,
          candidate,
          storage: input.storage,
        });
        const stagingResult = await input.stageRawReplay({
          rawResult,
          repository: input.stagingRepository,
          runId: input.runId,
        });

        return { index, rawResult, stagingResult };
      }),
    ),
  );

  rethrowProgrammerError(settled);

  for (const value of fulfilledInOrder(settled)) {
    page.rawStorage.push(value.rawResult);
    tallyRawResult(pageCounts, value.rawResult);
    page.staging.push(value.stagingResult);
    tallyStagingResult(pageCounts, value.stagingResult);
  }

  return pageCounts;
}

/**
 * A rejected `Promise.allSettled` settle is a programmer error (never an
 * operational fetch/storage/staging failure, which returns a result object), so
 * rethrow its reason instead of silently dropping the candidate.
 */
function rethrowProgrammerError(
  settled: readonly PromiseSettledResult<SettledCandidate>[],
): void {
  for (const result of settled) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }
}

function fulfilledInOrder(
  settled: readonly PromiseSettledResult<SettledCandidate>[],
): readonly SettledCandidate[] {
  return settled
    .filter(
      (result): result is PromiseFulfilledResult<SettledCandidate> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .toSorted((left, right) => left.index - right.index);
}

interface ResumeState {
  readonly etag?: string;
  readonly pages: Record<string, CheckpointPage>;
  readonly startPage: number;
}

async function resolveResumeState(
  input: RunOnceInput,
  slug: string,
): Promise<ResumeState> {
  const read = await input.checkpointStore.read(slug);
  const { checkpoint } = read;

  if (checkpoint === undefined) {
    input.log?.warn(
      { slug },
      "checkpoint missing or corrupt; starting a clean page-1 run",
    );

    return { startPage: FIRST_PAGE, pages: {} };
  }

  if (checkpoint.status === "complete") {
    // Both paths produce a clean page-1 start, but the distinction is observable
    // (CR-02): an explicit `--resume` is an intentional re-run of a finished
    // corpus, while a scheduled run auto-skips. `input.resume` is consulted here
    // so the flag is a live contract, not a dead parameter.
    if (input.resume === true) {
      input.log?.info(
        { slug },
        "explicit --resume on a complete checkpoint; re-running the full corpus from page 1",
      );
    } else {
      input.log?.info(
        { slug },
        "complete checkpoint auto-resumed; starting a clean page-1 run",
      );
    }

    return startFresh(read.etag);
  }

  return resumeFrom(read.etag, checkpoint);
}

function startFresh(etag: string | undefined): ResumeState {
  if (etag === undefined) {
    return { startPage: FIRST_PAGE, pages: {} };
  }

  return { etag, startPage: FIRST_PAGE, pages: {} };
}

function resumeFrom(
  etag: string | undefined,
  checkpoint: Checkpoint,
): ResumeState {
  const startPage = checkpoint.lastCompletedPage + FIRST_PAGE;
  if (etag === undefined) {
    return { startPage, pages: { ...checkpoint.pages } };
  }

  return { etag, startPage, pages: { ...checkpoint.pages } };
}

interface WritePageCheckpointInput {
  readonly etag: string | undefined;
  readonly lastCompletedPage: number;
  readonly pages: Record<string, CheckpointPage>;
  readonly slug: string;
  readonly startedAt: string;
}

async function writePageCheckpoint(
  input: RunOnceInput,
  page: WritePageCheckpointInput,
): Promise<string | undefined> {
  const checkpoint = buildCheckpoint(input, {
    lastCompletedPage: page.lastCompletedPage,
    pages: page.pages,
    slug: page.slug,
    startedAt: page.startedAt,
    status: "running",
  });

  try {
    const result = await input.checkpointStore.write(
      writeInput(page.slug, checkpoint, page.etag),
    );

    // Carry the object's new ETag forward so the next write's IfMatch matches
    // the current object instead of 412-ing on a stale start ETag (CR-01).
    return result.etag;
  } catch {
    // A transient (non-precondition) checkpoint-write error must never fail the
    // run. The ETag is unchanged on failure, so reuse the one we held.
    input.log?.warn(
      { page: page.lastCompletedPage, slug: page.slug },
      "checkpoint write failed; continuing run",
    );

    return page.etag;
  }
}

function writeInput(
  slug: string,
  checkpoint: Checkpoint,
  etag: string | undefined,
): { checkpoint: Checkpoint; etag?: string; slug: string } {
  if (etag === undefined) {
    return { checkpoint, slug };
  }

  return { checkpoint, etag, slug };
}

interface AssembleResultInput {
  readonly discoveryReport: MutableDiscoveryReport;
  readonly etag: string | undefined;
  readonly lastCompletedPage: number;
  // Per-page completion timestamps (injected clock, ms) carried for Wave 3's
  // summary rate/ETA derivation. This plan captures and threads the data; the
  // summary-field derivation lands in Plan 05.
  readonly pageTimestampsMs: readonly number[];
  readonly pages: Record<string, CheckpointPage>;
  readonly rawStorage: readonly StoreRawReplayResult[];
  readonly slug: string;
  readonly staging: readonly IngestStagingResult[];
  readonly startedAt: string;
}

async function assembleResult(
  input: RunOnceInput,
  context: AssembleResultInput,
): Promise<RunOnceResult> {
  const sourceFailure = deriveSourceFailure(context.discoveryReport);
  const discoveredLastPage = deriveDiscoveredLastPage(context);
  const status = deriveRunStatus({
    discoveredLastPage,
    lastCompletedPage: context.lastCompletedPage,
    ok: context.discoveryReport.ok,
    ...sourceFailureOption(sourceFailure),
  });

  if (status === "complete") {
    await writeFinalCheckpoint(input, context, discoveredLastPage);
  }

  const summary = buildRunSummary({
    candidateCount: context.discoveryReport.candidates.length,
    discoveredLastPage,
    discoveryReport: context.discoveryReport,
    finishedAt: input.now().toISOString(),
    lastCompletedPage: context.lastCompletedPage,
    pageTimestampsMs: context.pageTimestampsMs,
    rawStorage: context.rawStorage,
    runId: input.runId,
    staging: context.staging,
    startedAt: context.startedAt,
    status,
    ...discoveredRangeOption(context.lastCompletedPage),
    ...resumeInvocationOption(status),
  });

  return {
    exitCode: runExitCode(summary),
    summary,
  };
}

/**
 * A clean run completes every page it attempts, so `discoveredLastPage` equals
 * the last completed page. A broken page sets `ok=false`; the failed page is one
 * past the last completed page, so `discoveredLastPage` outruns it and the run
 * status is never `complete`.
 */
function deriveDiscoveredLastPage(context: AssembleResultInput): number {
  if (context.discoveryReport.ok) {
    return context.lastCompletedPage;
  }

  return context.lastCompletedPage + FIRST_PAGE;
}

function sourceFailureOption(sourceFailure: RunSourceFailure | undefined): {
  sourceFailure?: RunSourceFailure;
} {
  if (sourceFailure === undefined) {
    return {};
  }

  return { sourceFailure };
}

function resumeInvocationOption(status: RunSummary["status"]): {
  resumeInvocation?: string;
} {
  if (status === "complete") {
    return {};
  }

  return { resumeInvocation: RESUME_INVOCATION };
}

/**
 * RANGE-05: the discovered source range spans page 1 to the last completed page,
 * present only when at least one page completed (additive spread; omitted
 * otherwise so the summary shape stays exact-optional safe).
 */
function discoveredRangeOption(lastCompletedPage: number): {
  discoveredRange?: { readonly firstPage: number; readonly lastPage: number };
} {
  if (lastCompletedPage < FIRST_PAGE) {
    return {};
  }

  return {
    discoveredRange: { firstPage: FIRST_PAGE, lastPage: lastCompletedPage },
  };
}

async function writeFinalCheckpoint(
  input: RunOnceInput,
  context: AssembleResultInput,
  discoveredLastPage: number,
): Promise<void> {
  const checkpoint = buildCheckpoint(input, {
    discoveredLastPage,
    lastCompletedPage: context.lastCompletedPage,
    pages: context.pages,
    slug: context.slug,
    startedAt: context.startedAt,
    status: "complete",
  });

  try {
    // The final complete-checkpoint write uses the LATEST ETag carried through
    // the page loop, not the stale start ETag, so it lands as `status:
    // "complete"` without a spurious 412 + merge that would downgrade it to
    // `running` (CR-01).
    await input.checkpointStore.write(
      writeInput(context.slug, checkpoint, context.etag),
    );
  } catch {
    input.log?.warn(
      { slug: context.slug },
      "final checkpoint write failed; continuing run",
    );
  }
}

interface BuildCheckpointInput {
  readonly discoveredLastPage?: number;
  readonly lastCompletedPage: number;
  readonly pages: Record<string, CheckpointPage>;
  readonly slug: string;
  readonly startedAt: string;
  readonly status: Checkpoint["status"];
}

function buildCheckpoint(
  input: RunOnceInput,
  context: BuildCheckpointInput,
): Checkpoint {
  const updatedAt = input.now().toISOString();
  const checkpoint: {
    -readonly [Key in keyof Checkpoint]: Checkpoint[Key];
  } = {
    counts: aggregatePageCounts(context.pages),
    createdAt: context.startedAt,
    discoveredLastPage: context.discoveredLastPage ?? context.lastCompletedPage,
    lastCompletedPage: context.lastCompletedPage,
    pages: context.pages,
    runId: input.runId,
    sourceUrl: context.slug,
    status: context.status,
    updatedAt,
  };

  return checkpoint;
}

function aggregatePageCounts(
  pages: Record<string, CheckpointPage>,
): Checkpoint["counts"] {
  let counts = { discovered: 0, failed: 0, staged: 0, stored: 0 };

  for (const page of Object.values(pages)) {
    counts = {
      discovered: counts.discovered + page.counts.discovered,
      failed: counts.failed + page.counts.failed,
      staged: counts.staged + page.counts.staged,
      stored: counts.stored + page.counts.stored,
    };
  }

  return counts;
}

interface MutablePageCounts {
  discovered: number;
  failed: number;
  staged: number;
  stored: number;
}

function newPageCounts(discovered: number): MutablePageCounts {
  return { discovered, failed: 0, staged: 0, stored: 0 };
}

function tallyRawResult(
  counts: MutablePageCounts,
  result: StoreRawReplayResult,
): void {
  if (result.status === "stored") {
    counts.stored += 1;

    return;
  }

  if (result.status === "failed") {
    counts.failed += 1;
  }
}

function tallyStagingResult(
  counts: MutablePageCounts,
  result: IngestStagingResult,
): void {
  if (result.status === "staged") {
    counts.staged += 1;

    return;
  }

  if (result.status === "failed") {
    counts.failed += 1;
  }
}

function buildDiscoverInput(
  input: RunOnceInput,
  pageUrl: URL,
): {
  readonly attempts?: number;
  readonly maxPages?: number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
} {
  let discoverInput: {
    attempts?: number;
    maxPages?: number;
    onRetry?: (event: RetryAttemptEvent) => void;
    sourceClient: SourceClient;
    sourceUrl: URL;
  } = {
    maxPages: 1,
    sourceClient: input.sourceClient,
    sourceUrl: pageUrl,
  };

  if (input.attempts !== undefined) {
    discoverInput = { ...discoverInput, attempts: input.attempts };
  }

  if (input.onRetry !== undefined) {
    discoverInput = { ...discoverInput, onRetry: input.onRetry };
  }

  return discoverInput;
}

function emptyDiscoveryReport(sourceUrl: string): MutableDiscoveryReport {
  return {
    candidates: [],
    counts: {
      candidates: 0,
      diagnostics: 0,
      discovered: 0,
    },
    diagnostics: [],
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    ok: true,
    sourceUrl,
  };
}

function appendDiscoveryReport(
  target: MutableDiscoveryReport,
  pageReport: DiscoveryReport,
): void {
  target.candidates.push(...pageReport.candidates);
  target.diagnostics.push(...pageReport.diagnostics);
  target.counts = {
    candidates: target.candidates.length,
    diagnostics: target.diagnostics.length,
    discovered: target.candidates.length,
  };
  target.ok &&= pageReport.ok;
}

function toPageUrl(sourceUrl: URL, page: number): URL {
  if (page === 1) {
    return sourceUrl;
  }

  const pageUrl = new URL(sourceUrl);
  pageUrl.searchParams.set("p", String(page));

  return pageUrl;
}
