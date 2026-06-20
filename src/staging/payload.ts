import { calculateSha256 } from "../storage/checksum.js";
import type { RawReplayStorageEvidence } from "../storage/types.js";
import { componentsToUtcIso } from "../time/components-to-utc-iso.js";
import type {
  IngestStagingPayload,
  StagingPayloadResult,
  StageableRawReplayEvidence,
} from "./types.js";

export const defaultSourceSystem = "sg-zone";

type ToIngestStagingPayloadOptions = {
  readonly runId?: string;
  readonly sourceSystem?: string;
};

const isStageable = (
  evidence: RawReplayStorageEvidence,
): evidence is StageableRawReplayEvidence =>
  evidence.status === "stored" || evidence.status === "skipped";

/**
 * Strip any `username`/`password` userinfo from the source URL before it lands
 * in `promotion_evidence.sourceUrl` (a durable, cross-service jsonb field). An
 * operator-supplied `https://user:pass@host/...` must never leak credentials
 * into staging evidence (WR-02, threat T-09-01). A non-URL string is returned
 * unchanged — it carries no parsable userinfo to strip.
 */
const sanitizeSourceUrl = (sourceUrl: string): string => {
  try {
    const cleaned = new URL(sourceUrl);
    cleaned.username = "";
    cleaned.password = "";

    return cleaned.toString();
  } catch {
    return sourceUrl;
  }
};

const toSourceReplayId = (evidence: StageableRawReplayEvidence): string => {
  if (evidence.source.externalId !== undefined) {
    return evidence.source.externalId;
  }

  return `derived:${calculateSha256(
    new TextEncoder().encode(
      `${evidence.source.url}\n${evidence.sourceFilename}\n${evidence.checksum}`,
    ),
  )}`;
};

/**
 * Parse the leading `YYYY_MM_DD__HH_MM_SS__` timestamp from a replay filename
 * into a UTC ISO string, or undefined when the filename carries no timestamp or
 * the parsed date is out of range (e.g. `2026_13_32__25_99_99__`). Range
 * validation is delegated to the shared `componentsToUtcIso`, so the listing
 * (`parseGameDateToUtcIso`) and filename timestamp paths reject invalid dates
 * identically — neither ships a bogus value into `replay_timestamp`.
 */
const replayTimestampFromFilename = (filename: string): string | undefined => {
  const groups =
    /^(?<year>\d{4})_(?<month>\d{2})_(?<day>\d{2})__(?<hour>\d{2})_(?<minute>\d{2})_(?<second>\d{2})__/u.exec(
      filename,
    )?.groups;

  if (groups === undefined) {
    return undefined;
  }

  return componentsToUtcIso({
    day: Number(groups["day"]),
    hour: Number(groups["hour"]),
    minute: Number(groups["minute"]),
    month: Number(groups["month"]),
    second: Number(groups["second"]),
    year: Number(groups["year"]),
  });
};

const basePayload = (
  evidence: StageableRawReplayEvidence,
  sourceSystem: string,
  promotionEvidence: IngestStagingPayload["promotionEvidence"],
): IngestStagingPayload => {
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
  const replayTimestamp =
    replayTimestampFromFilename(evidence.sourceFilename) ??
    evidence.discoveredAt;

  if (replayTimestamp !== undefined) {
    return {
      ...payload,
      replayTimestamp,
    };
  }

  return payload;
};

const toPayload = (
  evidence: StageableRawReplayEvidence,
  sourceSystem: string,
  runId: string | undefined,
): IngestStagingPayload => {
  let promotionEvidence: IngestStagingPayload["promotionEvidence"] = {
    bucket: evidence.bucket,
    byteSize: evidence.byteSize,
    checksum: evidence.checksum,
    fetchedAt: evidence.fetchedAt,
    objectKey: evidence.objectKey,
    rawStorageStatus: evidence.status,
    sourceFilename: evidence.sourceFilename,
    sourceUrl: sanitizeSourceUrl(evidence.source.url),
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
      // oxlint-disable-next-line camelcase -- run_id is the cross-service promotion_evidence jsonb contract key (RESUME-04), not a local identifier
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
};

export const toIngestStagingPayload = (
  evidence: RawReplayStorageEvidence,
  options: ToIngestStagingPayloadOptions = {},
): StagingPayloadResult => {
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
};
