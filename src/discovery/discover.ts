/* eslint-disable max-lines -- Discovery orchestration is split once storage/staging phases add separate modules. */
import { extractFilenameFromDetailHtml, extractReplayRows } from "./html.js";
import { SourceFetchError } from "./source-client.js";

import type {
  DiscoveryDiagnostic,
  DiscoveryReport,
  ReplayCandidate,
  SourceClient,
} from "./types.js";
import type { RetryAttemptEvent } from "../source/retry.js";

interface DiscoverReplaysDryRunOptions {
  readonly attempts?: number;
  readonly generatedAt?: string;
  readonly maxPages?: number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly requestDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
}

interface ReadOptions {
  readonly attempts?: number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly page: number;
  readonly phase: "detail" | "list";
}

interface SourceCandidateFixture {
  readonly discoveredAt?: string;
  readonly externalId?: string;
  readonly filename: string;
  readonly missionText?: string;
  readonly page?: number;
  readonly rawUrl?: string;
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
  rawUrl?: string;
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

// The blanket per-request delay is retired as the NORMAL pacing source: the
// run-once `createPacer` floor (RANGE-04) is now the single pacing knob. A
// `requestDelayMs` is opt-in only; defaulted to zero so discovery applies no
// blanket delay unless a caller explicitly requests one.
const defaultRequestDelayMs = 0;

export async function discoverReplaysDryRun(
  options: DiscoverReplaysDryRunOptions,
): Promise<DiscoveryReport> {
  const maxPages = options.maxPages ?? 1;
  const candidates: ReplayCandidate[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];
  const sourceClient = createPacedSourceClient(options);
  // Tracks the page being read when a source failure throws, so the terminal
  // diagnostic can re-attach `page` even if the thrown error's details somehow
  // omit it (defense-in-depth for DIAG-01; the adapters are the primary source).
  let failedPage = 1;

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      failedPage = page;
      const pageUrl = toPageUrl(options.sourceUrl, page);
      const listReadOptions = buildReadOptions(options, page, "list");
      // Source requests are intentionally sequential to preserve source order.
      // eslint-disable-next-line no-await-in-loop -- source requests are intentionally sequential to preserve source order.
      const sourceText = await sourceClient.fetchText(pageUrl, listReadOptions);
      const fixture = parseSourceFixture(sourceText);
      // Page detail fetches are part of the same source-order sequence.
      // eslint-disable-next-line no-await-in-loop -- page detail fetches are part of the same source-order sequence.
      const pageCandidates = await discoverPageCandidates({
        detailReadOptions: buildReadOptions(options, page, "detail"),
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

    diagnostics.push(
      buildSourceFailureDiagnostic(error, options.sourceUrl, failedPage),
    );

    return buildReport({ candidates, diagnostics, ok: false, options });
  }

  return buildReport({ candidates, diagnostics, ok: true, options });
}

function buildReadOptions(
  options: DiscoverReplaysDryRunOptions,
  page: number,
  phase: "detail" | "list",
): ReadOptions {
  let readOptions: ReadOptions = { page, phase };

  if (options.attempts !== undefined) {
    readOptions = { ...readOptions, attempts: options.attempts };
  }

  if (options.onRetry !== undefined) {
    readOptions = { ...readOptions, onRetry: options.onRetry };
  }

  return readOptions;
}

/**
 * Maps the thrown `SourceFetchError` into an enriched, identifiers-only
 * `DiscoveryDiagnostic` (DIAG-01/04). The enriched evidence (phase, httpStatus,
 * causeCode, causeMessage, page, attempts, cfChallenge) is read from the
 * error's `details` allowlist; each optional field is attached only when defined
 * so exact-optional typing holds. No response body / bytes / secret is copied.
 */
function buildSourceFailureDiagnostic(
  error: SourceFetchError,
  sourceUrl: URL,
  failedPage: number,
): DiscoveryDiagnostic {
  const base: DiscoveryDiagnostic = {
    code: error.code,
    message: error.message,
    page: failedPage,
    severity: "error",
    sourceUrl: detailUrlOrSource(error, sourceUrl),
  };

  return withSourceFailureEvidence(base, error.details);
}

function detailUrlOrSource(error: SourceFetchError, sourceUrl: URL): string {
  const url = error.details?.["url"];

  if (typeof url === "string") {
    return url;
  }

  return sourceUrl.toString();
}

function withSourceFailureEvidence(
  diagnostic: DiscoveryDiagnostic,
  details: Readonly<Record<string, unknown>> | undefined,
): DiscoveryDiagnostic {
  if (details === undefined) {
    return diagnostic;
  }

  let next = attachNumber(diagnostic, "attempts", details["attempts"]);
  next = attachNumber(next, "httpStatus", details["httpStatus"]);
  next = attachNumber(next, "page", details["page"]);
  next = attachString(next, "causeCode", details["causeCode"]);
  next = attachString(next, "causeMessage", details["causeMessage"]);
  next = attachPhase(next, details["phase"]);
  next = attachCfChallenge(next, details["cfChallenge"]);

  return next;
}

function attachNumber(
  diagnostic: DiscoveryDiagnostic,
  key: "attempts" | "httpStatus" | "page",
  value: unknown,
): DiscoveryDiagnostic {
  if (typeof value !== "number") {
    return diagnostic;
  }

  return { ...diagnostic, [key]: value };
}

function attachString(
  diagnostic: DiscoveryDiagnostic,
  key: "causeCode" | "causeMessage",
  value: unknown,
): DiscoveryDiagnostic {
  if (typeof value !== "string") {
    return diagnostic;
  }

  return { ...diagnostic, [key]: value };
}

function attachPhase(
  diagnostic: DiscoveryDiagnostic,
  value: unknown,
): DiscoveryDiagnostic {
  if (value !== "bytes" && value !== "detail" && value !== "list") {
    return diagnostic;
  }

  return { ...diagnostic, phase: value };
}

function attachCfChallenge(
  diagnostic: DiscoveryDiagnostic,
  value: unknown,
): DiscoveryDiagnostic {
  if (value !== true) {
    return diagnostic;
  }

  return { ...diagnostic, cfChallenge: true };
}

function createPacedSourceClient(
  options: DiscoverReplaysDryRunOptions,
): SourceClient {
  const requestDelayMs = options.requestDelayMs ?? defaultRequestDelayMs;
  const sleep = options.sleep ?? defaultSleep;
  let requestCount = 0;

  return {
    async fetchText(url: URL, readOptions?): Promise<string> {
      // Pacing is the OUTER inter-request delay; backoff lives inside the
      // adapter's withRetry. requestCount increments once per fetchText call,
      // NOT once per retry round (Pitfall 5: no double-count).
      if (requestCount > 0 && requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }

      requestCount += 1;

      return options.sourceClient.fetchText(url, readOptions);
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
  readonly detailReadOptions: ReadOptions;
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
      // eslint-disable-next-line no-await-in-loop -- source requests are intentionally sequential to avoid aggressive polling.
      const candidate = await discoverRowCandidate({
        detailReadOptions: input.detailReadOptions,
        row,
        sourceClient: input.sourceClient,
        sourceUrl: row.source.url,
      });

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

async function discoverRowCandidate(input: {
  readonly detailReadOptions: ReadOptions;
  readonly row: ReturnType<typeof extractReplayRows>[number];
  readonly sourceClient: SourceClient;
  readonly sourceUrl: string;
}): Promise<ReplayCandidate | undefined> {
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

function toReplayCandidateFromHtmlRow(input: {
  readonly filename: string;
  readonly rawUrl: string;
  readonly row: ReturnType<typeof extractReplayRows>[number];
  readonly sourceUrl: string;
}): ReplayCandidate {
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
}

function isValidFixtureUrl(value: string): boolean {
  return URL.parse(value) !== null;
}

function toPageUrl(sourceUrl: URL, page: number): URL {
  if (page === 1) {
    return sourceUrl;
  }

  const pageUrl = new URL(sourceUrl);
  pageUrl.searchParams.set("p", String(page));

  return pageUrl;
}

export function toRawReplayUrl(filename: string, detailUrl: URL): string {
  let rawFilename = filename;

  if (!rawFilename.endsWith(".json")) {
    rawFilename = `${rawFilename}.json`;
  }

  return new URL(`/data/${encodeURIComponent(rawFilename)}`, detailUrl)
    .toString()
    .replaceAll("%2F", "/");
}

/* v8 ignore next 5 -- tested through injected sleep to avoid real timer delay. */
async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
