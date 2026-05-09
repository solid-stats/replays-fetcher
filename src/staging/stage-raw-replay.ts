import { toIngestStagingPayload } from "./payload.js";

import type { IngestStagingPayload, IngestStagingResult } from "./types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import type { RawReplayStorageEvidence } from "../storage/types.js";

export interface StagingRepository {
  stage(payload: IngestStagingPayload): Promise<IngestStagingResult>;
}

interface StageRawReplayInput {
  readonly rawResult: StoreRawReplayResult;
  readonly repository: StagingRepository;
}

export async function stageRawReplay(
  input: StageRawReplayInput,
): Promise<IngestStagingResult> {
  if (!isRawStorageEvidence(input.rawResult)) {
    return {
      reason: `Raw storage status ${input.rawResult.status} is not stageable`,
      status: "not_stageable",
    };
  }

  const payloadResult = toIngestStagingPayload(input.rawResult);

  if (!payloadResult.stageable) {
    return {
      reason: payloadResult.reason,
      status: "not_stageable",
    };
  }

  return input.repository.stage(payloadResult.payload);
}

function isRawStorageEvidence(
  result: StoreRawReplayResult,
): result is RawReplayStorageEvidence {
  return "checksum" in result && "bucket" in result && "objectKey" in result;
}
