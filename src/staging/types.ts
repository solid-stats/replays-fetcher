import type { RawReplayStorageEvidence } from "../storage/types.js";
import type { IngestStagingPayload } from "../types/staging.js";

export type {
  ExistingStagingEvidence,
  IngestStagingPayload,
  IngestStagingResult,
  IngestStagingStatus,
  StagingOutcomeStatus,
} from "../types/staging.js";

export type StageableRawReplayEvidence = {
  readonly status: "skipped" | "stored";
} & RawReplayStorageEvidence;

export type StagingPayloadResult =
  | {
      readonly payload: IngestStagingPayload;
      readonly stageable: true;
    }
  | {
      readonly reason: string;
      readonly stageable: false;
      readonly status: "not_stageable";
    };
