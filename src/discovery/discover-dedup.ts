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

  return { candidates: outputCandidates, diagnostics };
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
  };
};

export const discoverPageCandidates = async (input: {
  readonly detailReadOptions: ReadOptions;
  readonly fixture: SourceFixture | undefined;
  readonly page: number;
  readonly pageUrl: URL;
  readonly sourceClient: SourceClient;
  readonly sourceText: string;
}): Promise<DiscoverPageCandidatesResult> => {
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
};
