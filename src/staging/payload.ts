import { calculateSha256 } from "../storage/checksum.js";

import type {
  IngestStagingPayload,
  StagingPayloadResult,
  StageableRawReplayEvidence,
} from "./types.js";
import type { RawReplayStorageEvidence } from "../storage/types.js";

const defaultSourceSystem = "sg-zone";

interface ToIngestStagingPayloadOptions {
  readonly runId?: string;
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
    payload: toPayload(
      evidence,
      options.sourceSystem ?? defaultSourceSystem,
      options.runId,
    ),
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
  runId: string | undefined,
): IngestStagingPayload {
  let promotionEvidence: IngestStagingPayload["promotionEvidence"] = {
    bucket: evidence.bucket,
    byteSize: evidence.byteSize,
    checksum: evidence.checksum,
    fetchedAt: evidence.fetchedAt,
    objectKey: evidence.objectKey,
    rawStorageStatus: evidence.status,
    sourceFilename: evidence.sourceFilename,
    sourceUrl: evidence.source.url,
  };

  if (evidence.discoveredAt !== undefined) {
    promotionEvidence = {
      ...promotionEvidence,
      discoveredAt: evidence.discoveredAt,
    };
  }

  if (runId !== undefined) {
    promotionEvidence = {
      ...promotionEvidence,
      // eslint-disable-next-line camelcase -- run_id is the cross-service promotion_evidence jsonb contract key (RESUME-04), not a local identifier
      run_id: runId,
    };
  }

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
  const payload: IngestStagingPayload = {
    checksum: evidence.checksum,
    conflictDetails: {},
    objectKey: evidence.objectKey,
    promotionEvidence,
    sizeBytes: evidence.byteSize,
    sourceReplayId: toSourceReplayId(evidence),
    sourceSystem,
    status: "pending",
  };
  const replayTimestamp = replayTimestampFromFilename(evidence.sourceFilename);

  if (replayTimestamp !== undefined) {
    return {
      ...payload,
      replayTimestamp,
    };
  }

  return payload;
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

function replayTimestampFromFilename(filename: string): string | undefined {
  const match =
    /^(?<year>\d{4})_(?<month>\d{2})_(?<day>\d{2})__(?<hour>\d{2})_(?<minute>\d{2})_(?<second>\d{2})__/u.exec(
      filename,
    );

  if (match?.groups === undefined) {
    return undefined;
  }

  const { day, hour, minute, month, second, year } = match.groups as Record<
    "day" | "hour" | "minute" | "month" | "second" | "year",
    string
  >;

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}
