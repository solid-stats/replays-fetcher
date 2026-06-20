import type { ReplayCandidate } from "./replay-candidate.js";

export type RawReplayStorageStatus =
  | "stored"
  | "skipped"
  | "conflict"
  | "failed";

export type RawReplayObjectIdentity = {
  readonly bucket: string;
  readonly checksum: string;
  readonly objectKey: string;
};

export type RawReplayStorageEvidence = {
  readonly byteSize: number;
  readonly discoveredAt?: string;
  readonly failureCategory?: "object_conflict" | "s3_error";
  readonly fetchedAt: string;
  readonly source: ReplayCandidate["source"];
  readonly sourceFilename: string;
  readonly status: RawReplayStorageStatus;
} & RawReplayObjectIdentity;

export type RawReplayFetchFailureEvidence = {
  readonly failureCategory: "fetch_failed";
  readonly fetchedAt: string;
  readonly message: string;
  readonly source: ReplayCandidate["source"];
  readonly sourceFilename: string;
  readonly status: "failed";
};

export type StoreRawReplayResult =
  | RawReplayFetchFailureEvidence
  | RawReplayStorageEvidence;
