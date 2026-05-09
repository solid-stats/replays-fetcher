import { extractFilenameFromDetailHtml, extractReplayRows } from "./html.js";
import { SourceFetchError } from "./source-client.js";

import type {
  DiscoveryDiagnostic,
  DiscoveryReport,
  ReplayCandidate,
  SourceClient,
} from "./types.js";

interface DiscoverReplaysDryRunOptions {
  readonly generatedAt?: string;
  readonly maxPages?: number;
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
}

interface SourceCandidateFixture {
  readonly discoveredAt?: string;
  readonly externalId?: string;
  readonly filename: string;
  readonly missionText?: string;
  readonly page?: number;
  readonly serverId?: number;
  readonly url: string;
  readonly world?: string;
}

interface SourceFixture {
  readonly candidates: readonly SourceCandidateFixture[];
}

interface MutableReplayMetadata {
  discoveredAt?: string;
  missionText?: string;
  serverId?: number;
  world?: string;
}

interface MutableReplaySource {
  externalId?: string;
  page?: number;
  url: string;
}

export async function discoverReplaysDryRun(
  options: DiscoverReplaysDryRunOptions,
): Promise<DiscoveryReport> {
  const maxPages = options.maxPages ?? 1;
  const candidates: ReplayCandidate[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const pageUrl = toPageUrl(options.sourceUrl, page);
      // Source requests are intentionally sequential to preserve source order.
      // eslint-disable-next-line no-await-in-loop
      const sourceText = await options.sourceClient.fetchText(pageUrl);
      const fixture = parseSourceFixture(sourceText);

      if (fixture === undefined) {
        const rows = extractReplayRows(sourceText, page, pageUrl);

        for (const row of rows) {
          // Source requests are intentionally sequential to avoid aggressive polling.
          // eslint-disable-next-line no-await-in-loop
          const candidate = await discoverRowCandidate(
            options.sourceClient,
            row,
          );

          if (candidate !== undefined) {
            candidates.push(candidate);
          }
        }
      } else {
        candidates.push(
          ...fixture.candidates.map((candidate) =>
            toReplayCandidate(candidate),
          ),
        );
      }
    }
  } catch (error) {
    if (!(error instanceof SourceFetchError)) {
      throw error;
    }

    diagnostics.push({
      code: error.code,
      message: error.message,
      severity: "error",
      sourceUrl: options.sourceUrl.toString(),
    });

    return buildReport(options, candidates, diagnostics, false);
  }

  return buildReport(options, candidates, diagnostics, true);
}

function buildReport(
  options: DiscoverReplaysDryRunOptions,
  candidates: readonly ReplayCandidate[],
  diagnostics: readonly DiscoveryDiagnostic[],
  ok: boolean,
): DiscoveryReport {
  const report: DiscoveryReport = {
    candidates,
    counts: {
      candidates: candidates.length,
      diagnostics: diagnostics.length,
      discovered: candidates.length,
    },
    diagnostics,
    generatedAt: options.generatedAt ?? new Date(0).toISOString(),
    mode: "dry-run",
    ok,
    sourceUrl: options.sourceUrl.toString(),
  };

  if (options.maxPages !== undefined) {
    return {
      ...report,
      maxPages: options.maxPages,
    };
  }

  return report;
}

async function discoverRowCandidate(
  sourceClient: SourceClient,
  row: ReturnType<typeof extractReplayRows>[number],
): Promise<ReplayCandidate | undefined> {
  if (row.source.url === undefined) {
    return undefined;
  }

  const detailHtml = await sourceClient.fetchText(new URL(row.source.url));
  const filename = extractFilenameFromDetailHtml(detailHtml);

  if (filename === undefined) {
    return undefined;
  }

  return toReplayCandidateFromHtmlRow(filename, row);
}

function toReplayCandidateFromHtmlRow(
  filename: string,
  row: ReturnType<typeof extractReplayRows>[number],
): ReplayCandidate {
  const source: MutableReplaySource = {
    page: row.page,
    url: row.source.url ?? "",
  };

  if (row.source.externalId !== undefined) {
    source.externalId = row.source.externalId;
  }

  return {
    identity: { filename },
    metadata: row.metadata,
    source,
  };
}

function parseSourceFixture(text: string): SourceFixture | undefined {
  try {
    const parsed = JSON.parse(text) as Partial<SourceFixture>;

    if (Array.isArray(parsed.candidates)) {
      return {
        candidates: parsed.candidates,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function toReplayCandidate(candidate: SourceCandidateFixture): ReplayCandidate {
  const source: MutableReplaySource = {
    url: candidate.url,
  };

  if (candidate.externalId !== undefined) {
    source.externalId = candidate.externalId;
  }

  if (candidate.page !== undefined) {
    source.page = candidate.page;
  }

  const metadata: MutableReplayMetadata = {};

  if (candidate.discoveredAt !== undefined) {
    metadata.discoveredAt = candidate.discoveredAt;
  }

  if (candidate.missionText !== undefined) {
    metadata.missionText = candidate.missionText;
  }

  if (candidate.serverId !== undefined) {
    metadata.serverId = candidate.serverId;
  }

  if (candidate.world !== undefined) {
    metadata.world = candidate.world;
  }

  return {
    identity: {
      filename: candidate.filename,
    },
    metadata,
    source,
  };
}

function toPageUrl(sourceUrl: URL, page: number): URL {
  if (page === 1) {
    return sourceUrl;
  }

  const pageUrl = new URL(sourceUrl);
  pageUrl.searchParams.set("p", String(page));

  return pageUrl;
}
