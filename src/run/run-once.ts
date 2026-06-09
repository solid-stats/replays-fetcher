/* eslint-disable max-lines -- the run-once orchestrator keeps the page loop, resume/checkpoint wiring, and the per-page checkpoint builders co-located so the ingest cycle reads as one unit. */
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
const RESUME_INVOCATION = "replays-fetcher run-once --resume";

export async function runOnce(input: RunOnceInput): Promise<RunOnceResult> {
  const startedAt = input.now().toISOString();
  const slug = input.sourceUrl.toString();
  const discoveryReport = emptyDiscoveryReport(slug);
  const rawStorage: StoreRawReplayResult[] = [];
  const staging: IngestStagingResult[] = [];
  const maxPages = input.maxPages ?? FIRST_PAGE;

  const resumeState = await resolveResumeState(input, slug);
  const pages: Record<string, CheckpointPage> = { ...resumeState.pages };
  let lastCompletedPage = resumeState.startPage - FIRST_PAGE;

  for (let page = resumeState.startPage; page <= maxPages; page += 1) {
    const pageUrl = toPageUrl(input.sourceUrl, page);
    // Each page is discovered, stored, and staged before moving on so parser work can run in parallel.
    // eslint-disable-next-line no-await-in-loop
    const pageReport = await input.discoverReplays(
      buildDiscoverInput(input, pageUrl),
    );
    appendDiscoveryReport(discoveryReport, pageReport);

    if (!pageReport.ok) {
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    const pageCounts = await processPage(input, {
      candidates: pageReport.candidates,
      rawStorage,
      staging,
    });

    // Checkpoint is written only after the per-candidate loop completes — never mid-page.
    lastCompletedPage = page;
    pages[String(page)] = { counts: pageCounts, status: "running" };
    // eslint-disable-next-line no-await-in-loop
    await writePageCheckpoint(input, {
      etag: resumeState.etag,
      lastCompletedPage: page,
      pages,
      slug,
      startedAt,
    });
  }

  return assembleResult(input, {
    discoveryReport,
    lastCompletedPage,
    pages,
    rawStorage,
    resumeState,
    slug,
    staging,
    startedAt,
  });
}

interface ProcessPageInput {
  readonly candidates: readonly ReplayCandidate[];
  readonly rawStorage: StoreRawReplayResult[];
  readonly staging: IngestStagingResult[];
}

async function processPage(
  input: RunOnceInput,
  page: ProcessPageInput,
): Promise<MutablePageCounts> {
  const pageCounts = newPageCounts(page.candidates.length);

  for (const candidate of page.candidates) {
    // Scheduled runs process candidates sequentially for source/storage/staging evidence.
    // eslint-disable-next-line no-await-in-loop
    const rawResult = await input.storeRawReplay({
      byteClient: input.byteClient,
      candidate,
      storage: input.storage,
    });
    page.rawStorage.push(rawResult);
    tallyRawResult(pageCounts, rawResult);

    // Staging keeps one outcome per raw result, including non-stageable failures.
    // eslint-disable-next-line no-await-in-loop
    const stagingResult = await input.stageRawReplay({
      rawResult,
      repository: input.stagingRepository,
      runId: input.runId,
    });
    page.staging.push(stagingResult);
    tallyStagingResult(pageCounts, stagingResult);
  }

  return pageCounts;
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
): Promise<void> {
  const checkpoint = buildCheckpoint(input, {
    lastCompletedPage: page.lastCompletedPage,
    pages: page.pages,
    slug: page.slug,
    startedAt: page.startedAt,
    status: "running",
  });

  try {
    await input.checkpointStore.write(
      writeInput(page.slug, checkpoint, page.etag),
    );
  } catch {
    // A transient (non-precondition) checkpoint-write error must never fail the run.
    input.log?.warn(
      { page: page.lastCompletedPage, slug: page.slug },
      "checkpoint write failed; continuing run",
    );
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
  readonly lastCompletedPage: number;
  readonly pages: Record<string, CheckpointPage>;
  readonly rawStorage: readonly StoreRawReplayResult[];
  readonly resumeState: ResumeState;
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
    discoveredLastPage,
    discoveryReport: context.discoveryReport,
    finishedAt: input.now().toISOString(),
    lastCompletedPage: context.lastCompletedPage,
    rawStorage: context.rawStorage,
    runId: input.runId,
    staging: context.staging,
    startedAt: context.startedAt,
    status,
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
    await input.checkpointStore.write(
      writeInput(context.slug, checkpoint, context.resumeState.etag),
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
