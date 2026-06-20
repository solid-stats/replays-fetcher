import type { Logger } from "pino";

import type {
  DiscoveryReport,
  ReplayCandidate,
  SourceClient,
} from "../discovery/types.js";
import { createLimiter } from "../source/concurrency.js";
import type { LimitFunction } from "../source/concurrency.js";
import { createPacer } from "../source/pacing.js";
import type { Pacer } from "../source/pacing.js";
import type { RetryAttemptEvent } from "../source/retry.js";
import type { StagingRepository } from "../staging/stage-raw-replay.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { ReplayByteClient } from "../storage/replay-byte-client.js";
import type { S3RawReplayStorage } from "../storage/s3-raw-storage.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import { ingestPage } from "./ingest-page.js";
import { buildRunSummary, toCompactSummary } from "./summary.js";

const WATCH_PAGE = 1;

/* v8 ignore next 5 -- the real timer sleep is replaced by an injected fake in tests; the production default is exercised only by the running daemon. */
const defaultSleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

/**
 * Always-on watch loop dependencies (factory-DI shape). The watcher is
 * page-1-only and CHECKPOINT-INDEPENDENT: there is deliberately NO
 * `checkpointStore` in this contract — the watcher never reads or advances the
 * source checkpoint (WATCH-02). It reuses the source resilience knobs
 * (`attempts`/`concurrency`/`requestSpacingMs`) rather than inventing new ones
 * (WATCH-03). `sleep`, `now`, `writeHeartbeat`, `createRunId`, and `shouldStop`
 * are all injectable seams so the loop is unit-testable with fake timers and
 * fakes (no network, no real sleeps).
 */
export type WatchLoopInput = {
  readonly attempts?: number;
  readonly byteClient: ReplayByteClient;
  readonly concurrency: number;
  readonly createLimiter?: (concurrency: number) => LimitFunction;
  // Inter-cycle source-pacing floor seam (mirrors run-once's `createPacer`).
  // Optional: defaults to a real `createPacer`. Tests inject a fake pacer to
  // observe that the floor is awaited before each cycle's discovery.
  readonly createPacer?: (spacingMs: number) => Pacer;
  readonly createRunId: (now: Date) => string;
  readonly discoverReplays: (input: {
    readonly attempts?: number;
    readonly log?: Logger;
    readonly maxPages?: number;
    readonly onRetry?: (event: RetryAttemptEvent) => void;
    readonly requestDelayMs?: number;
    readonly sourceClient: SourceClient;
    readonly sourceUrl: URL;
  }) => Promise<DiscoveryReport>;
  readonly heartbeatPath: string;
  readonly intervalMs: number;
  readonly log: Logger;
  readonly now: () => Date;
  readonly requestSpacingMs: number;
  readonly shouldStop: () => boolean;
  // Inter-cycle yield seam. Optional: defaults to a real `setTimeout` sleep.
  // Tests inject a synchronous fake (never a real wall-clock sleep).
  readonly sleep?: (ms: number) => Promise<void>;
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
  readonly writeHeartbeat: (path: string, body: string) => Promise<void>;
};

export type WatchLoopResult = {
  readonly exitCode: 0;
};

const defaultPacer = (spacingMs: number): Pacer => createPacer({ spacingMs });

const buildDiscoverInput = (
  input: WatchLoopInput,
): {
  readonly attempts?: number;
  readonly log: Logger;
  readonly maxPages: number;
  readonly requestDelayMs: number;
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
} => {
  // PAGE 1 ONLY: maxPages is pinned to 1 and the sourceUrl is the unmodified
  // page-1 URL — the watcher never constructs a page-2 URL.
  //
  // requestDelayMs threads the source request-spacing floor INTO discovery so
  // the within-cycle list→detail source requests self-pace (the OUTER
  // inter-request floor inside `discoverReplays`, never compounded with retry
  // backoff). Combined with the inter-cycle pacer floor in `runWatchLoop`, this
  // makes EVERY page-1 source request respect `requestSpacingMs`.
  if (input.attempts === undefined) {
    return {
      log: input.log,
      maxPages: WATCH_PAGE,
      requestDelayMs: input.requestSpacingMs,
      sourceClient: input.sourceClient,
      sourceUrl: input.sourceUrl,
    };
  }

  return {
    attempts: input.attempts,
    log: input.log,
    maxPages: WATCH_PAGE,
    requestDelayMs: input.requestSpacingMs,
    sourceClient: input.sourceClient,
    sourceUrl: input.sourceUrl,
  };
};

/**
 * Runs ONE page-1 poll cycle: discover page 1, fan the store→stage over a fresh
 * shared limiter via the checkpoint-free `ingestPage` helper, then assemble and
 * emit exactly one compact run summary (reusing the run-once summary builders,
 * tagged `mode: "watch"`). Returns nothing — the heartbeat write and any error
 * handling live in the caller so a thrown cycle does NOT write a stale
 * heartbeat.
 */
