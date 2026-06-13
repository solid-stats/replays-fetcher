#!/usr/bin/env node
import { Command } from "commander";

import { registerCheckCommand } from "./commands/check.js";
import { registerContractCheckCommand } from "./commands/contract-check.js";
import { registerDiscoverCommand } from "./commands/discover.js";
import { registerRunOnceCommand } from "./commands/run-once.js";
import {
  resolveDependencies,
  type BuildCliDependencies,
} from "./commands/shared.js";

export const buildCli = (dependencies: BuildCliDependencies = {}): Command => {
  const cliDependencies = resolveDependencies(dependencies);
  const program = new Command();

  program
    .name("replays-fetcher")
    .description("Solid Stats replay ingest service")
    .version("0.1.0");

  registerCheckCommand(program, cliDependencies);
  registerDiscoverCommand(program, cliDependencies);
  registerRunOnceCommand(program, cliDependencies);
  registerContractCheckCommand(program, cliDependencies);

  return program;
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
