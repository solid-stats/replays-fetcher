import { calculateSha256 } from "../storage/checksum.js";

import type {
  IngestStagingPayload,
  StagingPayloadResult,
  StageableRawReplayEvidence,
} from "./types.js";
import type { RawReplayStorageEvidence } from "../storage/types.js";

const defaultSourceSystem = "sg-zone";

interface ToIngestStagingPayloadOptions {
  readonly sourceSystem?: string;
}

export function toIngestStagingPayload(
  evidence: RawReplayStorageEvidence,
  options: ToIngestStagingPayloadOptions = {},
): StagingPayloadResult {
  if (!isStageable(evidence)) {
    return {
      reason: `Raw storage status ${evidence.status} is not stageable`,
      stageable: false,
      status: "not_stageable",
    };
  }

  return {
    payload: toPayload(evidence, options.sourceSystem ?? defaultSourceSystem),
    stageable: true,
  };
}

function isStageable(
  evidence: RawReplayStorageEvidence,
): evidence is StageableRawReplayEvidence {
  return evidence.status === "stored" || evidence.status === "skipped";
}

function toPayload(
  evidence: StageableRawReplayEvidence,
  sourceSystem: string,
): IngestStagingPayload {
  const promotionEvidence: IngestStagingPayload["promotionEvidence"] = {
    bucket: evidence.bucket,
    byteSize: evidence.byteSize,
    checksum: evidence.checksum,
    fetchedAt: evidence.fetchedAt,
    objectKey: evidence.objectKey,
    rawStorageStatus: evidence.status,
    sourceFilename: evidence.sourceFilename,
    sourceUrl: evidence.source.url,
  };

  if (evidence.source.externalId !== undefined) {
    return {
      ...basePayload(evidence, sourceSystem, promotionEvidence),
      promotionEvidence: {
        ...promotionEvidence,
        sourceExternalId: evidence.source.externalId,
      },
    };
  }

  return basePayload(evidence, sourceSystem, promotionEvidence);
}

function basePayload(
  evidence: StageableRawReplayEvidence,
  sourceSystem: string,
  promotionEvidence: IngestStagingPayload["promotionEvidence"],
): IngestStagingPayload {
  return {
    checksum: evidence.checksum,
    conflictDetails: {},
    objectKey: evidence.objectKey,
    promotionEvidence,
    sizeBytes: evidence.byteSize,
    sourceReplayId: toSourceReplayId(evidence),
    sourceSystem,
    status: "pending",
  };
}

function toSourceReplayId(evidence: StageableRawReplayEvidence): string {
  if (evidence.source.externalId !== undefined) {
    return evidence.source.externalId;
  }

  return `derived:${calculateSha256(
    new TextEncoder().encode(
      `${evidence.source.url}\n${evidence.sourceFilename}\n${evidence.checksum}`,
    ),
  )}`;
}
