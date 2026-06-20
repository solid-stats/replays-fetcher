import type { ReplayCandidate } from "../types/replay-candidate.js";

export type {
  RawReplayObjectIdentity,
  RawReplayStorageEvidence,
  RawReplayStorageStatus,
} from "../types/raw-replay.js";

export type RawReplaySourceEvidence = {
  readonly candidate: ReplayCandidate;
  readonly fetchedAt: string;
};

export type RawReplayStorageInput = {
  readonly bytes: Uint8Array;
  readonly checksum: string;
  readonly objectKey: string;
} & RawReplaySourceEvidence;
