import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { toRawReplayUrl } from "../discovery/discover.js";
import { extractReplayRows } from "../discovery/html.js";
import { SourceFetchError } from "../discovery/source-client.js";

import {
  runContractCheck,
} from "./contract-check.js";

import type { ContractCheckReason } from "./contract-check.js";

import type { SourceClient } from "../discovery/types.js";

// Deterministic fixtures — no live source (GUARD-01).
const SOURCE_URL = new URL("https://example.test/replays");
const LIST_PAGE_URL = "https://example.test/replays";
const DETAIL_URL = "https://example.test/replays/100";
const RAW_URL = "https://example.test/data/mission.ocap.json";

const LIST_HTML = `<table class="common-table"><tbody><tr><td><a href="/replays/100">sg@test</a></td><td>Altis</td><td>1</td></tr></tbody></table>`;
const LIST_HTML_NO_ID = `<table class="common-table"><tbody><tr><td>missing link</td><td>Altis</td><td>1</td></tr></tbody></table>`;
const LIST_HTML_EMPTY = `<table class="common-table"><tbody></tbody></table>`;
const LIST_HTML_TWO_ROWS = `<table class="common-table"><tbody><tr><td><a href="/replays/100">alpha</a></td><td>Altis</td><td>1</td></tr><tr><td><a href="/replays/101">bravo</a></td><td>Malden</td><td>2</td></tr></tbody></table>`;
const DETAIL_HTML = `<input id="filename" value="mission.ocap">`;
const DETAIL_HTML_NO_FILENAME = `<html><body>no recognisable filename here</body></html>`;
const RAW_JSON = JSON.stringify({ entities: [], version: "0.3.11" });

/** Source client backed by an inline URL → body map (analog: discover.test.ts). */
const stringClient = (
  responses: ReadonlyMap<string, string>,
): SourceClient => ({
  async fetchText(url: URL): Promise<string> {
    return responses.get(url.toString()) ?? "";
  },
});

/** Source client that throws at one URL and serves bodies otherwise. */
const throwingClient = (
  failingUrl: string,
  error: unknown,
  bodies: ReadonlyMap<string, string>,
): SourceClient => ({
  async fetchText(url: URL): Promise<string> {
    if (url.toString() === failingUrl) {
      throw error;
    }
    return bodies.get(url.toString()) ?? "";
  },
});

const happyResponses = new Map<string, string>([
  [LIST_PAGE_URL, LIST_HTML],
  [DETAIL_URL, DETAIL_HTML],
  [RAW_URL, RAW_JSON],
]);
describe("runContractCheck — GUARD-01 fixture coverage", () => {
  test("happy path returns ok:true, no warnings, full sample", async () => {
    const result = await runContractCheck({
      sourceClient: stringClient(happyResponses),
      sourceUrl: SOURCE_URL,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
      expect(result.sample).toEqual({
        detailUrl: DETAIL_URL,
        listPageUrl: LIST_PAGE_URL,
        rawUrl: RAW_URL,
      });
    }
  });

  test("empty list page is a warning, not a failure", async () => {
    const result = await runContractCheck({
      sourceClient: stringClient(new Map([[LIST_PAGE_URL, LIST_HTML_EMPTY]])),
      sourceUrl: SOURCE_URL,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sample).toEqual({ listPageUrl: LIST_PAGE_URL });
      expect(result.warnings.map((warning) => warning.code)).toContain(
        "empty_list_page",
      );
    }
  });

  test("first row missing external id is a warning, not a failure", async () => {
    const result = await runContractCheck({
      sourceClient: stringClient(new Map([[LIST_PAGE_URL, LIST_HTML_NO_ID]])),
      sourceUrl: SOURCE_URL,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.map((warning) => warning.code)).toContain(
        "missing_external_id",
      );
    }
  });

  test("detail page missing a filename is a warning, not a failure", async () => {
    const result = await runContractCheck({
      sourceClient: stringClient(
        new Map([
          [LIST_PAGE_URL, LIST_HTML],
          [DETAIL_URL, DETAIL_HTML_NO_FILENAME],
        ]),
      ),
      sourceUrl: SOURCE_URL,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sample).toEqual({
        detailUrl: DETAIL_URL,
        listPageUrl: LIST_PAGE_URL,
      });
      expect(result.warnings.map((warning) => warning.code)).toContain(
        "missing_filename",
      );
    }
  });

  test("multi-row substrate: parser surfaces both distinct rows (changed-metadata/duplicate)", () => {
    const rows = extractReplayRows(LIST_HTML_TWO_ROWS, 1, SOURCE_URL);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.source.externalId).toBe("100");
    expect(rows[1]?.source.externalId).toBe("101");
    expect(rows[0]?.metadata.world).toBe("Altis");
    expect(rows[1]?.metadata.world).toBe("Malden");
  });
});

