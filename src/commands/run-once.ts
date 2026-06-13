import {
  buildConfigInvalidRunSummary,
  runExitCode,
  toCompactSummary,
} from "../run/summary.js";

import {
  buildRetryWarnEmitter,
  createStoreRawResources,
  loadStoreRawConfig,
  writeJson,
  type BuildCliDependencies,
} from "./shared.js";

import type { StagingRepository } from "../staging/stage-raw-replay.js";
import type { Command } from "commander";
import type { Logger } from "pino";

interface RunOnceOptions {
  readonly emitEvidence?: boolean;
  readonly evidenceFile?: string;
  readonly resume?: boolean;
}

export function registerRunOnceCommand(
  program: Command,
  dependencies: Required<BuildCliDependencies>,
): void {
  program
    .command("run-once")
    .description("Execute one scheduled ingest cycle")
    .option(
      "--resume",
      "resume from the last completed page using the source checkpoint",
    )
    .option(
      "--emit-evidence",
      "write a durable per-candidate evidence artifact to S3",
    )
    .option(
      "--evidence-file <path>",
      "also write the evidence artifact to a local file (dev only)",
    )
    .action(async (options: RunOnceOptions) => {
      const startedAt = dependencies.now();
      const runId = dependencies.createRunId(startedAt);
      const rootLogger = dependencies.createLogger();
      const log = rootLogger.child({ runId });
      // CORE-02 substrate: the per-run child logger is keyed by runId. stdout
      // cleanliness for the JSON summary contract (parsed by cli.test.ts) is
      // guaranteed by the logger writing to stderr (createLogger defaults its
      // destination to process.stderr), not by the log level — so emitting at
      // debug or any level cannot interleave with the stdout summary.
      const configResult = loadStoreRawConfig(dependencies);

      if (!configResult.ok) {
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
      const result = await dependencies.runOnce({
        attempts: configResult.config.sourceRetryAttempts,
        byteClient: resources.byteClient,
        checkpointStore: resources.checkpointStore,
        concurrency: configResult.config.sourceConcurrency,
        discoverReplays: dependencies.discoverReplaysDryRun,
        emitEvidence: options.emitEvidence === true,
        evidenceStore: dependencies.createS3EvidenceStoreFromConfig(
          configResult.config.s3,
        ),
        log,
        now: dependencies.now,
        onRetry: buildRetryWarnEmitter(log),
        requestSpacingMs: configResult.config.sourceRequestSpacingMs,
        resume: options.resume === true,
        runId,
        ...maxPagesOption(configResult.config.sourceMaxPages),
        ...evidenceFileOption(options.evidenceFile),
        sourceClient: resources.sourceClient,
        sourceUrl: new URL(configResult.config.sourceUrl),
        stageRawReplay: dependencies.stageRawReplay,
        stagingRepository: requireStagingRepository(
          resources.stagingRepository,
        ),
        storage: resources.storage,
        storeRawReplay: dependencies.storeRawReplay,
        writeEvidenceFile: dependencies.writeEvidenceFile,
      });

      // D-02 (PROG-02): stdout carries exactly one compact JSON document.
      // The full RunSummary (with heavy arrays) is kept in-memory for the
      // opt-in evidence artifact; the stdout projection strips all arrays.
      writeJson(toCompactSummary(result.summary));
      // D-16 (PROG-04): await the pino flush AFTER the stdout write and BEFORE
      // setting process.exitCode so the final NDJSON lines drain cleanly without
      // calling process.exit() (streams drain naturally on exit).
      await flushLogger(rootLogger);
      process.exitCode = result.exitCode;
    });
}

/**
 * Wraps pino's callback-based `log.flush(cb)` in a Promise so the cli action
 * can `await` the flush before setting `process.exitCode` (D-16/PROG-04).
 * Resolves on success; rejects on error. Never calls `process.exit()`.
 */
function flushLogger(log: Logger): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    log.flush((flushError) => {
      if (flushError !== undefined) {
        reject(flushError);
        return;
      }

      resolve();
    });
  });
}

function evidenceFileOption(evidenceFile: string | undefined): {
  evidenceFile?: string;
} {
  if (evidenceFile === undefined) {
    return {};
  }

  return { evidenceFile };
}

function maxPagesOption(maxPages: number | undefined): {
  maxPages?: number;
} {
  if (maxPages === undefined) {
    return {};
  }

  return { maxPages };
}

function requireStagingRepository(
  repository: StagingRepository | undefined,
): StagingRepository {
  /* v8 ignore next -- run-once always requests staging resources. */
  if (repository === undefined) {
    throw new Error("Expected staging repository for run-once");
  }

  return repository;
}
