#!/usr/bin/env node
/* eslint-disable max-lines -- CLI command handlers are kept together for command-surface readability. */
import { randomUUID } from "node:crypto";

import { Command } from "commander";

import { connectivityOk } from "./check/connectivity.js";
import { checkPostgresConnectivityFromDatabaseUrl } from "./check/postgres-connectivity.js";
import {
  checkS3Connectivity,
  createS3ConnectivitySenderFromConfig,
} from "./check/s3-connectivity.js";
import { checkSourceConnectivity } from "./check/source-connectivity.js";
import {
  ConfigError,
  loadConfig,
  loadSourceConfig,
  redactConfig,
  type AppConfig,
  type SourceConfig,
} from "./config.js";
import { discoverReplaysDryRun } from "./discovery/discover.js";
import { createSourceClient } from "./discovery/source-client.js";
import {
  createLogger,
  type CreateLoggerOptions,
} from "./logging/create-logger.js";
import { runOnce } from "./run/run-once.js";
import { buildConfigInvalidRunSummary, runExitCode } from "./run/summary.js";
import {
  createPostgresStagingRepositoryFromDatabaseUrl,
  type PostgresStagingRepository,
} from "./staging/postgres-staging-repository.js";
import {
  stageRawReplay,
  type StagingRepository,
} from "./staging/stage-raw-replay.js";
import {
  createReplayByteClient,
  type ReplayByteClient,
} from "./storage/replay-byte-client.js";
import {
  createS3RawReplayStorageFromConfig,
  type S3RawReplayStorage,
} from "./storage/s3-raw-storage.js";
import {
  storeRawReplay,
  type StoreRawReplayResult,
} from "./storage/store-raw-replay.js";

import type { DiscoveryReport, SourceClient } from "./discovery/types.js";
import type { IngestStagingResult } from "./staging/types.js";
import type { Logger } from "pino";

type SourceConfigResult =
  | {
      readonly config: SourceConfig;
      readonly ok: true;
    }
  | {
      readonly issues: readonly string[];
      readonly ok: false;
    };

type AppConfigResult =
  | {
      readonly config: AppConfig;
      readonly ok: true;
    }
  | {
      readonly issues: readonly string[];
      readonly ok: false;
    };

interface BuildCliDependencies {
  readonly checkPostgresConnectivityFromDatabaseUrl?: typeof checkPostgresConnectivityFromDatabaseUrl;
  readonly checkS3Connectivity?: typeof checkS3Connectivity;
  readonly checkSourceConnectivity?: typeof checkSourceConnectivity;
  readonly createLogger?: (options?: CreateLoggerOptions) => Logger;
  readonly createRunId?: (now: Date) => string;
  readonly createS3ConnectivitySenderFromConfig?: typeof createS3ConnectivitySenderFromConfig;
  readonly createReplayByteClient?: (config: SourceConfig) => ReplayByteClient;
  readonly createS3RawReplayStorageFromConfig?: (
    config: AppConfig["s3"],
  ) => S3RawReplayStorage;
  readonly createPostgresStagingRepositoryFromDatabaseUrl?: (
    databaseUrl: string,
  ) => PostgresStagingRepository;
  readonly createSourceClient?: (config: SourceConfig) => SourceClient;
  readonly discoverReplaysDryRun?: typeof discoverReplaysDryRun;
  readonly loadConfig?: () => AppConfig;
  readonly loadSourceConfig?: () => SourceConfig;
  readonly now?: () => Date;
  readonly runOnce?: typeof runOnce;
  readonly stageRawReplay?: typeof stageRawReplay;
  readonly storeRawReplay?: typeof storeRawReplay;
}

interface DiscoverOptions {
  readonly dryRun?: boolean;
  readonly stage?: boolean;
  readonly storeRaw?: boolean;
}

interface RawStorageCounts {
  readonly candidates: number;
  readonly conflict: number;
  readonly diagnostics: number;
  readonly failed: number;
  readonly skipped: number;
  readonly stored: number;
}

interface StagingCounts {
  readonly alreadyStaged: number;
  readonly conflict: number;
  readonly failed: number;
  readonly skipped: number;
  readonly staged: number;
}

interface StoreRawResources {
  readonly byteClient: ReplayByteClient;
  readonly sourceClient: SourceClient;
  readonly stagingRepository: StagingRepository | undefined;
  readonly storage: S3RawReplayStorage;
}

