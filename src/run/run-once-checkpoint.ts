import type { Checkpoint, CheckpointPage } from "../checkpoint/checkpoint.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import { emptyDiscoveryReport, FIRST_PAGE } from "./run-once-types.js";
import type {
  AssembleResultInput,
  MutableDiscoveryReport,
  RunOnceInput,
} from "./run-once-types.js";
import type { RunSourceFailure, RunSummary } from "./types.js";

const RESUME_INVOCATION = "replays-fetcher run-once --resume";

export type ResumeState = {
  readonly etag?: string;
  readonly pages: Record<string, CheckpointPage>;
  readonly startPage: number;
};

const startFresh = (etag: string | undefined): ResumeState => {
  if (etag === undefined) {
    return { startPage: FIRST_PAGE, pages: {} };
  }

  return { etag, startPage: FIRST_PAGE, pages: {} };
};

const resumeFrom = (
  etag: string | undefined,
  checkpoint: Checkpoint,
): ResumeState => {
  const startPage = checkpoint.lastCompletedPage + FIRST_PAGE;
  if (etag === undefined) {
    return { startPage, pages: { ...checkpoint.pages } };
  }

  return { etag, startPage, pages: { ...checkpoint.pages } };
};

export const sourceFailureOption = (
  sourceFailure: RunSourceFailure | undefined,
): {
  sourceFailure?: RunSourceFailure;
} => {
  if (sourceFailure === undefined) {
    return {};
  }

  return { sourceFailure };
};

export const resumeInvocationOption = (
  status: RunSummary["status"],
): {
  resumeInvocation?: string;
} => {
  if (status === "complete") {
    return {};
  }

  return { resumeInvocation: RESUME_INVOCATION };
};

/**
 * RANGE-05: the discovered source range spans page 1 to the last completed page,
 * present only when at least one page completed (additive spread; omitted
 * otherwise so the summary shape stays exact-optional safe).
 */
export const discoveredRangeOption = (
  lastCompletedPage: number,
): {
  discoveredRange?: { readonly firstPage: number; readonly lastPage: number };
} => {
  if (lastCompletedPage < FIRST_PAGE) {
    return {};
  }

  return {
    discoveredRange: { firstPage: FIRST_PAGE, lastPage: lastCompletedPage },
  };
};

const writeInput = (
  slug: string,
  checkpoint: Checkpoint,
  etag: string | undefined,
): { checkpoint: Checkpoint; etag?: string; slug: string } => {
  if (etag === undefined) {
    return { checkpoint, slug };
  }

  return { checkpoint, etag, slug };
};

const aggregatePageCounts = (
  pages: Record<string, CheckpointPage>,
): Checkpoint["counts"] => {
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
};

const resolveResumeState = async (
  input: RunOnceInput,
  slug: string,
): Promise<ResumeState> => {
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
};

export type LoopState = {
  discoveryReport: MutableDiscoveryReport;
  etag: string | undefined;
  lastCompletedPage: number;
  readonly pageTimestampsMs: number[];
  readonly pages: Record<string, CheckpointPage>;
  readonly rawStorage: StoreRawReplayResult[];
  reachedMaxPages: boolean;
  readonly staging: IngestStagingResult[];
};

export const buildLoopState = async (
  input: RunOnceInput,
  slug: string,
): Promise<LoopState> => {
  const resumeState = await resolveResumeState(input, slug);

  return {
    discoveryReport: emptyDiscoveryReport(slug),
    etag: resumeState.etag,
    lastCompletedPage: resumeState.startPage - FIRST_PAGE,
    pageTimestampsMs: [],
    pages: { ...resumeState.pages },
    rawStorage: [],
    reachedMaxPages: false,
    staging: [],
  };
};

export type BuildCheckpointInput = {
  readonly discoveredLastPage?: number;
  readonly lastCompletedPage: number;
  readonly pages: Record<string, CheckpointPage>;
  readonly slug: string;
  readonly startedAt: string;
  readonly status: Checkpoint["status"];
};

const buildCheckpoint = (
  input: RunOnceInput,
  context: BuildCheckpointInput,
): Checkpoint => {
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
};

export type WritePageCheckpointInput = {
  readonly etag: string | undefined;
  readonly lastCompletedPage: number;
  readonly pages: Record<string, CheckpointPage>;
  readonly slug: string;
  readonly startedAt: string;
};

export const writePageCheckpoint = async (
  input: RunOnceInput,
  page: WritePageCheckpointInput,
): Promise<string | undefined> => {
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
  } catch (error) {
    // A transient (non-precondition) checkpoint-write error must never fail the
    // run. The ETag is unchanged on failure, so reuse the one we held. Log the
    // error under the pino `err` key so its stack is serialized and a persistent
    // failure (e.g. a backend that rejects the CAS conditional headers) is
    // diagnosable instead of silently degrading resume (§AA).
    input.log?.warn(
      { err: error, page: page.lastCompletedPage, slug: page.slug },
      "checkpoint write failed; continuing run",
    );

    return page.etag;
  }
};

export const writeFinalCheckpoint = async (
  input: RunOnceInput,
  context: AssembleResultInput,
  discoveredLastPage: number,
): Promise<void> => {
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
  } catch (error) {
    // Log the error under the pino `err` key (parity with writePageCheckpoint)
    // so a persistent final-write CAS failure — the exact mode
    // S3_CHECKPOINT_CONDITIONAL_WRITES was added to fix — is diagnosable instead
    // of silently degrading resume (§AA).
    input.log?.warn(
      { err: error, slug: context.slug },
      "final checkpoint write failed; continuing run",
    );
  }
};
