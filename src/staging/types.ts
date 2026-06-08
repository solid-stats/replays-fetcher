import type { RawReplayStorageEvidence } from "../storage/types.js";

export type IngestStagingStatus = "pending";

export type StagingOutcomeStatus =
  | "already_staged"
  | "conflict"
  | "failed"
  | "not_stageable"
  | "staged";

export interface IngestStagingPayload {
  readonly checksum: string;
  readonly conflictDetails: Record<string, never>;
  readonly objectKey: string;
  readonly promotionEvidence: {
    readonly bucket: string;
    readonly byteSize: number;
    readonly checksum: string;
    readonly discoveredAt?: string;
    readonly fetchedAt: string;
    readonly objectKey: string;
    readonly rawStorageStatus: "skipped" | "stored";
    readonly run_id?: string;
    readonly sourceExternalId?: string;
    readonly sourceFilename: string;
    readonly sourceUrl: string;
  };
  readonly replayTimestamp?: string;
  readonly sizeBytes: number;
  readonly sourceReplayId: string;
  readonly sourceSystem: string;
  readonly status: IngestStagingStatus;
}

export interface ExistingStagingEvidence {
  readonly checksum: string;
  readonly objectKey: string;
  readonly sourceReplayId: string;
  readonly sourceSystem: string;
  readonly status: string;
}

export interface StageableRawReplayEvidence extends RawReplayStorageEvidence {
  readonly status: "skipped" | "stored";
}

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

export interface IngestStagingResult {
  readonly existing?: ExistingStagingEvidence;
  readonly payload?: IngestStagingPayload;
  readonly reason?: string;
  readonly stagingId?: string;
  readonly status: StagingOutcomeStatus;
}
