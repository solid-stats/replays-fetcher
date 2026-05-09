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

interface BuildReportOptions {
  readonly candidates: readonly ReplayCandidate[];
  readonly diagnostics: readonly DiscoveryDiagnostic[];
  readonly ok: boolean;
  readonly options: DiscoverReplaysDryRunOptions;
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
      // Page detail fetches are part of the same source-order sequence.
      // eslint-disable-next-line no-await-in-loop
      const pageCandidates = await discoverPageCandidates({
        fixture,
        page,
        pageUrl,
        sourceClient: options.sourceClient,
        sourceText,
      });
      candidates.push(...pageCandidates);
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

    return buildReport({ candidates, diagnostics, ok: false, options });
  }

  return buildReport({ candidates, diagnostics, ok: true, options });
}

function buildReport(input: BuildReportOptions): DiscoveryReport {
  const report: DiscoveryReport = {
    candidates: input.candidates,
    counts: {
      candidates: input.candidates.length,
      diagnostics: input.diagnostics.length,
      discovered: input.candidates.length,
    },
    diagnostics: input.diagnostics,
    generatedAt: input.options.generatedAt ?? new Date(0).toISOString(),
    mode: "dry-run",
    ok: input.ok,
    sourceUrl: input.options.sourceUrl.toString(),
  };

  if (input.options.maxPages !== undefined) {
    return {
      ...report,
      maxPages: input.options.maxPages,
    };
  }

  return report;
}

async function discoverPageCandidates(input: {
  readonly fixture: SourceFixture | undefined;
  readonly page: number;
  readonly pageUrl: URL;
  readonly sourceClient: SourceClient;
  readonly sourceText: string;
}): Promise<readonly ReplayCandidate[]> {
  if (input.fixture !== undefined) {
    return input.fixture.candidates.map((candidate) =>
      toReplayCandidate(candidate),
    );
  }

  const candidates: ReplayCandidate[] = [];
  const rows = extractReplayRows(input.sourceText, input.page, input.pageUrl);

  for (const row of rows) {
    // Source requests are intentionally sequential to avoid aggressive polling.
    // eslint-disable-next-line no-await-in-loop
    const candidate = await discoverRowCandidate(input.sourceClient, row);

    if (candidate !== undefined) {
      candidates.push(candidate);
    }
  }

  return candidates;
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
