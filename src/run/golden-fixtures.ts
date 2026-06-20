/**
 * Presence-guarded loader for the golden end-to-end fixtures.
 *
 * The fixture corpus (`manifest.json` + gzipped list/detail/byte files) is
 * produced by the HUMAN-run `scripts/capture-golden-fixtures.ts` and committed
 * under `src/run/fixtures/golden/`. The executor cannot capture it (no live
 * source access), so this loader MUST NOT throw when the corpus is absent —
 * `goldenFixturesPresent()` returns false and the golden integration tests skip
 * cleanly, keeping the suite green before capture.
 *
 * This module lives inside `src/` so it is typechecked; the gzipped data files
 * and this loader carry the `fixtures` marker that depcruise excludes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "fixtures", "golden");
const manifestPath = join(fixtureRoot, "manifest.json");

type GoldenManifest = {
  readonly bytes: Record<string, string>;
  readonly details: Record<string, string>;
  readonly expectedExternalIds: readonly string[];
  readonly listPages: Record<string, string>;
  readonly sourceUrl: string;
};

export type GoldenFixtures = {
  readonly bytesByUrl: Map<string, Uint8Array>;
  readonly expectedExternalIds: readonly string[];
  readonly htmlByUrl: Map<string, string>;
  readonly sourceUrl: URL;
};

/**
 * True iff the committed fixture corpus exists. The golden tests guard on this
 * and skip when it is false.
 */
export const goldenFixturesPresent = (): boolean => existsSync(manifestPath);

const gunzipText = (relativePath: string): string =>
  gunzipSync(readFileSync(join(fixtureRoot, relativePath))).toString("utf8");

const gunzipBytes = (relativePath: string): Uint8Array =>
  new Uint8Array(gunzipSync(readFileSync(join(fixtureRoot, relativePath))));

/**
 * Reads the manifest and gunzips every fixture into URL-keyed maps. The HTML map
 * carries BOTH list and detail pages (the discovery path reads both via
 * `sourceClient.fetchText`); the bytes map is keyed by the `/data/<encoded>.json`
 * raw URL. Keys are the exact pipeline-constructed URL strings so the fakes are
 * thin map lookups. Throws only when called WITH fixtures present but corrupt —
 * never as the absent-fixture path (callers guard with `goldenFixturesPresent`).
 */
export const loadGoldenFixtures = (): GoldenFixtures => {
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as GoldenManifest;

  const htmlByUrl = new Map<string, string>();
  for (const [url, path] of Object.entries(manifest.listPages)) {
    htmlByUrl.set(url, gunzipText(path));
  }
  for (const [url, path] of Object.entries(manifest.details)) {
    htmlByUrl.set(url, gunzipText(path));
  }

  const bytesByUrl = new Map<string, Uint8Array>();
  for (const [url, path] of Object.entries(manifest.bytes)) {
    bytesByUrl.set(url, gunzipBytes(path));
  }

  return {
    bytesByUrl,
    expectedExternalIds: manifest.expectedExternalIds,
    htmlByUrl,
    sourceUrl: new URL(manifest.sourceUrl),
  };
};
