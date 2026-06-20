import type { Command } from "commander";
import type { Pool } from "pg";

import { connectivityOk } from "../check/connectivity.js";
import type { ConnectivityCheck } from "../check/connectivity.js";
import { redactConfig } from "../config.js";
import { ConfigValidationError } from "../errors/config-validation-error.js";
import { writeJson } from "./shared.js";
import type { BuildCliDependencies } from "./shared.js";

/**
 * Runs the read-only staging probe against the injected, composition-root pool
 * and always releases it ([std: correctness §AB] resource lifecycle) — the
 * pool was built once for this command rather than per-adapter.
 */
const runStagingCheck = async (
  dependencies: Required<BuildCliDependencies>,
  pool: Pool,
): Promise<ConnectivityCheck> => {
  try {
    return await dependencies.checkPostgresConnectivity({ client: pool });
  } finally {
    await pool.end();
  }
};

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
        // One S3 client + one pg pool per command, built once at the
        // composition root and injected into the read-only probes
        // ([std: correctness] External adapters one-client rule).
        const s3Client = dependencies.createS3Client(config.s3);
        const pool = dependencies.createPgPool(config.staging.databaseUrl);
        const sourceConnectivity = await dependencies.checkSourceConnectivity({
          sourceClient,
          sourceUrl: new URL(config.sourceUrl),
        });
        const s3Connectivity = await dependencies.checkS3Connectivity({
          bucket: config.s3.bucket,
          sender: s3Client,
        });
        const stagingConnectivity = await runStagingCheck(dependencies, pool);
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
};