const runCycle = async (input: WatchLoopInput, pacer: Pacer): Promise<void> => {
  // One cycle start instant: both the run-summary `startedAt` and the runId-seed
  // timestamp derive from the SAME `now()` reading (no double clock read).
  const cycleStart = input.now();
  const startedAt = cycleStart.toISOString();
  const runId = input.createRunId(cycleStart);
  const limit = (input.createLimiter ?? createLimiter)(input.concurrency);

  // Source-pacing floor: await the remaining inter-request floor BEFORE the
  // cycle's page-1 list read so consecutive cycles self-pace to ~the
  // request-spacing rate (never compounded with the adapter's retry backoff).
  // This is run-once's per-list-page floor applied to the watcher's per-cycle
  // boundary — at interval=0 it is what bounds the cycle rate instead of a flood.
  await pacer.awaitFloor();
  const report = await input.discoverReplays(buildDiscoverInput(input));
  const { rawStorage, staging } = await ingestPage({
    byteClient: input.byteClient,
    candidates: report.candidates,
    limit,
    runId,
    stageRawReplay: input.stageRawReplay,
    stagingRepository: input.stagingRepository,
    storage: input.storage,
    storeRawReplay: input.storeRawReplay,
  });

  const summary = buildRunSummary({
    discoveryReport: report,
    finishedAt: input.now().toISOString(),
    mode: "watch",
    rawStorage,
    runId,
    staging,
    startedAt,
  });

  // §D operational surface: exactly one compact run summary per cycle, carrying
  // discovered/stored/staged/skipped/failed counts. Routed through the logger
  // (stderr) — identifiers + counts only, no body/secret.
  input.log.info(
    { event: "watch_cycle_complete", summary: toCompactSummary(summary) },
    "watch cycle complete",
  );
};

/**
 * The always-on page-1 poll loop with graceful shutdown, per-cycle resilience,
 * and a per-cycle heartbeat for the k8s exec liveness probe (NO HTTP server).
 *
 * Pacing: `intervalMs` is the inter-cycle idle sleep. The default is 0
 * (continuous polling) — the next cycle starts immediately after the previous
 * one finishes. interval=0 is SAFE because the loop owns a `createPacer` floor
 * (`requestSpacingMs`): every cycle awaits `pacer.awaitFloor()` before its
 * page-1 list read, and `requestSpacingMs` is threaded into discovery
 * (`requestDelayMs`) so the within-cycle list→detail source requests self-pace
 * too. Together that bounds the cycle rate to ~the request-spacing rate instead
 * of flooding the source — the pacing is APPLIED by orchestration here, not
 * merely documented (§A.4: resilience policies applied by orchestration). The
 * loop ALSO ALWAYS awaits `sleep(intervalMs)` between cycles (even at 0):
 * `sleep(0)` is a real event-loop yield, so the loop can never CPU hot-spin and
 * always observes a shutdown signal promptly even when no awaited network work
 * ran in a cycle.
 *
 * Resilience (WATCH-05): each cycle is wrapped in try/catch INSIDE the loop. A
 * caught error is logged at warn (`watch_cycle_failed`, identifiers-only) and
 * the loop CONTINUES to the next cycle — a transient failure never kills the
 * daemon. The heartbeat is written only after a SUCCESSFUL cycle.
 *
 * Shutdown (WATCH-04): `shouldStop()` (driven by the SIGTERM/SIGINT seam wired
 * in the command) is checked at the top of each iteration and again after the
 * inter-cycle sleep, so a signal finishes/aborts the current wait cleanly and
 * exits the loop. The loop NEVER calls `process.exit()`; it resolves
 * `{ exitCode: 0 }` on clean shutdown.
 */
export const runWatchLoop = async (
  input: WatchLoopInput,
): Promise<WatchLoopResult> => {
  // One pacer per loop so the inter-request floor PERSISTS across cycles — the
  // remaining floor for cycle N+1 is measured from cycle N's dispatch.
  const pacer = (input.createPacer ?? defaultPacer)(input.requestSpacingMs);

  while (!input.shouldStop()) {
    try {
      await runCycle(input, pacer);
      await input.writeHeartbeat(
        input.heartbeatPath,
        JSON.stringify({ timestamp: input.now().toISOString() }),
      );
    } catch (error) {
      // WATCH-05: log-and-continue. Identifiers-only payload (the error object
      // for the stack); no source body/secret is interpolated into the static
      // message. The loop proceeds to the next cycle.
      input.log.warn(
        { error, event: "watch_cycle_failed" },
        "watch cycle failed",
      );
    }

    if (input.shouldStop()) {
      break;
    }

    // Always yield (sleep(0) at interval=0 is a real event-loop tick) so the
    // loop can never CPU hot-spin and observes shutdown promptly. The actual
    // source self-pacing is enforced by the pacer floor inside runCycle, not by
    // this yield.
    await (input.sleep ?? defaultSleep)(input.intervalMs);
  }

  return { exitCode: 0 };
};
