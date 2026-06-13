import {
  loadDryRunSourceConfig,
  writeJson,
} from "./shared.js";

import type { BuildCliDependencies } from "./shared.js";

import type { Command } from "commander";

export const registerContractCheckCommand = (
  program: Command,
  dependencies: Required<BuildCliDependencies>,
): void => {
  program
    .command("contract-check")
    .description(
      "Verify the live source contract: list page, first detail, and its raw JSON endpoint — no S3/PostgreSQL writes.",
    )
    .action(async () => {
      const configResult = loadDryRunSourceConfig(dependencies);

      if (!configResult.ok) {
        writeJson({
          issues: configResult.issues,
          ok: false,
          reason: "config_error",
        });
        process.exitCode = 2;
        return;
      }

      const sourceClient = dependencies.createSourceClient(configResult.config);
      const result = await dependencies.runContractCheck({
        sourceClient,
        sourceUrl: new URL(configResult.config.sourceUrl),
      });

      writeJson(result);

      if (!result.ok) {
        process.exitCode = 2;
      }
    });
}
