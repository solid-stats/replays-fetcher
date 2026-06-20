import type { Logger } from "pino";

import type { ReadOptions } from "./discover-types.js";
import { extractFilenameFromDetailHtml, extractReplayRows } from "./html.js";
import type {
  DiscoveryDiagnostic,
  ReplayCandidate,
  SourceClient,
} from "./types.js";

type SourceCandidateFixture = {
  readonly discoveredAt?: string;
  readonly externalId?: string;
  readonly filename: string;
  readonly missionText?: string;
  readonly page?: number;
  readonly rawUrl?: string;
  readonly serverId?: number;
  readonly url: string;
  readonly world?: string;
};

export type SourceFixture = {
  readonly candidates: readonly SourceCandidateFixture[];
};

type MutableReplayMetadata = {
  discoveredAt?: string;
  missionText?: string;
  serverId?: number;
  world?: string;
};

type MutableReplaySource = {
  externalId?: string;
  page?: number;
  rawUrl?: string;
  url: string;
};

type CandidateFixtureResult =
  | {
      readonly candidate: ReplayCandidate;
      readonly diagnostic?: never;
    }
  | {
      readonly candidate?: never;
      readonly diagnostic: DiscoveryDiagnostic;
    };

export const toRawReplayUrl = (filename: string, detailUrl: URL): string => {
  let rawFilename = filename;

  if (!rawFilename.endsWith(".json")) {
    rawFilename = `${rawFilename}.json`;
  }

  return new URL(`/data/${encodeURIComponent(rawFilename)}`, detailUrl)
    .toString()
    .replaceAll("%2F", "/");
};

const isValidFixtureUrl = (value: string): boolean => URL.parse(value) !== null;

export const parseSourceFixture = (
  text: string,
  log?: Logger,
): SourceFixture | undefined => {
  try {
    const parsed = JSON.parse(text) as Partial<SourceFixture>;

    if (Array.isArray(parsed.candidates)) {
      return {
        candidates: parsed.candidates,
      };
    }
  } catch (error) {
    // pino's err serializer fires on the literal `err` key (§AA); the catch
    // binding stays `error` per unicorn/catch-error-name.
    log?.warn(
      { err: error },
      "fixture JSON parse failed; falling back to HTML discovery",
    );
    return undefined;
  }

  return undefined;
};

export const toReplayCandidate = (
  candidate: SourceCandidateFixture,
  index: number,
  pageUrl: URL,
): CandidateFixtureResult => {
  if (
    typeof candidate.filename !== "string" ||
    candidate.filename.trim().length === 0 ||
    typeof candidate.url !== "string" ||
    candidate.url.trim().length === 0 ||
    !isValidFixtureUrl(candidate.url)
  ) {
    return {
      diagnostic: {
        candidateIndex: index,
        code: "malformed_row",
        message: "Source fixture candidate did not include filename and URL",
        severity: "warning",
        sourceUrl: pageUrl.toString(),
      },
    };
  }

  const source: MutableReplaySource = {
    url: candidate.url,
  };

  if (candidate.externalId !== undefined) {
    source.externalId = candidate.externalId;
  }

  if (typeof candidate.page === "number") {
    source.page = candidate.page;
  }

  if (candidate.rawUrl !== undefined) {
    source.rawUrl = candidate.rawUrl;
  }

  const metadata: MutableReplayMetadata = {};

  if (candidate.discoveredAt !== undefined) {
    metadata.discoveredAt = candidate.discoveredAt;
  }

  if (candidate.missionText !== undefined) {
    metadata.missionText = candidate.missionText;
  }

  if (typeof candidate.serverId === "number") {
    metadata.serverId = candidate.serverId;
  }

  if (candidate.world !== undefined) {
    metadata.world = candidate.world;
  }

  const replayCandidate: ReplayCandidate = {
    identity: {
      filename: candidate.filename,
    },
    source,
  };

  if (Object.keys(metadata).length > 0) {
    return {
      candidate: {
        ...replayCandidate,
        metadata,
      },
    };
  }

  return {
    candidate: replayCandidate,
  };
};

const toReplayCandidateFromHtmlRow = (input: {
  readonly filename: string;
  readonly rawUrl: string;
  readonly row: ReturnType<typeof extractReplayRows>[number];
  readonly sourceUrl: string;
}): ReplayCandidate => {
  const source: MutableReplaySource = {
    page: input.row.page,
    rawUrl: input.rawUrl,
    url: input.sourceUrl,
  };

  if (input.row.source.externalId !== undefined) {
    source.externalId = input.row.source.externalId;
  }

  const candidate: ReplayCandidate = {
    identity: { filename: input.filename },
    source,
  };

  if (Object.keys(input.row.metadata).length > 0) {
    return {
      ...candidate,
      metadata: input.row.metadata,
    };
  }

  return candidate;
};

export const discoverRowCandidate = async (input: {
  readonly detailReadOptions: ReadOptions;
  readonly row: ReturnType<typeof extractReplayRows>[number];
  readonly sourceClient: SourceClient;
  readonly sourceUrl: string;
}): Promise<ReplayCandidate | undefined> => {
  const detailUrl = new URL(input.sourceUrl);
  const detailHtml = await input.sourceClient.fetchText(
    detailUrl,
    input.detailReadOptions,
  );
  const filename = extractFilenameFromDetailHtml(detailHtml);

  if (filename === undefined) {
    return undefined;
  }

  return toReplayCandidateFromHtmlRow({
    filename,
    rawUrl: toRawReplayUrl(filename, detailUrl),
    row: input.row,
    sourceUrl: input.sourceUrl,
  });
};
