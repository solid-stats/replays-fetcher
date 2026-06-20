import type { ReplayCandidate } from "../types/replay-candidate.js";

export type {
  RawReplayObjectIdentity,
  RawReplayStorageEvidence,
  RawReplayStorageStatus,
} from "../types/raw-replay.js";

export interface RawReplaySourceEvidence {
  readonly candidate: ReplayCandidate;
  readonly fetchedAt: string;
}

export interface RawReplayStorageInput extends RawReplaySourceEvidence {
  readonly bytes: Uint8Array;
  readonly checksum: string;
  readonly objectKey: string;
}
