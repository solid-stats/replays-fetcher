import { parseSourceFixture } from "./discover-candidate.js";
import { discoverPageCandidates } from "./discover-dedup.js";
import {
  buildReadOptions,
  buildReport,
  buildSourceFailureDiagnostic,
} from "./discover-diagnostics.js";
import type { DiscoverReplaysDryRunOptions } from "./discover-types.js";
import { SourceFetchError } from "./source-client.js";
import type {
  DiscoveryDiagnostic,
  DiscoveryReport,
  ReplayCandidate,
  SourceClient,
} from "./types.js";

export { toRawReplayUrl } from "./discover-candidate.js";

// The blanket per-request delay is retired as the NORMAL pacing source: the
// run-once `createPacer` floor (RANGE-04) is now the single pacing knob. A
// `requestDelayMs` is opt-in only; defaulted to zero so discovery applies no
// blanket delay unless a caller explicitly requests one.
const defaultRequestDelayMs = 0;

/* v8 ignore next 5 -- tested through injected sleep to avoid real timer delay. */
const defaultSleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const toPageUrl = (sourceUrl: URL, page: number): URL => {
  if (page === 1) {
    return sourceUrl;
  }

  const pageUrl = new URL(sourceUrl);
  pageUrl.searchParams.set("p", String(page));

  return pageUrl;
};

const createPacedSourceClient = (
  options: DiscoverReplaysDryRunOptions,
): SourceClient => {
  const requestDelayMs = options.requestDelayMs ?? defaultRequestDelayMs;
  const sleep = options.sleep ?? defaultSleep;
  let requestCount = 0;

  return {
    async fetchText(url: URL, readOptions?): Promise<string> {
      // Pacing is the OUTER inter-request delay; backoff lives inside the
      // adapter's withRetry. requestCount increments once per fetchText call,
      // NOT once per retry round (Pitfall 5: no double-count).
      if (requestCount > 0 && requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }

      requestCount += 1;

      return options.sourceClient.fetchText(url, readOptions);
    },
  };
};

export const discoverReplaysDryRun = async (
  options: DiscoverReplaysDryRunOptions,
): Promise<DiscoveryReport> => {
  const maxPages = options.maxPages ?? 1;
  const candidates: ReplayCandidate[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];
  // Running total of rows skipped before their detail fetch by the watch
  // pre-detail gate, accumulated across pages and carried into the report.
  let skippedPreDetail = 0;
  const sourceClient = createPacedSourceClient(options);
  // Tracks the page being read when a source failure throws, so the terminal
  // diagnostic can re-attach `page` even if the thrown error's details somehow
  // omit it (defense-in-depth for DIAG-01; the adapters are the primary source).
  let failedPage = 1;

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      failedPage = page;
      const pageUrl = toPageUrl(options.sourceUrl, page);
      const listReadOptions = buildReadOptions(options, page, "list");
      // Source requests are intentionally sequential to preserve source order.
      const sourceText = await sourceClient.fetchText(pageUrl, listReadOptions);
      const fixture = parseSourceFixture(sourceText, options.log);
      // Page detail fetches are part of the same source-order sequence. The
      // pre-detail predicate + sourceSystem are threaded only when supplied (the
      // watch path); run-once / discover omit both, leaving the gate inert.
      const pageCandidates = await discoverPageCandidates({
        detailReadOptions: buildReadOptions(options, page, "detail"),
        fixture,
        page,
        pageUrl,
        sourceClient,
        sourceText,
        ...(options.existsBySourceIdentity === undefined
          ? {}
          : { existsBySourceIdentity: options.existsBySourceIdentity }),
        ...(options.sourceSystem === undefined
          ? {}
          : { sourceSystem: options.sourceSystem }),
      });
      candidates.push(...pageCandidates.candidates);
      diagnostics.push(...pageCandidates.diagnostics);
      skippedPreDetail += pageCandidates.skippedPreDetail;
    }
  } catch (error) {
    if (!(error instanceof SourceFetchError)) {
      throw error;
    }

    diagnostics.push(
      buildSourceFailureDiagnostic(error, options.sourceUrl, failedPage),
    );

    return buildReport({
      candidates,
      diagnostics,
      ok: false,
      options,
      skippedPreDetail,
    });
  }

  return buildReport({
    candidates,
    diagnostics,
    ok: true,
    options,
    skippedPreDetail,
  });
};