describe("toRawReplayUrl / runContractCheck — GUARD-02 invariant", () => {
  test("golden: toRawReplayUrl points at the /data/<filename>.json JSON endpoint", () => {
    const rawUrl = toRawReplayUrl(
      "mission.ocap",
      new URL("https://example.test/replays/100"),
    );

    expect(rawUrl).toBe("https://example.test/data/mission.ocap.json");
    expect(rawUrl).toContain("/data/");
    expect(rawUrl).not.toContain("/replays/");
  });

  test("swap regression: HTML at the raw-bytes URL → ok:false contract_broken", async () => {
    const result = await runContractCheck({
      sourceClient: stringClient(
        new Map([
          [LIST_PAGE_URL, LIST_HTML],
          [DETAIL_URL, DETAIL_HTML],
          // Raw endpoint mistakenly serves the HTML detail page.
          [RAW_URL, DETAIL_HTML],
        ]),
      ),
      sourceUrl: SOURCE_URL,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("contract_broken");
      // DIAG-04: the raw body text must never leak into the message.
      expect(result.message).not.toContain("filename");
    }
  });
});

interface ListFetchFailureCase {
  readonly error: unknown;
  readonly expectedHttpStatus?: number;
  readonly name: string;
  readonly reason: ContractCheckReason;
}

const listFetchFailureCases: readonly ListFetchFailureCase[] = [
  {
    error: new SourceFetchError("source_transient", "boom"),
    name: "source_transient → source_unreachable",
    reason: "source_unreachable",
  },
  {
    error: new SourceFetchError("rate_limited", "slow down"),
    name: "rate_limited → source_unreachable",
    reason: "source_unreachable",
  },
  {
    error: new SourceFetchError("source_unavailable", "not found", {
      details: { httpStatus: 404 },
    }),
    expectedHttpStatus: 404,
    name: "source_unavailable 404 (permanent) → contract_broken + httpStatus",
    reason: "contract_broken",
  },
  {
    error: new SourceFetchError("source_unavailable", "unknown failure"),
    name: "source_unavailable no status (permanent) → contract_broken",
    reason: "contract_broken",
  },
  {
    error: new SourceFetchError("source_unavailable", "unavailable", {
      details: { httpStatus: 503 },
    }),
    name: "source_unavailable 503 (transient) → source_unreachable",
    reason: "source_unreachable",
  },
  {
    error: new Error("not a SourceFetchError"),
    name: "non-SourceFetchError → contract_broken",
    reason: "contract_broken",
  },
];

describe("runContractCheck — source failure classification (no retries)", () => {
  test.each(listFetchFailureCases)(
    "list fetch: $name",
    async ({ error, expectedHttpStatus, reason }) => {
      const result = await runContractCheck({
        sourceClient: throwingClient(LIST_PAGE_URL, error, happyResponses),
        sourceUrl: SOURCE_URL,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(reason);
        if (expectedHttpStatus === undefined) {
          expect(result.details).toBeUndefined();
        } else {
          expect(result.details).toEqual({ httpStatus: expectedHttpStatus });
        }
      }
    },
  );

  test.each([
    { failingUrl: DETAIL_URL, label: "detail" },
    { failingUrl: RAW_URL, label: "raw-endpoint" },
  ])(
    "$label fetch failure is classified and surfaced",
    async ({ failingUrl }) => {
      const result = await runContractCheck({
        sourceClient: throwingClient(
          failingUrl,
          new SourceFetchError("source_transient", "down"),
          happyResponses,
        ),
        sourceUrl: SOURCE_URL,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("source_unreachable");
      }
    },
  );
});

// GUARD-04 (source half): no S3, staging, or retry surface in the probe module.
const contractCheckSourceFiles = [
  "src/contract-check/contract-check.ts",
] as const;
const contractCheckMutationTokens = [
  ["S3", "Client"].join(""),
  ["Pool", "("].join(""),
  ["store", "RawReplay"].join(""),
  ["stage", "RawReplay"].join(""),
  ["S3RawReplay", "Storage"].join(""),
  ["PostgresStaging", "Repository"].join(""),
  ["createPostgresStaging", "RepositoryFromDatabaseUrl"].join(""),
  ["createS3RawReplay", "StorageFromConfig"].join(""),
  ["with", "Retry"].join(""),
] as const;

const readSourceFile = async (filePath: string): Promise<string> =>
  readFile(new URL(`../../${filePath}`, import.meta.url), "utf8");

describe("contract-check source — GUARD-04 no-mutation guard", () => {
  test("contract-check.ts contains no S3, staging, or retry tokens", async () => {
    const sources = await Promise.all(
      contractCheckSourceFiles.map((filePath) => readSourceFile(filePath)),
    );
    const sourceText = sources.join("\n");
    for (const token of contractCheckMutationTokens) {
      expect(sourceText).not.toContain(token);
    }
  });
});
