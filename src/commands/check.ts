import { connectivityOk } from "../check/connectivity.js";
import { redactConfig } from "../config.js";
import { ConfigValidationError } from "../errors/config-validation-error.js";

import { writeJson } from "./shared.js";

import type { BuildCliDependencies } from "./shared.js";

import type { Command } from "commander";

export const registerCheckCommand = (
  program: Command,
  dependencies: Required<BuildCliDependencies>,
): void => {
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
        if (error instanceof ConfigValidationError) {
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
