import { toIngestStagingPayload } from "./payload.js";

import type { IngestStagingPayload, IngestStagingResult } from "./types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import type { RawReplayStorageEvidence } from "../storage/types.js";

export interface StagingRepository {
  stage: (payload: IngestStagingPayload) => Promise<IngestStagingResult>;
}

interface StageRawReplayInput {
  readonly rawResult: StoreRawReplayResult;
  readonly repository: StagingRepository;
  readonly runId?: string;
}

const isRawStorageEvidence = (
  result: StoreRawReplayResult,
): result is RawReplayStorageEvidence =>
  "checksum" in result && "bucket" in result && "objectKey" in result;

const payloadOptions = (runId: string | undefined): { runId?: string } => {
  if (runId === undefined) {
    return {};
  }

  return { runId };
};

export const stageRawReplay = async (
  input: StageRawReplayInput,
): Promise<IngestStagingResult> => {
  if (!isRawStorageEvidence(input.rawResult)) {
    return {
      reason: `Raw storage status ${input.rawResult.status} is not stageable`,
      status: "not_stageable",
    };
  }

  const payloadResult = toIngestStagingPayload(
    input.rawResult,
    payloadOptions(input.runId),
  );

  if (!payloadResult.stageable) {
    return {
      reason: payloadResult.reason,
      status: "not_stageable",
    };
  }

  return input.repository.stage(payloadResult.payload);
};