export function buildCli(dependencies: BuildCliDependencies = {}): Command {
  const cliDependencies = resolveDependencies(dependencies);
  const program = new Command();

  program
    .name("replays-fetcher")
    .description("Solid Stats replay ingest service")
    .version("0.1.0");

  registerCheckCommand(program, cliDependencies);
  registerDiscoverCommand(program, cliDependencies);
  registerRunOnceCommand(program, cliDependencies);

  return program;
}

function resolveDependencies(
  dependencies: BuildCliDependencies,
): Required<BuildCliDependencies> {
  return {
    checkPostgresConnectivityFromDatabaseUrl,
    checkS3Connectivity,
    checkSourceConnectivity,
    createLogger,
    createRunId,
    createReplayByteClient,
    createS3ConnectivitySenderFromConfig,
    createPostgresStagingRepositoryFromDatabaseUrl,
    createS3RawReplayStorageFromConfig,
    createSourceClient,
    discoverReplaysDryRun,
    loadConfig,
    loadSourceConfig,
    now: () => new Date(),
    runOnce,
    stageRawReplay,
    storeRawReplay,
    ...dependencies,
  };
}

function registerCheckCommand(
  program: Command,
  dependencies: Required<BuildCliDependencies>,
): void {
  program
    .command("check")
    .description("Validate required configuration before running ingest work")
    .action(async () => {
      try {
        const config = dependencies.loadConfig();
        const sourceClient = dependencies.createSourceClient(config);
        const s3ConnectivitySender =
          dependencies.createS3ConnectivitySenderFromConfig(config.s3);
        const sourceConnectivity = await dependencies.checkSourceConnectivity({
          sourceClient,
          sourceUrl: new URL(config.sourceUrl),
        });
        const s3Connectivity = await dependencies.checkS3Connectivity({
          bucket: config.s3.bucket,
          sender: s3ConnectivitySender,
        });
        const stagingConnectivity =
          await dependencies.checkPostgresConnectivityFromDatabaseUrl(
            config.staging.databaseUrl,
          );
        const checks = {
          s3Connectivity,
          sourceConnectivity,
          stagingConnectivity,
        };
        const ok = connectivityOk(checks);

        writeJson({
          ok,
          checks: {
            config: { status: "passed" },
            ...checks,
          },
          config: redactConfig(config),
        });

        if (!ok) {
          process.exitCode = 2;
        }
      } catch (error) {
        if (error instanceof ConfigError) {
          writeJson({
            ok: false,
            checks: {
              config: { status: "failed" },
            },
            issues: error.issues,
          });
          process.exitCode = 2;
          return;
        }

        throw error;
      }
    });
}

function registerDiscoverCommand(
  program: Command,
  dependencies: Required<BuildCliDependencies>,
): void {
  program
    .command("discover")
    .description("Discover replay candidates")
    .option(
      "--dry-run",
      "report candidates without writing S3 or staging records",
    )
    .option(
      "--store-raw",
      "discover candidates and store raw replay objects without staging",
    )
    .option("--stage", "write pending server-2 staging rows after raw storage")
    .action(async (options: DiscoverOptions) => {
      if (options.dryRun === true && options.storeRaw === true) {
        writeJson({
          ok: false,
          error: "discover accepts only one mode: --dry-run or --store-raw",
        });
        process.exitCode = 2;
        return;
      }

      if (options.stage === true && options.storeRaw !== true) {
        writeJson({
          ok: false,
          error: "discover --stage requires --store-raw",
        });
        process.exitCode = 2;
        return;
      }

      if (options.storeRaw === true) {
        await runStoreRawDiscovery(dependencies, options.stage === true);
        return;
      }

      if (options.dryRun !== true) {
        writeJson({
          ok: false,
          error: "discover requires --dry-run or --store-raw",
        });
        process.exitCode = 2;
        return;
      }

      const configResult = loadDryRunSourceConfig(dependencies);
      if (!configResult.ok) {
        writeJson({
          ok: false,
          error: "discover dry-run configuration is invalid",
          issues: configResult.issues,
        });
        process.exitCode = 2;
        return;
      }

      const sourceClient = dependencies.createSourceClient(configResult.config);
      const report = await dependencies.discoverReplaysDryRun({
        sourceClient,
        sourceUrl: new URL(configResult.config.sourceUrl),
      });

      writeJson(report);

      if (!report.ok) {
        process.exitCode = 2;
      }
    });
}

