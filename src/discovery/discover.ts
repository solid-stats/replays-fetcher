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
  readonly requestDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
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

type CandidateFixtureResult =
  | {
      readonly candidate: ReplayCandidate;
      readonly diagnostic?: never;
    }
  | {
      readonly candidate?: never;
      readonly diagnostic: DiscoveryDiagnostic;
    };

interface CandidateRegistryEntry {
  readonly candidate: ReplayCandidate;
  readonly serialized: string;
}

const defaultRequestDelayMs = 2000;

export async function discoverReplaysDryRun(
  options: DiscoverReplaysDryRunOptions,
): Promise<DiscoveryReport> {
  const maxPages = options.maxPages ?? 1;
  const candidates: ReplayCandidate[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];
  const sourceClient = createPacedSourceClient(options);

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const pageUrl = toPageUrl(options.sourceUrl, page);
      // Source requests are intentionally sequential to preserve source order.
      // eslint-disable-next-line no-await-in-loop
      const sourceText = await sourceClient.fetchText(pageUrl);
      const fixture = parseSourceFixture(sourceText);
      // Page detail fetches are part of the same source-order sequence.
      // eslint-disable-next-line no-await-in-loop
      const pageCandidates = await discoverPageCandidates({
        fixture,
        page,
        pageUrl,
        sourceClient,
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

function createPacedSourceClient(
  options: DiscoverReplaysDryRunOptions,
): SourceClient {
  const requestDelayMs = options.requestDelayMs ?? defaultRequestDelayMs;
  const sleep = options.sleep ?? defaultSleep;
  let requestCount = 0;

  return {
    async fetchText(url: URL): Promise<string> {
      if (requestCount > 0 && requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }

      requestCount += 1;

      return options.sourceClient.fetchText(url);
    },
  };
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
    generatedAt: input.options.generatedAt ?? new Date().toISOString(),
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
    return collectFixtureCandidates(input.fixture, input.pageUrl);
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
      const candidate = await discoverRowCandidate(
        input.sourceClient,
        row,
        row.source.url,
      );

      if (candidate === undefined) {
        diagnostics.push(
          withOptionalDiagnosticEvidence(
            {
              code: "missing_filename",
              message: "Replay detail page did not include a filename",
              severity: "warning",
              sourceUrl: row.source.url,
            },
            diagnosticEvidence(row.source.externalId, row.page),
          ),
        );
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

function collectFixtureCandidates(
  fixture: SourceFixture,
  pageUrl: URL,
): DiscoverPageCandidatesResult {
  const candidates: ReplayCandidate[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];

  for (const [index, candidate] of fixture.candidates.entries()) {
    const result = toReplayCandidate(candidate, index, pageUrl);

    if (result.candidate === undefined) {
      diagnostics.push(result.diagnostic);
    } else {
      candidates.push(result.candidate);
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
  sourceUrl: string,
): Promise<ReplayCandidate | undefined> {
  const detailHtml = await sourceClient.fetchText(new URL(sourceUrl));
  const filename = extractFilenameFromDetailHtml(detailHtml);

  if (filename === undefined) {
    return undefined;
  }

  return toReplayCandidateFromHtmlRow(filename, row, sourceUrl);
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
      diagnostics.push(
        withOptionalDiagnosticEvidence(
          {
            candidateIndex: outputCandidates.length,
            code: "duplicate_filename",
            message: "Filename appeared more than once in source discovery",
            severity: "warning",
            sourceUrl: candidate.source.url,
          },
          diagnosticEvidence(
            candidate.source.externalId,
            candidate.source.page,
          ),
        ),
      );

      if (hasChangedMetadata(existingEntries, candidate)) {
        diagnostics.push(
          withOptionalDiagnosticEvidence(
            {
              candidateIndex: outputCandidates.length,
              code: "changed_metadata",
              message:
                "Filename/source ID metadata changed within one discovery run",
              severity: "warning",
              sourceUrl: candidate.source.url,
            },
            diagnosticEvidence(
              candidate.source.externalId,
              candidate.source.page,
            ),
          ),
        );
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

function diagnosticEvidence(
  externalId: string | undefined,
  page: number | undefined,
): {
  readonly externalId?: string;
  readonly page?: number;
} {
  const evidence: {
    externalId?: string;
    page?: number;
  } = {};

  if (externalId !== undefined) {
    evidence.externalId = externalId;
  }

  if (page !== undefined) {
    evidence.page = page;
  }

  return evidence;
}

function withOptionalDiagnosticEvidence(
  diagnostic: DiscoveryDiagnostic,
  evidence: {
    readonly externalId?: string;
    readonly page?: number;
  },
): DiscoveryDiagnostic {
  const nextDiagnostic: {
    candidateIndex?: number;
    code: DiscoveryDiagnostic["code"];
    externalId?: string;
    message: string;
    page?: number;
    severity: DiscoveryDiagnostic["severity"];
    sourceUrl?: string;
  } = { ...diagnostic };

  if (evidence.externalId !== undefined) {
    nextDiagnostic.externalId = evidence.externalId;
  }

  if (evidence.page !== undefined) {
    nextDiagnostic.page = evidence.page;
  }

  return nextDiagnostic;
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

  const candidate: ReplayCandidate = {
    identity: { filename },
    source,
  };

  if (Object.keys(row.metadata).length > 0) {
    return {
      ...candidate,
      metadata: row.metadata,
    };
  }

  return candidate;
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

function toReplayCandidate(
  candidate: SourceCandidateFixture,
  index: number,
  pageUrl: URL,
): CandidateFixtureResult {
  if (
    typeof candidate.filename !== "string" ||
    candidate.filename.trim().length === 0 ||
    typeof candidate.url !== "string" ||
    candidate.url.trim().length === 0
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
}

function toPageUrl(sourceUrl: URL, page: number): URL {
  if (page === 1) {
    return sourceUrl;
  }

  const pageUrl = new URL(sourceUrl);
  pageUrl.searchParams.set("p", String(page));

  return pageUrl;
}

/* v8 ignore next 5 -- tested through injected sleep to avoid real timer delay. */
async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
