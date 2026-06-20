import type { Logger } from "pino";

import type { CheckpointPage } from "../checkpoint/checkpoint.js";
import type { S3CheckpointStore } from "../checkpoint/s3-checkpoint-store.js";
import type {
  DiscoveryDiagnostic,
  DiscoveryReport,
  ReplayCandidate,
  SourceClient,
} from "../discovery/types.js";
import type { S3EvidenceStore } from "../evidence/s3-evidence-store.js";
import type { LimitFunction } from "../source/concurrency.js";
import type { Pacer } from "../source/pacing.js";
import type { RetryAttemptEvent } from "../source/retry.js";
import type { ThrottleController } from "../source/throttle.js";
import type { StagingRepository } from "../staging/stage-raw-replay.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { ReplayByteClient } from "../storage/replay-byte-client.js";
import type { S3RawReplayStorage } from "../storage/s3-raw-storage.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import type { RunExitCode, RunSummary } from "./types.js";

export type RunOnceResult = {
  readonly exitCode: RunExitCode;
  readonly summary: RunSummary;
};

export type RunOnceInput = {
  readonly attempts?: number;
  readonly byteClient: ReplayByteClient;
  readonly checkpointStore: S3CheckpointStore;
  readonly concurrency: number;
  readonly createLimiter?: (concurrency: number) => LimitFunction;
  readonly createPacer?: (spacingMs: number) => Pacer;
  readonly createThrottle?: (options: {
    readonly baseConcurrency: number;
    readonly baseSpacingMs: number;
    readonly max: number;
    readonly min: number;
  }) => ThrottleController;
  readonly discoverReplays: (input: {
    readonly attempts?: number;
    readonly log?: Logger;
    readonly maxPages?: number;
    readonly onRetry?: (event: RetryAttemptEvent) => void;
    readonly requestDelayMs?: number;
    readonly sourceClient: SourceClient;
    readonly sourceUrl: URL;
  }) => Promise<DiscoveryReport>;
  readonly log?: Logger;
  readonly maxPages?: number;
  readonly now: () => Date;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly requestSpacingMs: number;
  readonly resume?: boolean;
  readonly runId: string;
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
  readonly stageRawReplay: (input: {
    readonly rawResult: StoreRawReplayResult;
    readonly repository: StagingRepository;
    readonly runId?: string;
  }) => Promise<IngestStagingResult>;
  readonly stagingRepository: StagingRepository;
  readonly storage: S3RawReplayStorage;
  readonly storeRawReplay: (input: {
    readonly byteClient: ReplayByteClient;
    readonly candidate: ReplayCandidate;
    readonly storage: S3RawReplayStorage;
  }) => Promise<StoreRawReplayResult>;
  // D-12/D-13: opt-in evidence write seams (independent, log-and-continue).
  // `emitEvidence` gates the S3 store write; `evidenceFile`+`writeEvidenceFile`
  // gate the dev-only local-disk write. Both default to off.
  readonly emitEvidence?: boolean;
  readonly evidenceStore?: S3EvidenceStore;
  readonly evidenceFile?: string;
  readonly writeEvidenceFile?: (path: string, body: string) => Promise<void>;
};

export type MutableDiscoveryReport = {
  candidates: ReplayCandidate[];
  counts: DiscoveryReport["counts"];
  diagnostics: DiscoveryDiagnostic[];
  generatedAt: string;
  mode: "dry-run";
  ok: boolean;
  sourceUrl: string;
};

export type MutablePageCounts = {
  discovered: number;
  failed: number;
  staged: number;
  stored: number;
};

export type AssembleResultInput = {
  readonly discoveryReport: MutableDiscoveryReport;
  readonly etag: string | undefined;
  readonly lastCompletedPage: number;
  // Per-page completion timestamps (injected clock, ms) carried for Wave 3's
  // summary rate/ETA derivation. This plan captures and threads the data; the
  // summary-field derivation lands in Plan 05.
  readonly pageTimestampsMs: readonly number[];
  readonly pages: Record<string, CheckpointPage>;
  readonly rawStorage: readonly StoreRawReplayResult[];
  readonly reachedMaxPages: boolean;
  readonly slug: string;
  readonly staging: readonly IngestStagingResult[];
  readonly startedAt: string;
};

export const FIRST_PAGE = 1;

export const emptyDiscoveryReport = (
  sourceUrl: string,
): MutableDiscoveryReport => ({
  candidates: [],
  counts: {
    candidates: 0,
    diagnostics: 0,
    discovered: 0,
  },
  diagnostics: [],
  generatedAt: new Date().toISOString(),
  mode: "dry-run",
  ok: true,
  sourceUrl,
});
