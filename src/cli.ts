#!/usr/bin/env node
// Side-effect import FIRST: ./observability/instrument initialises the
// errors-only Sentry SDK before any other side-effecting import runs, so an
// early throw (including a config-loader crash) is still reported. An empty
// SENTRY_DSN leaves the SDK disabled (a no-op), so this is safe unconditionally.
// oxlint-disable-next-line import/no-unassigned-import -- Sentry must init before sibling import side effects; ESM hoists imports, so a bare side-effect import is the only ordering guarantee.
import "./observability/instrument.js";
import { Command } from "commander";

import { registerCheckCommand } from "./commands/check.js";
import { registerContractCheckCommand } from "./commands/contract-check.js";
import { registerDiscoverCommand } from "./commands/discover.js";
import { registerRunOnceCommand } from "./commands/run-once.js";
import { resolveDependencies } from "./commands/shared.js";
import type { BuildCliDependencies } from "./commands/shared.js";
import { registerWatchCommand } from "./commands/watch.js";
import { captureFatal, flushSentry } from "./observability/sentry.js";

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
  registerWatchCommand(program, cliDependencies);
  registerContractCheckCommand(program, cliDependencies);

  return program;
};

const [, entrypointPath] = process.argv;

/* v8 ignore start -- exercised by the installed binary, not unit tests. */
if (
  entrypointPath !== undefined &&
  import.meta.url === `file://${entrypointPath}`
) {
  try {
    await buildCli().parseAsync(process.argv);
  } catch (error) {
    // An unexpected throw escaped a command handler (programmer bug). Report it
    // to Sentry and surface a non-zero exit; never call process.exit() so pino
    // output drains and resources tear down cleanly (§D).
    captureFatal(error);
    process.exitCode = 1;
  } finally {
    // CronJob-specific: the pod terminates as soon as this short-lived process
    // exits, so queued Sentry events MUST be flushed first on EVERY path — both
    // a clean run and a captured failure — or they are lost. A no-op when the
    // SDK is disabled (empty SENTRY_DSN).
    await flushSentry();
  }
}
/* v8 ignore stop */
