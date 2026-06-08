import { buildRunSummary, runExitCode } from "./summary.js";

import type { RunExitCode, RunSummary } from "./types.js";
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

interface RunOnceInput {
  readonly attempts?: number;
  readonly byteClient: ReplayByteClient;
  readonly discoverReplays: (input: {
    readonly attempts?: number;
    readonly maxPages?: number;
    readonly onRetry?: (event: RetryAttemptEvent) => void;
    readonly requestDelayMs?: number;
    readonly sourceClient: SourceClient;
    readonly sourceUrl: URL;
  }) => Promise<DiscoveryReport>;
  readonly maxPages?: number;
  readonly now: () => Date;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly runId: string;
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
  readonly stageRawReplay: (input: {
    readonly rawResult: StoreRawReplayResult;
    readonly repository: StagingRepository;
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

export async function runOnce(input: RunOnceInput): Promise<RunOnceResult> {
  const startedAt = input.now().toISOString();
  const discoveryReport = emptyDiscoveryReport(input.sourceUrl.toString());
  const rawStorage: StoreRawReplayResult[] = [];
  const staging: IngestStagingResult[] = [];
  const maxPages = input.maxPages ?? 1;

  for (let page = 1; page <= maxPages; page += 1) {
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

    for (const candidate of pageReport.candidates) {
      // Scheduled runs process candidates sequentially for source/storage/staging evidence.
      // eslint-disable-next-line no-await-in-loop
      const rawResult = await input.storeRawReplay({
        byteClient: input.byteClient,
        candidate,
        storage: input.storage,
      });
      rawStorage.push(rawResult);

      // Staging keeps one outcome per raw result, including non-stageable failures.
      // eslint-disable-next-line no-await-in-loop
      const stagingResult = await input.stageRawReplay({
        rawResult,
        repository: input.stagingRepository,
      });
      staging.push(stagingResult);
    }
  }

  const summary = buildRunSummary({
    discoveryReport,
    finishedAt: input.now().toISOString(),
    rawStorage,
    runId: input.runId,
    staging,
    startedAt,
  });

  return {
    exitCode: runExitCode(summary),
    summary,
  };
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
