import { calculateSha256 } from "./checksum.js";
import { toRawReplayObjectKey } from "./object-key.js";
import { ReplayByteFetchError } from "./replay-byte-client.js";

import type { ReplayByteClient } from "./replay-byte-client.js";

import type { S3RawReplayStorage } from "./s3-raw-storage.js";
import type { ReplayCandidate } from "../types/replay-candidate.js";
import type { StoreRawReplayResult } from "../types/raw-replay.js";

export type {
  RawReplayFetchFailureEvidence,
  StoreRawReplayResult,
} from "../types/raw-replay.js";

interface StoreRawReplayInput {
  readonly byteClient: ReplayByteClient;
  readonly candidate: ReplayCandidate;
  readonly now?: () => Date;
  readonly storage: S3RawReplayStorage;
}

export const storeRawReplay = async (
  input: StoreRawReplayInput,
): Promise<StoreRawReplayResult> => {
  const fetchedAt = (input.now ?? (() => new Date()))().toISOString();

  try {
    const bytes = await input.byteClient.fetchBytes(
      new URL(input.candidate.source.rawUrl ?? input.candidate.source.url),
    );
    const checksum = calculateSha256(bytes);
    const objectKey = toRawReplayObjectKey(checksum);

    return await input.storage.storeRawReplay({
      bytes,
      candidate: input.candidate,
      checksum,
      fetchedAt,
      objectKey,
    });
  } catch (error) {
    if (!(error instanceof ReplayByteFetchError)) {
      throw error;
    }

    return {
      failureCategory: "fetch_failed",
      fetchedAt,
      message: error.message,
      source: input.candidate.source,
      sourceFilename: input.candidate.identity.filename,
      status: "failed",
    };
  }
};
