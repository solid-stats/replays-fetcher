import type { Command } from "commander";

import type { AppConfig } from "../config.js";
import type { DiscoveryReport, SourceClient } from "../discovery/types.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import {
  buildRetryWarnEmitter,
  loadDryRunSourceConfig,
  loadStoreRawConfig,
  writeJson,
} from "./shared.js";
import type { BuildCliDependencies, StoreRawResources } from "./shared.js";
import { createStoreRawResources } from "./store-raw-resources.js";

type DiscoverOptions = {
  readonly dryRun?: boolean;
  readonly stage?: boolean;
  readonly storeRaw?: boolean;
};

type RawStorageCounts = {
  readonly candidates: number;
  readonly conflict: number;
  readonly diagnostics: number;
  readonly failed: number;
  readonly skipped: number;
  readonly stored: number;
};

type StagingCounts = {
  readonly alreadyStaged: number;
  readonly conflict: number;
  readonly failed: number;
  readonly skipped: number;
  readonly staged: number;
};

const countRawStorage = (
  discoveryReport: DiscoveryReport,
  storageResults: readonly StoreRawReplayResult[],
): RawStorageCounts => ({
  candidates: discoveryReport.candidates.length,
  conflict: storageResults.filter((result) => result.status === "conflict")
    .length,
  diagnostics: discoveryReport.diagnostics.length,
  failed: storageResults.filter((result) => result.status === "failed").length,
  skipped: storageResults.filter((result) => result.status === "skipped")
    .length,
  stored: storageResults.filter((result) => result.status === "stored").length,
});

const countStaging = (
  stagingResults: readonly IngestStagingResult[],
): StagingCounts => ({
  alreadyStaged: stagingResults.filter(
    (result) => result.status === "already_staged",
  ).length,
  conflict: stagingResults.filter((result) => result.status === "conflict")
    .length,
  failed: stagingResults.filter((result) => result.status === "failed").length,
  skipped: stagingResults.filter((result) => result.status === "not_stageable")
    .length,
  staged: stagingResults.filter((result) => result.status === "staged").length,
});

const storeRawMode = (
  shouldStage: boolean,
): "store-raw" | "store-raw-and-stage" => {
  if (shouldStage) {
    return "store-raw-and-stage";
  }

  return "store-raw";
};

type StoreRawCountsResult =
  | RawStorageCounts
  | { readonly rawStorage: RawStorageCounts; readonly staging: StagingCounts };

const storeRawCounts = (
  shouldStage: boolean,
  rawCounts: RawStorageCounts,
  stagingCounts: StagingCounts,
): StoreRawCountsResult => {
  if (shouldStage) {
    return { rawStorage: rawCounts, staging: stagingCounts };
  }

  return rawCounts;
};

const stageRawEvidence = async (
  dependencies: Pick<Required<BuildCliDependencies>, "stageRawReplay">,
  repository: StoreRawResources["stagingRepository"],
  rawResult: StoreRawReplayResult,
): Promise<IngestStagingResult> => {
  /* v8 ignore next -- registerDiscoverCommand only calls staging when the repository was created. */
  if (repository === undefined) {
    throw new Error("Expected staging repository for stage mode");
  }

  return dependencies.stageRawReplay({ rawResult, repository });
};

const discoverForStoreRaw = async (
  dependencies: Required<BuildCliDependencies>,
  config: AppConfig,
  sourceClient: SourceClient,
): Promise<DiscoveryReport> => {
  const runId = dependencies.createRunId(dependencies.now());
  const log = dependencies.createLogger().child({ runId });

  return dependencies.discoverReplaysDryRun({
    attempts: config.sourceRetryAttempts,
    onRetry: buildRetryWarnEmitter(log),
    sourceClient,
    sourceUrl: new URL(config.sourceUrl),
  });
};

const runDryRunDiscovery = async (
  dependencies: Required<BuildCliDependencies>,
): Promise<void> => {
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
  const runId = dependencies.createRunId(dependencies.now());
  const log = dependencies.createLogger().child({ runId });
  const report = await dependencies.discoverReplaysDryRun({
    attempts: configResult.config.sourceRetryAttempts,
    onRetry: buildRetryWarnEmitter(log),
    sourceClient,
    sourceUrl: new URL(configResult.config.sourceUrl),
  });

  writeJson(report);

  if (!report.ok) {
    process.exitCode = 2;
  }
};

const runStoreRawDiscovery = async (
  dependencies: Required<BuildCliDependencies>,
  shouldStage: boolean,
): Promise<void> => {
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

  // The store-raw discover path has no run loop, but the composition-root
  // teardown still needs a logger so a dispose-time S3/pg failure is diagnosable
  // ([std: correctness §AA]).
  const log = dependencies.createLogger();
  const resources = createStoreRawResources(dependencies, configResult.config, {
    log,
    shouldStage,
  });
  const discoveryReport = await discoverForStoreRaw(
    dependencies,
    configResult.config,
    resources.sourceClient,
  );
  const storageResults: StoreRawReplayResult[] = [];
  const stagingResults: IngestStagingResult[] = [];

  if (discoveryReport.ok) {
    for (const candidate of discoveryReport.candidates) {
      // Raw replay storage is intentionally sequential for clear source/storage evidence.
      const result = await dependencies.storeRawReplay({
        byteClient: resources.byteClient,
        candidate,
        storage: resources.storage,
      });
      storageResults.push(result);

      if (shouldStage) {
        // Staging follows the raw evidence for the same candidate in order.
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
    writeJson({ ...report, staging: stagingResults });
  } else {
    writeJson(report);
  }

  if (!ok) {
    process.exitCode = 2;
  }
};

export const registerDiscoverCommand = (
  program: Command,
  dependencies: Required<BuildCliDependencies>,
): void => {
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

      await runDryRunDiscovery(dependencies);
    });
};
