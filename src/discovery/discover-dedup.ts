import {
  discoverRowCandidate,
  toReplayCandidate,
} from "./discover-candidate.js";
import type { SourceFixture } from "./discover-candidate.js";
import {
  diagnosticEvidence,
  withOptionalDiagnosticEvidence,
} from "./discover-diagnostics.js";
import type {
  DiscoverExistsBySourceIdentity,
  DiscoverPageCandidatesResult,
  ReadOptions,
} from "./discover-types.js";
import { extractReplayRows } from "./html.js";
import type {
  DiscoveryDiagnostic,
  ReplayCandidate,
  SourceClient,
} from "./types.js";

type CandidateRegistryEntry = {
  readonly candidate: ReplayCandidate;
  readonly serialized: string;
};

// Must match the cannot-miss guard in src/run/ingest-page.ts:109 (rule-of-three
// not hit; discovery fences 1+6 forbid importing from run/). An externalId is
// trustworthy for a pre-detail skip IFF it is a string non-empty after trim — an
// absent/empty/whitespace id stages under a `derived:` form that needs the
// downloaded checksum, so it cannot be matched pre-detail and MUST still fetch.
const isTrustworthyId = (id: string | undefined): id is string =>
  id !== undefined && id.trim().length > 0;

// True iff this row's detail fetch may be skipped pre-detail: the watch-only
// predicate is present, the row carries a trustworthy externalId, and a staging
// row already exists for it under the supplied sourceSystem. Any other state
// (no predicate, no sourceSystem, untrustworthy id, not yet staged) falls
// through to the detail fetch — preserving the cannot-miss guard.
const shouldSkipPreDetail = async (
  externalId: string | undefined,
  existsBySourceIdentity: DiscoverExistsBySourceIdentity | undefined,
  sourceSystem: string | undefined,
): Promise<boolean> =>
  existsBySourceIdentity !== undefined &&
  sourceSystem !== undefined &&
  isTrustworthyId(externalId) &&
  (await existsBySourceIdentity(sourceSystem, externalId));

const hasChangedMetadata = (
  existingEntries: readonly CandidateRegistryEntry[],
  candidate: ReplayCandidate,
): boolean => {
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
};

const collectCandidateDiagnostics = (
  candidates: readonly ReplayCandidate[],
): DiscoverPageCandidatesResult => {
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

  // This is the dedup pass over already-fetched candidates; it performs no
  // pre-detail skip. The caller owns the page-level skippedPreDetail total.
  return { candidates: outputCandidates, diagnostics, skippedPreDetail: 0 };
};

const collectFixtureCandidates = (
  fixture: SourceFixture,
  pageUrl: URL,
): DiscoverPageCandidatesResult => {
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
    // The fixture path (run-once / discover) never gates pre-detail.
    skippedPreDetail: 0,
  };
};

export const discoverPageCandidates = async (input: {
  readonly detailReadOptions: ReadOptions;
  // Watch-only pre-detail dedup predicate (260623-x57). Present iff the caller
  // opts in (the watch path); run-once / discover omit it and the gate is inert.
  readonly existsBySourceIdentity?: DiscoverExistsBySourceIdentity;
  readonly fixture: SourceFixture | undefined;
  readonly page: number;
  readonly pageUrl: URL;
  readonly sourceClient: SourceClient;
  // The sourceSystem the pre-detail SELECT keys on, matching the staging INSERT.
  readonly sourceSystem?: string;
  readonly sourceText: string;
}): Promise<DiscoverPageCandidatesResult> => {
  if (input.fixture !== undefined) {
    return collectFixtureCandidates(input.fixture, input.pageUrl);
  }

  const candidates: ReplayCandidate[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];
  const rows = extractReplayRows(input.sourceText, input.page, input.pageUrl);
  let skippedPreDetail = 0;

  for (const row of rows) {
    const rowUrl = row.source.url;

    if (rowUrl === undefined) {
      diagnostics.push({
        code: "malformed_row",
        message: "Source row did not include a replay link",
        page: row.page,
        severity: "warning",
        sourceUrl: input.pageUrl.toString(),
      });
    } else if (
      // Pre-detail dedup gate (260623-x57): fires only on the watch path (the
      // predicate is injected), only for a trustworthy externalId, and only
      // when a staging row already exists. A skip emits NO candidate and NO
      // diagnostic — it is neither processed nor malformed — and the skipped
      // row never calls fetchText, so it consumes no request-spacing slot
      // (Pitfall 5). The `await` in this sequential row loop is the deliberate
      // pre-detail gate against a rate-limited source, not an N+1 violation.
      await shouldSkipPreDetail(
        row.source.externalId,
        input.existsBySourceIdentity,
        input.sourceSystem,
      )
    ) {
      skippedPreDetail += 1;
    } else {
      // Source requests are intentionally sequential to avoid aggressive polling.
      const candidate = await discoverRowCandidate({
        detailReadOptions: input.detailReadOptions,
        row,
        sourceClient: input.sourceClient,
        sourceUrl: rowUrl,
      });

      if (candidate === undefined) {
        diagnostics.push(
          withOptionalDiagnosticEvidence(
            {
              code: "missing_filename",
              message: "Replay detail page did not include a filename",
              severity: "warning",
              sourceUrl: rowUrl,
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
    skippedPreDetail,
  };
};
