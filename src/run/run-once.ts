import { buildRunSummary, runExitCode } from "./summary.js";

import type { RunExitCode, RunSummary } from "./types.js";
import type {
  DiscoveryReport,
  ReplayCandidate,
  SourceClient,
} from "../discovery/types.js";
import type { StagingRepository } from "../staging/stage-raw-replay.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { ReplayByteClient } from "../storage/replay-byte-client.js";
import type { S3RawReplayStorage } from "../storage/s3-raw-storage.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";

interface RunOnceInput {
  readonly byteClient: ReplayByteClient;
  readonly discoverReplays: (input: {
    readonly sourceClient: SourceClient;
    readonly sourceUrl: URL;
  }) => Promise<DiscoveryReport>;
  readonly now: () => Date;
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

export async function runOnce(input: RunOnceInput): Promise<RunOnceResult> {
  const startedAt = input.now().toISOString();
  const discoveryReport = await input.discoverReplays({
    sourceClient: input.sourceClient,
    sourceUrl: input.sourceUrl,
  });
  const rawStorage: StoreRawReplayResult[] = [];
  const staging: IngestStagingResult[] = [];

  if (discoveryReport.ok) {
    for (const candidate of discoveryReport.candidates) {
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
