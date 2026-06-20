import { buildLoopState } from "./run-once-checkpoint.js";
import { buildRunRuntime, runPageLoop } from "./run-once-page.js";
import { assembleResult, derivePagesPerMinute } from "./run-once-summary.js";
import type { RunOnceInput, RunOnceResult } from "./run-once-types.js";

// Re-exported so callers can import RunOnceResult and the public page-rate helper
// from run-once.js unchanged after the result type was lifted into
// run-once-types.ts and the rate/emit/assemble cluster moved into
// run-once-summary.ts.
export type { RunOnceResult };
export { derivePagesPerMinute };

/**
 * Normalize the source URL for durable persistence: drop any `username`/
 * `password` userinfo so an operator-supplied `https://user:pass@host/...`
 * never leaks credentials into the checkpoint body or promotion_evidence
 * (WR-02, threat T-09-01). Identity (host + path + query) is preserved.
 */
const sanitizeSourceUrl = (sourceUrl: URL): string => {
  const cleaned = new URL(sourceUrl);
  cleaned.username = "";
  cleaned.password = "";

  return cleaned.toString();
};

export const runOnce = async (input: RunOnceInput): Promise<RunOnceResult> => {
  const startedAt = input.now().toISOString();
  // The slug is persisted in the checkpoint body and reaches promotion_evidence;
  // strip any userinfo (user:pass@host) so credentials never land in a durable
  // artifact (WR-02 / threat T-09-01).
  const slug = sanitizeSourceUrl(input.sourceUrl);
  // D-03/D-04: emit run_start (info) at the top of the run. The slug is already
  // userinfo-stripped (WR-02). The message is static — no data interpolated.
  input.log?.info(
    { event: "run_start", runId: input.runId, sourceUrl: slug },
    "run start",
  );

  const { limit, pacer, throttle } = buildRunRuntime(input);
  const loopState = await buildLoopState(input, slug);

  await runPageLoop(
    input,
    { limit, pacer, throttle, slug, startedAt },
    loopState,
  );

  return assembleResult(input, {
    discoveryReport: loopState.discoveryReport,
    etag: loopState.etag,
    lastCompletedPage: loopState.lastCompletedPage,
    pageTimestampsMs: loopState.pageTimestampsMs,
    pages: loopState.pages,
    rawStorage: loopState.rawStorage,
    reachedMaxPages: loopState.reachedMaxPages,
    slug,
    staging: loopState.staging,
    startedAt,
  });
};
