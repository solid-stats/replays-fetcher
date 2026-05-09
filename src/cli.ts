#!/usr/bin/env node
import { Command } from "commander";

import { ConfigError, loadConfig, redactConfig } from "./config.js";

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
    .action(() => {
      throw new Error("discover is planned for Phase 2");
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
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildCli().parseAsync(process.argv);
}
