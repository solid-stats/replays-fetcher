import { buildConfigInvalidRunSummary, runExitCode } from "../run/summary.js";

import {
  createStoreRawResources,
  flushLogger,
  loadStoreRawConfig,
  writeJson,
} from "./shared.js";

import type { BuildCliDependencies } from "./shared.js";
import type { StagingRepository } from "../staging/stage-raw-replay.js";
import type { Command } from "commander";

const requireStagingRepository = (
  repository: StagingRepository | undefined,
): StagingRepository => {
  /* v8 ignore next 3 -- watch always requests staging resources. */
  if (repository === undefined) {
    throw new Error("Expected staging repository for watch");
  }

  return repository;
};

/**
 * SIGTERM/SIGINT graceful-shutdown seam (WATCH-04). A mutable flag flipped by
 * the signal handlers; `shouldStop` is passed into `runWatchLoop`, which checks
 * it at the top of each iteration and after the inter-cycle sleep so a signal
 * finishes/aborts the current wait cleanly and exits the loop. NEVER calls
 * `process.exit()` — the command awaits the loop, drains pino, then sets
 * `process.exitCode`.
 *
 * `dispose()` removes BOTH handlers (the unfired counterpart included) so the
 * production code owns its own listener cleanup instead of leaning on a test
 * harness's `removeAllListeners`. The same `requestStop` ref is passed to
 * `removeListener` so `process.once`'s internal once-wrapper is matched and
 * removed even if the signal never fired. The caller invokes `dispose()` in a
 * `finally` after the loop resolves.
 */
const createShutdownSeam = (): {
  readonly dispose: () => void;
  readonly shouldStop: () => boolean;
} => {
  let stopRequested = false;
  const requestStop = (): void => {
    stopRequested = true;
  };

  process.once("SIGTERM", requestStop);
  process.once("SIGINT", requestStop);

  return {
    dispose: (): void => {
      process.removeListener("SIGTERM", requestStop);
      process.removeListener("SIGINT", requestStop);
    },
    shouldStop: () => stopRequested,
  };
};

export const registerWatchCommand = (
  program: Command,
  dependencies: Required<BuildCliDependencies>,
): void => {
  program
    .command("watch")
    .description(
      "Run an always-on page-1 poll loop, ingesting new replays within seconds",
    )
    .action(async () => {
      const startedAt = dependencies.now();
      const runId = dependencies.createRunId(startedAt);
      const rootLogger = dependencies.createLogger();
      const log = rootLogger.child({ runId });
      const configResult = loadStoreRawConfig(dependencies);

      if (!configResult.ok) {
        // §C/§D: config validates before any side effect, so nothing is
        // touched. Emit the config-invalid summary and exit 2 (mirrors
        // run-once exactly — the only exit-2 path).
        const finishedAt = dependencies.now().toISOString();
        const summary = buildConfigInvalidRunSummary({
          finishedAt,
          issues: configResult.issues,
          runId,
          startedAt: startedAt.toISOString(),
        });
        writeJson(summary);
        process.exitCode = runExitCode(summary);
        return;
      }

      const resources = createStoreRawResources(
        dependencies,
        configResult.config,
        true,
      );
      const { dispose: disposeShutdownSeam, shouldStop } = createShutdownSeam();

      try {
        // WATCH-02: the watcher is checkpoint-independent —
        // resources.checkpointStore is deliberately NOT passed into the loop
        // (runWatchLoop has no checkpointStore seam), so the watcher can neither
        // read nor advance the source checkpoint.
        const result = await dependencies.runWatchLoop({
          attempts: configResult.config.sourceRetryAttempts,
          byteClient: resources.byteClient,
          concurrency: configResult.config.sourceConcurrency,
          createRunId: dependencies.createRunId,
          discoverReplays: dependencies.discoverReplaysDryRun,
          heartbeatPath: configResult.config.watchHeartbeatPath,
          intervalMs: configResult.config.watchIntervalMs,
          log,
          now: dependencies.now,
          requestSpacingMs: configResult.config.sourceRequestSpacingMs,
          shouldStop,
          sourceClient: resources.sourceClient,
          sourceUrl: new URL(configResult.config.sourceUrl),
          stageRawReplay: dependencies.stageRawReplay,
          stagingRepository: requireStagingRepository(
            resources.stagingRepository,
          ),
          storage: resources.storage,
          storeRawReplay: dependencies.storeRawReplay,
          writeHeartbeat: dependencies.writeHeartbeat,
        });

        // D-16 (PROG-04): drain pino BEFORE setting process.exitCode, never
        // process.exit() mid-stream. exitCode 0 on clean shutdown.
        await flushLogger(rootLogger);
        process.exitCode = result.exitCode;
      } finally {
        // ARCH-05: drain the composition-root clients AFTER the loop resolves
        // (the drain point — in-flight ingest is already done) and after the
        // pino flush. Idempotent: a double signal still ends the pool once.
        await resources.dispose();
        // Production-owned listener cleanup: remove both signal handlers
        // (including the unfired counterpart) so the daemon never leaks a
        // process listener and does not lean on a test harness's
        // removeAllListeners.
        disposeShutdownSeam();
      }
    });
};
