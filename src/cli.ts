#!/usr/bin/env node
import { Command } from "commander";

import { ConfigError, loadConfig, redactConfig } from "./config.js";
import { discoverReplaysDryRun } from "./discovery/discover.js";
import { createSourceClient } from "./discovery/source-client.js";

export function buildCli(): Command {
  const program = new Command();

  program
    .name("replays-fetcher")
    .description("Solid Stats replay ingest service")
    .version("0.1.0");

  program
    .command("check")
    .description("Validate required configuration before running ingest work")
    .action(() => {
      try {
        const config = loadConfig();
        writeJson({
          ok: true,
          checks: {
            config: "passed",
            sourceConnectivity: "not-implemented",
            s3Connectivity: "not-implemented",
            stagingConnectivity: "not-implemented",
          },
          config: redactConfig(config),
        });
      } catch (error) {
        if (error instanceof ConfigError) {
          writeJson({
            ok: false,
            checks: {
              config: "failed",
            },
            issues: error.issues,
          });
          process.exitCode = 2;
          return;
        }

        throw error;
      }
    });

  program
    .command("discover")
    .description("Discover replay candidates")
    .option(
      "--dry-run",
      "report candidates without writing S3 or staging records",
    )
    .action(async (options: { readonly dryRun?: boolean }) => {
      if (options.dryRun !== true) {
        writeJson({
          ok: false,
          error: "discover requires --dry-run until Phase 3",
        });
        process.exitCode = 2;
        return;
      }

      const config = loadConfig();
      const sourceClient = createSourceClient(config);
      const report = await discoverReplaysDryRun({
        sourceClient,
        sourceUrl: new URL(config.sourceUrl),
      });

      writeJson(report);
    });

  program
    .command("run-once")
    .description("Execute one scheduled ingest cycle")
    .action(() => {
      throw new Error("run-once is planned for Phase 5");
    });

  return program;
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
