import { calculateSha256 } from "./checksum.js";
import { toRawReplayObjectKey } from "./object-key.js";
import {
  ReplayByteFetchError,
  type ReplayByteClient,
} from "./replay-byte-client.js";

import type { S3RawReplayStorage } from "./s3-raw-storage.js";
import type { RawReplayStorageEvidence } from "./types.js";
import type { ReplayCandidate } from "../discovery/types.js";

export interface RawReplayFetchFailureEvidence {
  readonly failureCategory: "fetch_failed";
  readonly fetchedAt: string;
  readonly message: string;
  readonly source: ReplayCandidate["source"];
  readonly sourceFilename: string;
  readonly status: "failed";
}

export type StoreRawReplayResult =
  | RawReplayFetchFailureEvidence
  | RawReplayStorageEvidence;

interface StoreRawReplayInput {
  readonly byteClient: ReplayByteClient;
  readonly candidate: ReplayCandidate;
  readonly now?: () => Date;
  readonly storage: S3RawReplayStorage;
}

export async function storeRawReplay(
  input: StoreRawReplayInput,
): Promise<StoreRawReplayResult> {
  const fetchedAt = (input.now ?? (() => new Date()))().toISOString();

  try {
    const bytes = await input.byteClient.fetchBytes(
      new URL(input.candidate.source.url),
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
}
