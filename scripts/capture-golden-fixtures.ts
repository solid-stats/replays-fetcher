/**
 * Human-run golden-fixture capture script (NOT run by the executor — it is denied
 * live source access via permission settings; only the human runs this against a
 * configured `.env`).
 *
 *   pnpm exec tsx scripts/capture-golden-fixtures.ts
 *
 * It builds the REAL source + byte clients from the repo's own config loader and
 * reuses the production URL/parse helpers so the captured HTML/bytes are
 * byte-identical to what the golden test fakes replay. It writes a three-tier
 * gzip fixture corpus under `src/run/fixtures/golden/`:
 *
 *   manifest.json                 — exact pipeline URL strings → relative paths
 *   list/page-<page>.html.gz      — 10 listing pages
 *   detail/<externalId>.html.gz   — each replay's detail page
 *   bytes/<externalId>.ocap.gz    — each replay's raw bytes (opaque OCAP JSON)
 *
 * `scripts/` is outside tsconfig/knip/depcruise scope, so this file does not
 * affect the verify gates. The committed fixtures are produced by the human; the
 * executor ships only this script, the loader, the layout, and the docs.
 *
 * AGENTS no-hammer rule: every source request is sequential and paced by
 * `sourceRequestSpacingMs`.
 */
import { gzipSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSourceConfig } from "../src/config.js";
import { toRawReplayUrl } from "../src/discovery/discover.js";
import {
  extractFilenameFromDetailHtml,
  extractReplayRows,
} from "../src/discovery/html.js";
import { createSourceClient } from "../src/discovery/source-client.js";
import { createReplayByteClient } from "../src/storage/replay-byte-client.js";

import type { SourceClient } from "../src/discovery/types.js";
import type { ReplayByteClient } from "../src/storage/replay-byte-client.js";

const TOTAL_PAGES = 10;
const FIRST_PAGE = 1;

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "..", "src", "run", "fixtures", "golden");

interface ManifestFile {
  listPages: Record<string, string>;
  details: Record<string, string>;
  bytes: Record<string, string>;
  sourceUrl: string;
  expectedExternalIds: string[];
}

/**
 * Page-1 URL is `sourceUrl` verbatim; page N sets `?p=N`. Re-derived locally
 * because `toPageUrl` is private to discover.ts/run-once.ts (not exported) — the
 * derivation is copied so capture keys match the replay-time URL strings exactly.
 */
const toPageUrl = (sourceUrl: URL, page: number): URL => {
  if (page === FIRST_PAGE) {
    return sourceUrl;
  }

  const pageUrl = new URL(sourceUrl);
  pageUrl.searchParams.set("p", String(page));

  return pageUrl;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const writeGzip = async (
  relativePath: string,
  body: Uint8Array,
): Promise<void> => {
  const absolute = join(fixtureRoot, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, gzipSync(body));
};

interface RowCaptureInput {
  readonly byteClient: ReplayByteClient;
  readonly detailUrl: string;
  readonly externalId: string;
  readonly manifest: ManifestFile;
  readonly sourceClient: SourceClient;
  readonly spacingMs: number;
}

/**
 * Captures the detail page (and, when the filename resolves, the raw bytes) for a
 * single list row, mirroring the pipeline's detail→bytes tiers exactly. A row
 * whose detail page has no filename is a real `missing_filename` diagnostic in
 * discovery — its detail fixture is kept (so the golden test reproduces the
 * diagnostic) but no byte fixture is written.
 */
const captureRow = async (input: RowCaptureInput): Promise<void> => {
  const {
    byteClient,
    detailUrl,
    externalId,
    manifest,
    sourceClient,
    spacingMs,
  } = input;

  await sleep(spacingMs);
  const detailHtml = await sourceClient.fetchText(new URL(detailUrl));
  const detailPath = `detail/${externalId}.html.gz`;
  await writeGzip(detailPath, Buffer.from(detailHtml, "utf8"));
  manifest.details[detailUrl] = detailPath;
  manifest.expectedExternalIds.push(externalId);

  const filename = extractFilenameFromDetailHtml(detailHtml);
  if (filename === undefined) {
    return;
  }

  const rawUrl = toRawReplayUrl(filename, new URL(detailUrl));
  await sleep(spacingMs);
  const bytes = await byteClient.fetchBytes(new URL(rawUrl));
  const bytesPath = `bytes/${externalId}.ocap.gz`;
  await writeGzip(bytesPath, bytes);
  manifest.bytes[rawUrl] = bytesPath;
};

const capture = async (): Promise<void> => {
  const config = loadSourceConfig();
  const sourceUrl = new URL(config.sourceUrl);
  const sourceClient = createSourceClient(config);
  const byteClient = createReplayByteClient(config);
  const spacingMs = config.sourceRequestSpacingMs;

  const manifest: ManifestFile = {
    bytes: {},
    details: {},
    expectedExternalIds: [],
    listPages: {},
    sourceUrl: sourceUrl.toString(),
  };

  for (let page = FIRST_PAGE; page <= TOTAL_PAGES; page += 1) {
    const pageUrl = toPageUrl(sourceUrl, page);
    await sleep(spacingMs);
    const listHtml = await sourceClient.fetchText(pageUrl);
    const listPath = `list/page-${String(page)}.html.gz`;
    await writeGzip(listPath, Buffer.from(listHtml, "utf8"));
    manifest.listPages[pageUrl.toString()] = listPath;

    const rows = extractReplayRows(listHtml, page, pageUrl).filter(
      (
        row,
      ): row is typeof row & { source: { externalId: string; url: string } } =>
        row.source.url !== undefined && row.source.externalId !== undefined,
    );
    for (const row of rows) {
      await captureRow({
        byteClient,
        detailUrl: row.source.url,
        externalId: row.source.externalId,
        manifest,
        sourceClient,
        spacingMs,
      });
    }
  }

  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(
    join(fixtureRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  process.stdout.write(
    `Captured ${String(Object.keys(manifest.listPages).length)} list pages, ` +
      `${String(Object.keys(manifest.details).length)} detail pages, ` +
      `${String(Object.keys(manifest.bytes).length)} byte blobs to ${fixtureRoot}\n`,
  );
};

await capture();
