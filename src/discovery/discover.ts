import type {
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

export async function discoverReplaysDryRun(
  options: DiscoverReplaysDryRunOptions,
): Promise<DiscoveryReport> {
  const sourceText = await options.sourceClient.fetchText(options.sourceUrl);
  const fixture = parseSourceFixture(sourceText);
  const candidates = fixture.candidates.map(toReplayCandidate);

  return {
    ok: true,
    mode: "dry-run",
    sourceUrl: options.sourceUrl.toString(),
    generatedAt: options.generatedAt ?? new Date(0).toISOString(),
    ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
    counts: {
      discovered: candidates.length,
      candidates: candidates.length,
      diagnostics: 0,
    },
    candidates,
    diagnostics: [],
  };
}

function parseSourceFixture(text: string): SourceFixture {
  const parsed = JSON.parse(text) as SourceFixture;

  return {
    candidates: parsed.candidates,
  };
}

function toReplayCandidate(
  candidate: SourceCandidateFixture,
): ReplayCandidate {
  return {
    identity: {
      filename: candidate.filename,
    },
    source: {
      url: candidate.url,
      ...(candidate.externalId === undefined
        ? {}
        : { externalId: candidate.externalId }),
      ...(candidate.page === undefined ? {} : { page: candidate.page }),
    },
    metadata: {
      ...(candidate.discoveredAt === undefined
        ? {}
        : { discoveredAt: candidate.discoveredAt }),
      ...(candidate.missionText === undefined
        ? {}
        : { missionText: candidate.missionText }),
      ...(candidate.serverId === undefined
        ? {}
        : { serverId: candidate.serverId }),
      ...(candidate.world === undefined ? {} : { world: candidate.world }),
    },
  };
}
