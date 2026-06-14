/**
 * Side-effect-only Sentry bootstrap. Imported first by `src/cli.ts` so the
 * errors-only SDK is initialised before any other side-effecting import runs
 * (the documented Sentry pattern: a dedicated instrument module imported ahead
 * of application code). Keep this file import-only — no exports — so importing
 * `cli.ts` in unit tests does not pull in the live Sentry init; only the binary
 * entrypoint imports it.
 */

import { initSentry } from "./sentry.js";

initSentry();