function registerRunOnceCommand(
  program: Command,
  dependencies: Required<BuildCliDependencies>,
): void {
  program
    .command("run-once")
    .description("Execute one scheduled ingest cycle")
    .action(async () => {
      const startedAt = dependencies.now();
      const runId = dependencies.createRunId(startedAt);
      const rootLogger = dependencies.createLogger();
      const log = rootLogger.child({ runId });
      // CORE-02 substrate: the per-run child logger is keyed by runId. stdout
      // cleanliness for the JSON summary contract (parsed by cli.test.ts) is
      // guaranteed by the logger writing to stderr (createLogger defaults its
      // destination to process.stderr), not by the log level — so emitting at
      // debug or any level cannot interleave with the stdout summary.
      log.debug({ runId }, "run-once started");
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
        byteClient: resources.byteClient,
        discoverReplays: dependencies.discoverReplaysDryRun,
        now: dependencies.now,
        runId,
        maxPages: configResult.config.sourceMaxPages,
        sourceClient: resources.sourceClient,
        sourceUrl: new URL(configResult.config.sourceUrl),
        stageRawReplay: dependencies.stageRawReplay,
        stagingRepository: requireStagingRepository(
          resources.stagingRepository,
        ),
        storage: resources.storage,
        storeRawReplay: dependencies.storeRawReplay,
      });

      writeJson(result.summary);
      process.exitCode = result.exitCode;
    });
}

