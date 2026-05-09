/* eslint-disable max-lines -- Discovery orchestration is split once storage/staging phases add separate modules. */
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

interface DiscoverPageCandidatesResult {
  readonly candidates: readonly ReplayCandidate[];
  readonly diagnostics: readonly DiscoveryDiagnostic[];
}

interface CandidateRegistryEntry {
  readonly candidate: ReplayCandidate;
  readonly serialized: string;
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
      candidates.push(...pageCandidates.candidates);
      diagnostics.push(...pageCandidates.diagnostics);
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
}): Promise<DiscoverPageCandidatesResult> {
  if (input.fixture !== undefined) {
    return collectCandidateDiagnostics(
      input.fixture.candidates.map((candidate) => toReplayCandidate(candidate)),
    );
  }

  const candidates: ReplayCandidate[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];
  const rows = extractReplayRows(input.sourceText, input.page, input.pageUrl);

  for (const row of rows) {
    if (row.source.url === undefined) {
      diagnostics.push({
        code: "malformed_row",
        message: "Source row did not include a replay link",
        page: row.page,
        severity: "warning",
        sourceUrl: input.pageUrl.toString(),
      });
    } else {
      // Source requests are intentionally sequential to avoid aggressive polling.
      // eslint-disable-next-line no-await-in-loop
      const candidate = await discoverRowCandidate(input.sourceClient, row);

      if (candidate === undefined) {
        diagnostics.push({
          code: "missing_filename",
          externalId: row.source.externalId,
          message: "Replay detail page did not include a filename",
          page: row.page,
          severity: "warning",
          sourceUrl: row.source.url,
        });
      } else {
        candidates.push(candidate);
      }
    }
  }

  const candidateDiagnostics = collectCandidateDiagnostics(candidates);

  return {
    candidates: candidateDiagnostics.candidates,
    diagnostics: [...diagnostics, ...candidateDiagnostics.diagnostics],
  };
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

  return toReplayCandidateFromHtmlRow(filename, row, row.source.url);
}

function collectCandidateDiagnostics(
  candidates: readonly ReplayCandidate[],
): DiscoverPageCandidatesResult {
  const candidatesByFilename = new Map<string, CandidateRegistryEntry[]>();
  const emittedExactCandidates = new Set<string>();
  const outputCandidates: ReplayCandidate[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];

  for (const candidate of candidates) {
    const serialized = JSON.stringify(candidate);
    const existingEntries =
      candidatesByFilename.get(candidate.identity.filename) ?? [];
    const exactCandidateExists = emittedExactCandidates.has(serialized);

    if (existingEntries.length > 0) {
      diagnostics.push({
        candidateIndex: outputCandidates.length,
        code: "duplicate_filename",
        externalId: candidate.source.externalId,
        message: "Filename appeared more than once in source discovery",
        page: candidate.source.page,
        severity: "warning",
        sourceUrl: candidate.source.url,
      });

      if (hasChangedMetadata(existingEntries, candidate)) {
        diagnostics.push({
          candidateIndex: outputCandidates.length,
          code: "changed_metadata",
          externalId: candidate.source.externalId,
          message:
            "Filename/source ID metadata changed within one discovery run",
          page: candidate.source.page,
          severity: "warning",
          sourceUrl: candidate.source.url,
        });
      }
    }

    if (!exactCandidateExists) {
      outputCandidates.push(candidate);
      emittedExactCandidates.add(serialized);
    }

    existingEntries.push({ candidate, serialized });
    candidatesByFilename.set(candidate.identity.filename, existingEntries);
  }

  return { candidates: outputCandidates, diagnostics };
}

function hasChangedMetadata(
  existingEntries: readonly CandidateRegistryEntry[],
  candidate: ReplayCandidate,
): boolean {
  const candidateSourceId = candidate.source.externalId;

  return existingEntries.some((entry) => {
    if (entry.candidate.source.externalId !== candidateSourceId) {
      return false;
    }

    return (
      JSON.stringify(entry.candidate.metadata ?? {}) !==
      JSON.stringify(candidate.metadata ?? {})
    );
  });
}

function toReplayCandidateFromHtmlRow(
  filename: string,
  row: ReturnType<typeof extractReplayRows>[number],
  sourceUrl: string,
): ReplayCandidate {
  const source: MutableReplaySource = {
    page: row.page,
    url: sourceUrl,
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
