/**
 * Bounded one-shot source contract probe (GUARD-01, GUARD-02, GUARD-03).
 *
 * Probes page 1 of the source list, the first row's detail page, and the raw
 * JSON data endpoint. Returns a discriminated-union result. Negative live cases
 * (no rows, missing external id, missing filename) are warnings — they do not
 * make ok:false. Only a structural contract violation (HTML where JSON is
 * expected) or source unreachability yields ok:false.
 *
 * Per DIAG-04 / Security Domain: response bodies MUST NOT appear in messages
 * or details. The raw-bytes check reduces to a boolean JSON.parse outcome only.
 *
 * No retries — fetchText is called without options (attempts defaults to 0 = one
 * try per source-client.ts contract).
 */

import { classifyFailure } from "../source/classify-failure.js";
import { SourceFetchError } from "../discovery/source-client.js";
import {
  extractFilenameFromDetailHtml,
  extractReplayRows,
} from "../discovery/html.js";
import { toRawReplayUrl } from "../discovery/discover.js";

import type { SourceClient } from "../discovery/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ContractCheckReason = "contract_broken" | "source_unreachable";

export interface ContractCheckWarning {
  readonly code: string;
  readonly message: string;
}

export interface ContractCheckSample {
  readonly listPageUrl: string;
  readonly detailUrl?: string;
  readonly rawUrl?: string;
}

export type ContractCheckResult =
  | {
      readonly ok: true;
      readonly sample: ContractCheckSample;
      readonly warnings: readonly ContractCheckWarning[];
    }
  | {
      readonly ok: false;
      readonly reason: ContractCheckReason;
      readonly message: string;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly warnings: readonly ContractCheckWarning[];
    };

export interface RunContractCheckOptions {
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
  readonly generatedAt?: string;
}

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

type FetchFailureResult = Extract<ContractCheckResult, { ok: false }>;

/**
 * Maps a caught error from fetchText into an ok:false ContractCheckResult
 * (without warnings — callers append their own warning array).
 */
function makeFetchFailureResult(
  error: unknown,
  message: string,
  warnings: readonly ContractCheckWarning[],
): FetchFailureResult {
  if (error instanceof SourceFetchError) {
    if (
      error.code === "source_transient" ||
      error.code === "rate_limited"
    ) {
      return { ok: false, reason: "source_unreachable", message, warnings };
    }

    // source_unavailable: re-classify via classifyFailure to distinguish
    // permanent (contract_broken) from transient network failures (source_unreachable).
    const rawHttpStatus = error.details?.["httpStatus"];
    const httpStatus =
      typeof rawHttpStatus === "number" ? rawHttpStatus : undefined;

    const classifyInput =
      httpStatus !== undefined ? { httpStatus, error } : { error };

    const classification = classifyFailure(classifyInput);

    if (classification.kind === "permanent") {
      if (httpStatus !== undefined) {
        return {
          ok: false,
          reason: "contract_broken",
          message,
          details: { httpStatus },
          warnings,
        };
      }
      return { ok: false, reason: "contract_broken", message, warnings };
    }

    return { ok: false, reason: "source_unreachable", message, warnings };
  }

  // Non-SourceFetchError: unexpected structural problem → contract_broken.
  return { ok: false, reason: "contract_broken", message, warnings };
}

// ---------------------------------------------------------------------------
// Main probe
// ---------------------------------------------------------------------------

export async function runContractCheck(
  options: RunContractCheckOptions,
): Promise<ContractCheckResult> {
  const { sourceClient, sourceUrl } = options;
  const warnings: ContractCheckWarning[] = [];
  const listPageUrl = sourceUrl.toString();

  // Step 1: fetch page-1 list HTML (no options = single attempt).
  let listHtml: string;
  try {
    listHtml = await sourceClient.fetchText(sourceUrl);
  } catch (error) {
    return makeFetchFailureResult(error, "Failed to fetch source list page", warnings);
  }

  const rows = extractReplayRows(listHtml, 1, sourceUrl);

  if (rows.length === 0) {
    warnings.push({
      code: "empty_list_page",
      message: "Source list page 1 returned no replay rows",
    });
    return { ok: true, sample: { listPageUrl }, warnings };
  }

  // rows.length > 0 is asserted above by the empty-list early-return.
  const firstRowOrUndefined = rows[0];
  /* v8 ignore next 3 -- @preserve rows.length > 0 guard above makes this unreachable. */
  if (firstRowOrUndefined === undefined) {
    return { ok: true, sample: { listPageUrl }, warnings };
  }
  const firstRow = firstRowOrUndefined;

  if (firstRow.source.url === undefined || firstRow.source.externalId === undefined) {
    warnings.push({
      code: "missing_external_id",
      message: "First replay row is missing source URL or external id",
    });
    return { ok: true, sample: { listPageUrl }, warnings };
  }

  const detailUrlString = firstRow.source.url;
  const detailUrl = new URL(detailUrlString);

  // Step 2: fetch detail page HTML.
  let detailHtml: string;
  try {
    detailHtml = await sourceClient.fetchText(detailUrl);
  } catch (error) {
    return makeFetchFailureResult(error, "Failed to fetch source detail page", warnings);
  }

  const filename = extractFilenameFromDetailHtml(detailHtml);

  if (filename === undefined) {
    warnings.push({
      code: "missing_filename",
      message: "Detail page did not contain a recognisable filename (no #filename input or body[data-ocap])",
    });
    return { ok: true, sample: { listPageUrl, detailUrl: detailUrlString }, warnings };
  }

  // Step 3: derive and fetch the raw JSON data endpoint.
  const rawUrl = toRawReplayUrl(filename, detailUrl);

  let rawBody: string;
  try {
    rawBody = await sourceClient.fetchText(new URL(rawUrl));
  } catch (error) {
    return makeFetchFailureResult(error, "Failed to fetch raw data endpoint", warnings);
  }

  // Step 4: assert raw body is valid JSON (DIAG-04: boolean outcome only, never body text).
  try {
    JSON.parse(rawBody);
  } catch {
    return {
      ok: false,
      reason: "contract_broken",
      message:
        "Raw data endpoint returned non-JSON (HTML?) content",
      warnings,
    };
  }

  // Step 5: success.
  return {
    ok: true,
    sample: { listPageUrl, detailUrl: detailUrlString, rawUrl },
    warnings,
  };
}
