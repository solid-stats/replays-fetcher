/**
 * Bounded one-shot source contract probe (GUARD-01, GUARD-02).
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

import { toRawReplayUrl } from "../discovery/discover.js";
import {
  extractFilenameFromDetailHtml,
  extractReplayRows,
} from "../discovery/html.js";
import { SourceFetchError } from "../discovery/source-client.js";
import type { SourceClient } from "../discovery/types.js";
import { classifyFailure } from "../source/classify-failure.js";
import type { ClassifyInput } from "../source/classify-failure.js";

export type ContractCheckReason = "contract_broken" | "source_unreachable";

export type ContractCheckWarningCode =
  | "empty_list_page"
  | "missing_external_id"
  | "missing_filename";

export type ContractCheckWarning = {
  readonly code: ContractCheckWarningCode;
  readonly message: string;
};

export type ContractCheckSample = {
  readonly listPageUrl: string;
  readonly detailUrl?: string;
  readonly rawUrl?: string;
};

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

export type RunContractCheckOptions = {
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
};

type FetchFailureResult = Extract<ContractCheckResult, { ok: false }>;

type FetchOutcome =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly result: FetchFailureResult };

type ProbeContext = {
  readonly sourceClient: SourceClient;
  readonly listPageUrl: string;
  readonly warnings: ContractCheckWarning[];
};

type DetailTarget = {
  readonly detailUrl: URL;
  readonly detailUrlString: string;
  readonly filename: string;
};

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

const readHttpStatus = (
  details: Readonly<Record<string, unknown>> | undefined,
): number | undefined => {
  const raw = details?.["httpStatus"];

  if (typeof raw === "number") {
    return raw;
  }

  return undefined;
};

const buildClassifyInput = (
  error: SourceFetchError,
  httpStatus: number | undefined,
): ClassifyInput => {
  if (httpStatus === undefined) {
    return { error };
  }

  return { error, httpStatus };
};

/**
 * Maps a caught error from fetchText into an ok:false ContractCheckResult.
 * source_transient / rate_limited are always unreachable; source_unavailable is
 * re-classified through DIAG to split permanent (contract_broken) from transient
 * network failures (source_unreachable).
 */
const makeFetchFailureResult = (
  error: unknown,
  message: string,
  warnings: readonly ContractCheckWarning[],
): FetchFailureResult => {
  if (!(error instanceof SourceFetchError)) {
    return { message, ok: false, reason: "contract_broken", warnings };
  }

  if (error.code === "source_transient" || error.code === "rate_limited") {
    return { message, ok: false, reason: "source_unreachable", warnings };
  }

  const httpStatus = readHttpStatus(error.details);
  const classification = classifyFailure(buildClassifyInput(error, httpStatus));

  if (classification.kind !== "permanent") {
    return { message, ok: false, reason: "source_unreachable", warnings };
  }

  if (httpStatus === undefined) {
    return { message, ok: false, reason: "contract_broken", warnings };
  }

  return {
    details: { httpStatus },
    message,
    ok: false,
    reason: "contract_broken",
    warnings,
  };
};

const tryFetch = async (
  context: ProbeContext,
  url: URL,
  message: string,
): Promise<FetchOutcome> => {
  try {
    return { body: await context.sourceClient.fetchText(url), ok: true };
  } catch (error) {
    return {
      ok: false,
      result: makeFetchFailureResult(error, message, context.warnings),
    };
  }
};

const warn = (
  context: ProbeContext,
  warning: ContractCheckWarning,
  sample: ContractCheckSample,
): ContractCheckResult => {
  context.warnings.push(warning);
  return { ok: true, sample, warnings: context.warnings };
};

const isJson = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

const probeRawEndpoint = async (
  context: ProbeContext,
  target: DetailTarget,
): Promise<ContractCheckResult> => {
  const rawUrl = toRawReplayUrl(target.filename, target.detailUrl);

  const outcome = await tryFetch(
    context,
    new URL(rawUrl),
    "Failed to fetch raw data endpoint",
  );
  if (!outcome.ok) {
    return outcome.result;
  }

  // DIAG-04: boolean outcome only, never the body text in message/details.
  if (!isJson(outcome.body)) {
    return {
      message: "Raw data endpoint returned non-JSON (HTML?) content",
      ok: false,
      reason: "contract_broken",
      warnings: context.warnings,
    };
  }

  return {
    ok: true,
    sample: {
      detailUrl: target.detailUrlString,
      listPageUrl: context.listPageUrl,
      rawUrl,
    },
    warnings: context.warnings,
  };
};

// ---------------------------------------------------------------------------
// Main probe
// ---------------------------------------------------------------------------

export const runContractCheck = async (
  options: RunContractCheckOptions,
): Promise<ContractCheckResult> => {
  const { sourceClient, sourceUrl } = options;
  const context: ProbeContext = {
    listPageUrl: sourceUrl.toString(),
    sourceClient,
    warnings: [],
  };

  const listOutcome = await tryFetch(
    context,
    sourceUrl,
    "Failed to fetch source list page",
  );
  if (!listOutcome.ok) {
    return listOutcome.result;
  }

  const [firstRow] = extractReplayRows(listOutcome.body, 1, sourceUrl);
  const sampleOnly: ContractCheckSample = { listPageUrl: context.listPageUrl };

  if (firstRow === undefined) {
    return warn(
      context,
      {
        code: "empty_list_page",
        message: "Source list page 1 returned no replay rows",
      },
      sampleOnly,
    );
  }

  if (
    firstRow.source.url === undefined ||
    firstRow.source.externalId === undefined
  ) {
    return warn(
      context,
      {
        code: "missing_external_id",
        message: "First replay row is missing source URL or external id",
      },
      sampleOnly,
    );
  }

  const detailUrlString = firstRow.source.url;
  const detailUrl = new URL(detailUrlString);

  const detailOutcome = await tryFetch(
    context,
    detailUrl,
    "Failed to fetch source detail page",
  );
  if (!detailOutcome.ok) {
    return detailOutcome.result;
  }

  const filename = extractFilenameFromDetailHtml(detailOutcome.body);

  if (filename === undefined) {
    return warn(
      context,
      {
        code: "missing_filename",
        message:
          "Detail page did not contain a recognisable filename (no #filename input or body[data-ocap])",
      },
      { detailUrl: detailUrlString, listPageUrl: context.listPageUrl },
    );
  }

  return probeRawEndpoint(context, { detailUrl, detailUrlString, filename });
};
