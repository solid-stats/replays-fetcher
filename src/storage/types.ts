import type { ReplayCandidate } from "../discovery/types.js";

export type RawReplayStorageStatus =
  | "stored"
  | "skipped"
  | "conflict"
  | "failed";

export interface RawReplayObjectIdentity {
  readonly bucket: string;
  readonly checksum: string;
  readonly objectKey: string;
}

export interface RawReplaySourceEvidence {
  readonly candidate: ReplayCandidate;
  readonly fetchedAt: string;
}

export interface RawReplayStorageInput extends RawReplaySourceEvidence {
  readonly bytes: Uint8Array;
  readonly checksum: string;
  readonly objectKey: string;
}

export interface RawReplayStorageEvidence extends RawReplayObjectIdentity {
  readonly byteSize: number;
  readonly discoveredAt?: string;
  readonly failureCategory?: "object_conflict" | "s3_error";
  readonly fetchedAt: string;
  readonly source: ReplayCandidate["source"];
  readonly sourceFilename: string;
  readonly status: RawReplayStorageStatus;
}
