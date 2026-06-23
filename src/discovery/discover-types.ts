import type { Logger } from "pino";

import type { RetryAttemptEvent } from "../source/retry.js";
import type {
  DiscoveryDiagnostic,
  ReplayCandidate,
  SourceClient,
} from "./types.js";

// The pre-detail dedup predicate (260623-x57). Defined INLINE here rather than
// imported from `src/run/ingest-page.ts` (`ExistsBySourceIdentity`): that would
// be an upward import from a capability into orchestration and break discovery
// fences 1+6 (discovery is read-only, downward-only). The watch path INJECTS a
// concrete implementation; run-once / discover --dry-run omit it.
export type DiscoverExistsBySourceIdentity = (
  sourceSystem: string,
  sourceReplayId: string,
) => Promise<boolean>;

export type DiscoverReplaysDryRunOptions = {
  readonly attempts?: number;
  // Watch-only pre-detail dedup gate. When present, a list row whose trustworthy
  // externalId already has a staging row is skipped BEFORE its detail HTML is
  // fetched. Absent (run-once / discover) ⇒ the gate is inert and behavior is
  // byte-for-byte unchanged.
  readonly existsBySourceIdentity?: DiscoverExistsBySourceIdentity;
  readonly generatedAt?: string;
  readonly log?: Logger;
  readonly maxPages?: number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly requestDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly sourceClient: SourceClient;
  // The `sourceSystem` the candidate would be staged under, so the pre-detail
  // SELECT keys match the eventual staging INSERT (Pitfall 3). Supplied by the
  // watch path alongside the predicate.
  readonly sourceSystem?: string;
  readonly sourceUrl: URL;
};

export type ReadOptions = {
  readonly attempts?: number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly page: number;
  readonly phase: "detail" | "list";
};

export type BuildReportOptions = {
  readonly candidates: readonly ReplayCandidate[];
  readonly diagnostics: readonly DiscoveryDiagnostic[];
  readonly ok: boolean;
  readonly options: DiscoverReplaysDryRunOptions;
  // Accumulated count of rows skipped before their detail fetch by the watch
  // pre-detail gate. Defaults to 0 (run-once never skips pre-detail).
  readonly skippedPreDetail: number;
};

export type DiscoverPageCandidatesResult = {
  readonly candidates: readonly ReplayCandidate[];
  readonly diagnostics: readonly DiscoveryDiagnostic[];
  // Rows skipped before any detail fetch on this page because their trustworthy
  // externalId already had a staging row. Always present (0 on the fixture path
  // and when no predicate is supplied) so the type is total.
  readonly skippedPreDetail: number;
};