function createRunId(now: Date): string {
  return `run-${now.toISOString()}-${randomUUID()}`;
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

async function runStoreRawDiscovery(
  dependencies: Required<BuildCliDependencies>,
  shouldStage: boolean,
): Promise<void> {
  const configResult = loadStoreRawConfig(dependencies);
  if (!configResult.ok) {
    writeJson({
      ok: false,
      error: "discover store-raw configuration is invalid",
      issues: configResult.issues,
    });
    process.exitCode = 2;
    return;
  }

  const resources = createStoreRawResources(
    dependencies,
    configResult.config,
    shouldStage,
  );
  const discoveryReport = await dependencies.discoverReplaysDryRun({
    sourceClient: resources.sourceClient,
    sourceUrl: new URL(configResult.config.sourceUrl),
  });
  const storageResults: StoreRawReplayResult[] = [];
  const stagingResults: IngestStagingResult[] = [];

  if (discoveryReport.ok) {
    for (const candidate of discoveryReport.candidates) {
      // Raw replay storage is intentionally sequential for clear source/storage evidence.
      // eslint-disable-next-line no-await-in-loop
      const result = await dependencies.storeRawReplay({
        byteClient: resources.byteClient,
        candidate,
        storage: resources.storage,
      });
      storageResults.push(result);

      if (shouldStage) {
        // Staging follows the raw evidence for the same candidate in order.
        // eslint-disable-next-line no-await-in-loop
        const stagingResult = await stageRawEvidence(
          dependencies,
          resources.stagingRepository,
          result,
        );
        stagingResults.push(stagingResult);
      }
    }
  }

  const rawCounts = countRawStorage(discoveryReport, storageResults);
  const stagingCounts = countStaging(stagingResults);
  const ok =
    discoveryReport.ok &&
    rawCounts.conflict === 0 &&
    rawCounts.failed === 0 &&
    stagingCounts.conflict === 0 &&
    stagingCounts.failed === 0;

  const report = {
    ok,
    mode: storeRawMode(shouldStage),
    sourceUrl: discoveryReport.sourceUrl,
    generatedAt: discoveryReport.generatedAt,
    counts: storeRawCounts(shouldStage, rawCounts, stagingCounts),
    candidates: discoveryReport.candidates,
    diagnostics: discoveryReport.diagnostics,
    storage: storageResults,
  };

  if (shouldStage) {
    writeJson({
      ...report,
      staging: stagingResults,
    });
  } else {
    writeJson(report);
  }

  if (!ok) {
    process.exitCode = 2;
  }
}

function createStoreRawResources(
  dependencies: Required<BuildCliDependencies>,
  config: AppConfig,
  shouldStage: boolean,
): StoreRawResources {
  return {
    byteClient: dependencies.createReplayByteClient(config),
    sourceClient: dependencies.createSourceClient(config),
    stagingRepository: createStagingRepository(
      dependencies,
      config,
      shouldStage,
    ),
    storage: dependencies.createS3RawReplayStorageFromConfig(config.s3),
  };
}

function createStagingRepository(
  dependencies: Pick<
    Required<BuildCliDependencies>,
    "createPostgresStagingRepositoryFromDatabaseUrl"
  >,
  config: AppConfig,
  shouldStage: boolean,
): StagingRepository | undefined {
  if (!shouldStage) {
    return undefined;
  }

  return dependencies.createPostgresStagingRepositoryFromDatabaseUrl(
    config.staging.databaseUrl,
  );
}

function storeRawMode(
  shouldStage: boolean,
): "store-raw" | "store-raw-and-stage" {
  if (shouldStage) {
    return "store-raw-and-stage";
  }

  return "store-raw";
}

function storeRawCounts(
  shouldStage: boolean,
  rawCounts: RawStorageCounts,
  stagingCounts: StagingCounts,
):
  | RawStorageCounts
  | {
      readonly rawStorage: RawStorageCounts;
      readonly staging: StagingCounts;
    } {
  if (shouldStage) {
    return {
      rawStorage: rawCounts,
      staging: stagingCounts,
    };
  }

  return rawCounts;
}

async function stageRawEvidence(
  dependencies: Pick<Required<BuildCliDependencies>, "stageRawReplay">,
  repository: StagingRepository | undefined,
  rawResult: StoreRawReplayResult,
): Promise<IngestStagingResult> {
  /* v8 ignore next -- registerDiscoverCommand only calls staging when the repository was created. */
  if (repository === undefined) {
    throw new Error("Expected staging repository for stage mode");
  }

  return dependencies.stageRawReplay({
    rawResult,
    repository,
  });
}

function loadDryRunSourceConfig(
  dependencies: Pick<Required<BuildCliDependencies>, "loadSourceConfig">,
): SourceConfigResult {
  try {
    return {
      config: dependencies.loadSourceConfig(),
      ok: true,
    };
  } catch (error) {
    if (error instanceof ConfigError) {
      return {
        issues: error.issues,
        ok: false,
      };
    }

    /* v8 ignore next -- defensive guard for unexpected config loader failures. */
    throw error;
  }
}

function loadStoreRawConfig(
  dependencies: Pick<Required<BuildCliDependencies>, "loadConfig">,
): AppConfigResult {
  try {
    return {
      config: dependencies.loadConfig(),
      ok: true,
    };
  } catch (error) {
    if (error instanceof ConfigError) {
      return {
        issues: error.issues,
        ok: false,
      };
    }

    /* v8 ignore next -- defensive guard for unexpected config loader failures. */
    throw error;
  }
}

function countRawStorage(
  discoveryReport: DiscoveryReport,
  storageResults: readonly StoreRawReplayResult[],
): RawStorageCounts {
  return {
    candidates: discoveryReport.candidates.length,
    conflict: storageResults.filter((result) => result.status === "conflict")
      .length,
    diagnostics: discoveryReport.diagnostics.length,
    failed: storageResults.filter((result) => result.status === "failed")
      .length,
    skipped: storageResults.filter((result) => result.status === "skipped")
      .length,
    stored: storageResults.filter((result) => result.status === "stored")
      .length,
  };
}

function countStaging(
  stagingResults: readonly IngestStagingResult[],
): StagingCounts {
  return {
    alreadyStaged: stagingResults.filter(
      (result) => result.status === "already_staged",
    ).length,
    conflict: stagingResults.filter((result) => result.status === "conflict")
      .length,
    failed: stagingResults.filter((result) => result.status === "failed")
      .length,
    skipped: stagingResults.filter(
      (result) => result.status === "not_stageable",
    ).length,
    staged: stagingResults.filter((result) => result.status === "staged")
      .length,
  };
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`);
}

const [, entrypointPath] = process.argv;

/* v8 ignore next -- exercised by the installed binary, not unit tests. */
if (
  entrypointPath !== undefined &&
  import.meta.url === `file://${entrypointPath}`
) {
  /* v8 ignore next -- exercised by the installed binary, not unit tests. */
  await buildCli().parseAsync(process.argv);
}
