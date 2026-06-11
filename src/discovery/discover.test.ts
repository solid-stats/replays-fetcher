/* eslint-disable max-lines -- Phase 2 dry-run discovery scenarios are kept together for report-contract readability. */
import { expect, test } from "vitest";

import { discoverReplaysDryRun } from "./discover.js";
import { SourceFetchError } from "./source-client.js";

import type { SourceClient, SourceFetchOptions } from "./types.js";
import type { RetryAttemptEvent } from "../source/retry.js";

test("discoverReplaysDryRun should map a source fixture into a dry-run report", async () => {
  const sourceClient: SourceClient = {
    async fetchText() {
      return JSON.stringify({
        candidates: [
          {
            externalId: "100",
            discoveredAt: "2026-05-08T00:00:00.000Z",
            filename: "replay-a.json",
            missionText: "sg@test",
            page: 2,
            rawUrl: "https://example.test/data/replay-a.json",
            serverId: 1,
            url: "https://example.test/replays/100",
            world: "Altis",
          },
          {
            filename: "replay-b.json",
            url: "https://example.test/replays/101",
          },
        ],
      });
    },
  };

  const report = await discoverReplaysDryRun({
    generatedAt: "2026-05-09T00:00:00.000Z",
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report).toMatchObject({
    counts: {
      candidates: 2,
      diagnostics: 0,
      discovered: 2,
    },
    mode: "dry-run",
    ok: true,
  });
  expect(report.candidates).toHaveLength(2);
  expect(report.candidates[0]).toMatchObject({
    identity: {
      filename: "replay-a.json",
    },
    source: {
      externalId: "100",
      page: 2,
      rawUrl: "https://example.test/data/replay-a.json",
      url: "https://example.test/replays/100",
    },
  });
  expect(report.diagnostics).toHaveLength(0);
});

test("discoverReplaysDryRun should rethrow unexpected source errors", async () => {
  const sourceClient: SourceClient = {
    async fetchText() {
      throw new TypeError("unexpected source crash");
    },
  };

  await expect(
    discoverReplaysDryRun({
      sourceClient,
      sourceUrl: new URL("https://example.test/replays"),
    }),
  ).rejects.toThrow("unexpected source crash");
});

test("discoverReplaysDryRun should read source through the injected SourceClient", async () => {
  const requestedUrls: string[] = [];
  const sourceClient: SourceClient = {
    async fetchText(url) {
      requestedUrls.push(url.toString());

      return JSON.stringify({
        candidates: [
          {
            filename: "source-client-only.json",
            url: "https://example.test/replays/200",
          },
        ],
      });
    },
  };

  const report = await discoverReplaysDryRun({
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(requestedUrls).toStrictEqual(["https://example.test/replays"]);
  expect(report.candidates[0]?.identity.filename).toBe(
    "source-client-only.json",
  );
});

test("discoverReplaysDryRun should parse HTML list and detail pages with stable identity", async () => {
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr>
              <td><a href="/replays/100">sg@test</a></td>
              <td>Altis</td>
              <td>1</td>
            </tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays/100",
      `<html><body data-ocap="fallback.json"><input id="filename" value="replay-a.json"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) {
      return responses.get(url.toString()) ?? "";
    },
  };
  const options = {
    generatedAt: "2026-05-09T00:00:00.000Z",
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  };

  const reportA = await discoverReplaysDryRun(options);
  const reportB = await discoverReplaysDryRun(options);

  expect(reportA.candidates[0]).toMatchObject({
    identity: {
      filename: "replay-a.json",
    },
    metadata: {
      missionText: "sg@test",
      serverId: 1,
      world: "Altis",
    },
    source: {
      externalId: "100",
      page: 1,
      rawUrl: "https://example.test/data/replay-a.json",
      url: "https://example.test/replays/100",
    },
  });
  expect(JSON.stringify(reportA)).toBe(JSON.stringify(reportB));
});

test("discoverReplaysDryRun should report source-level fetch failures", async () => {
  const sourceClient: SourceClient = {
    async fetchText() {
      throw new SourceFetchError("rate_limited", "Source returned 429");
    },
  };

  const report = await discoverReplaysDryRun({
    generatedAt: "2026-05-09T00:00:00.000Z",
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report).toMatchObject({
    counts: {
      candidates: 0,
      diagnostics: 1,
      discovered: 0,
    },
    diagnostics: [
      {
        code: "rate_limited",
        message: "Source returned 429",
        severity: "error",
        sourceUrl: "https://example.test/replays",
      },
    ],
    ok: false,
  });
});

test("discoverReplaysDryRun should support maxPages and skip incomplete HTML candidates", async () => {
  const requestedUrls: string[] = [];
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr><td>missing link</td><td>Altis</td><td>1</td></tr>
            <tr><td><a href="/replays/101">missing filename</a></td><td>Malden</td><td>x</td></tr>
          </tbody>
        </table>
      `,
    ],
    ["https://example.test/replays/101", `<html><body></body></html>`],
    [
      "https://example.test/replays?p=2",
      `
        <table class="common-table">
          <tbody>
            <tr><td><a href="/replays/102">sg@test</a></td><td>Altis</td><td>2</td></tr>
            <tr><td><a href="/downloads/custom">no id</a></td><td>Malden</td><td>3</td></tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays/102",
      `<html><body data-ocap="page-two.json"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) {
      requestedUrls.push(url.toString());

      return responses.get(url.toString()) ?? "";
    },
  };

  const report = await discoverReplaysDryRun({
    generatedAt: "2026-05-09T00:00:00.000Z",
    maxPages: 2,
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.maxPages).toBe(2);
  expect(report.candidates).toHaveLength(1);
  expect(report.candidates[0]?.identity.filename).toBe("page-two.json");
  expect(report.candidates[0]?.source.rawUrl).toBe(
    "https://example.test/data/page-two.json",
  );
  expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "malformed_row",
  );
  expect(requestedUrls).toStrictEqual([
    "https://example.test/replays",
    "https://example.test/replays/101",
    "https://example.test/replays?p=2",
    "https://example.test/replays/102",
  ]);
});

test("discoverReplaysDryRun should report malformed rows and missing filenames as warnings", async () => {
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr><td>missing link</td><td>Altis</td><td>1</td></tr>
            <tr><td><a href="/replays/101">missing filename</a></td><td>Malden</td><td>2</td></tr>
            <tr><td><a href="/replays/102">sg@test</a></td><td>Altis</td><td>3</td></tr>
          </tbody>
        </table>
      `,
    ],
    ["https://example.test/replays/101", `<html><body></body></html>`],
    [
      "https://example.test/replays/102",
      `<html><body data-ocap="valid.json"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) {
      return responses.get(url.toString()) ?? "";
    },
  };

  const report = await discoverReplaysDryRun({
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.ok).toBe(true);
  expect(report.candidates).toHaveLength(1);
  expect(report.diagnostics).toStrictEqual([
    {
      code: "malformed_row",
      message: "Source row did not include a replay link",
      page: 1,
      severity: "warning",
      sourceUrl: "https://example.test/replays",
    },
    {
      code: "missing_filename",
      externalId: "101",
      message: "Replay detail page did not include a filename",
      page: 1,
      severity: "warning",
      sourceUrl: "https://example.test/replays/101",
    },
  ]);
});

test("discoverReplaysDryRun should report malformed fixture candidates as warnings", async () => {
  const sourceClient: SourceClient = {
    async fetchText() {
      return JSON.stringify({
        candidates: [
          {},
          {
            filename: "invalid-url.json",
            url: "not a url",
          },
          {
            filename: "valid.json",
            url: "https://example.test/replays/valid",
          },
        ],
      });
    },
  };

  const report = await discoverReplaysDryRun({
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.ok).toBe(true);
  expect(report.candidates).toHaveLength(1);
  expect(report.diagnostics).toStrictEqual([
    {
      candidateIndex: 0,
      code: "malformed_row",
      message: "Source fixture candidate did not include filename and URL",
      severity: "warning",
      sourceUrl: "https://example.test/replays",
    },
    {
      candidateIndex: 1,
      code: "malformed_row",
      message: "Source fixture candidate did not include filename and URL",
      severity: "warning",
      sourceUrl: "https://example.test/replays",
    },
  ]);
});

test("discoverReplaysDryRun should drop non-typed fixture page and serverId fields", async () => {
  // Untrusted source JSON: `page`/`serverId` arrive with the wrong runtime
  // type (string instead of number). The candidate must not leak them
  // (WR-08-04) even though the fixture type statically declares numbers.
  const malformedElement: Record<string, unknown> = {
    filename: "wrong-types.json",
    page: "oops",
    serverId: "nope",
    url: "https://example.test/replays/200",
  };
  const sourceClient: SourceClient = {
    async fetchText() {
      return JSON.stringify({ candidates: [malformedElement] });
    },
  };

  const report = await discoverReplaysDryRun({
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.ok).toBe(true);
  expect(report.candidates).toHaveLength(1);
  const [candidate] = report.candidates;
  expect(candidate?.identity.filename).toBe("wrong-types.json");
  expect(candidate?.source.page).toBeUndefined();
  expect(candidate?.metadata).toBeUndefined();
});

test("discoverReplaysDryRun should report duplicate filenames and changed metadata", async () => {
  const sourceClient: SourceClient = {
    async fetchText() {
      return JSON.stringify({
        candidates: [
          {
            externalId: "100",
            filename: "duplicate.json",
            missionText: "original",
            url: "https://example.test/replays/100",
          },
          {
            externalId: "101",
            filename: "duplicate.json",
            missionText: "other source row",
            url: "https://example.test/replays/101",
          },
          {
            externalId: "100",
            filename: "duplicate.json",
            missionText: "changed",
            url: "https://example.test/replays/100",
          },
          {
            externalId: "100",
            filename: "duplicate.json",
            missionText: "changed",
            url: "https://example.test/replays/100",
          },
        ],
      });
    },
  };

  const report = await discoverReplaysDryRun({
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.ok).toBe(true);
  expect(report.candidates).toHaveLength(["first", "second", "third"].length);
  expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toStrictEqual(
    [
      "duplicate_filename",
      "duplicate_filename",
      "changed_metadata",
      "duplicate_filename",
      "changed_metadata",
    ],
  );
  expect(report.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "duplicate_filename",
      severity: "warning",
      sourceUrl: "https://example.test/replays/101",
    }),
  );
  expect(report.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "changed_metadata",
      externalId: "100",
      severity: "warning",
      sourceUrl: "https://example.test/replays/100",
    }),
  );
});

test("discoverReplaysDryRun should report duplicate filenames without optional evidence", async () => {
  const sourceClient: SourceClient = {
    async fetchText() {
      return JSON.stringify({
        candidates: [
          {
            filename: "duplicate.json",
            url: "https://example.test/replays/a",
          },
          {
            filename: "duplicate.json",
            url: "https://example.test/replays/b",
          },
        ],
      });
    },
  };

  const report = await discoverReplaysDryRun({
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.ok).toBe(true);
  expect(report.candidates).toHaveLength(2);
  expect(report.diagnostics).toStrictEqual([
    {
      candidateIndex: 1,
      code: "duplicate_filename",
      message: "Filename appeared more than once in source discovery",
      severity: "warning",
      sourceUrl: "https://example.test/replays/b",
    },
  ]);
});

test("discoverReplaysDryRun should omit metadata for sparse HTML rows", async () => {
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr><td><a href="/replays/custom"></a></td></tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays/custom",
      `<html><body data-ocap="custom.json"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) {
      return responses.get(url.toString()) ?? "";
    },
  };

  const report = await discoverReplaysDryRun({
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.candidates).toStrictEqual([
    {
      identity: {
        filename: "custom.json",
      },
      source: {
        externalId: "custom",
        page: 1,
        rawUrl: "https://example.test/data/custom.json",
        url: "https://example.test/replays/custom",
      },
    },
  ]);
});

test("discoverReplaysDryRun should allow replay detail URLs without external IDs", async () => {
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr><td><a href="/replays/">no id</a></td></tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays/",
      `<html><body data-ocap="no-id.json"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) {
      return responses.get(url.toString()) ?? "";
    },
  };

  const report = await discoverReplaysDryRun({
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.candidates).toStrictEqual([
    {
      identity: {
        filename: "no-id.json",
      },
      metadata: {
        missionText: "no id",
      },
      source: {
        page: 1,
        rawUrl: "https://example.test/data/no-id.json",
        url: "https://example.test/replays/",
      },
    },
  ]);
});

test("discoverReplaysDryRun should preserve external IDs for sparse HTML rows", async () => {
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr><td><a href="/replays/100"></a></td></tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays/100",
      `<html><body data-ocap="custom.json"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) {
      return responses.get(url.toString()) ?? "";
    },
  };

  const report = await discoverReplaysDryRun({
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.candidates[0]?.source).toStrictEqual({
    externalId: "100",
    page: 1,
    rawUrl: "https://example.test/data/custom.json",
    url: "https://example.test/replays/100",
  });
});

test("discoverReplaysDryRun should derive raw JSON URLs for filenames without extensions", async () => {
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr><td><a href="/replays/100">extensionless</a></td></tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays/100",
      `<html><body data-ocap="extensionless"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) {
      return responses.get(url.toString()) ?? "";
    },
  };

  const report = await discoverReplaysDryRun({
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.candidates[0]?.source.rawUrl).toBe(
    "https://example.test/data/extensionless.json",
  );
});

test("discoverReplaysDryRun should not apply a blanket delay by default (run-once owns pacing)", async () => {
  const sleeps: number[] = [];
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr><td><a href="/replays/100">first</a></td><td>Altis</td><td>1</td></tr>
            <tr><td><a href="/replays/101">second</a></td><td>Altis</td><td>1</td></tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays/100",
      `<html><body data-ocap="first.json"></body></html>`,
    ],
    [
      "https://example.test/replays/101",
      `<html><body data-ocap="second.json"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) {
      return responses.get(url.toString()) ?? "";
    },
  };

  const report = await discoverReplaysDryRun({
    sleep(milliseconds: number) {
      sleeps.push(milliseconds);

      return Promise.resolve();
    },
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  // The blanket 2000ms cadence is retired: run-once's createPacer floor is now
  // the single pacing source, so discovery applies no inter-request delay unless
  // a caller explicitly opts in via requestDelayMs.
  expect(
    report.candidates.map((candidate) => candidate.identity.filename),
  ).toStrictEqual(["first.json", "second.json"]);
  expect(sleeps).toStrictEqual([]);
});

test("discoverReplaysDryRun should apply an opt-in requestDelayMs between requests when set", async () => {
  const sleeps: number[] = [];
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr><td><a href="/replays/100">first</a></td><td>Altis</td><td>1</td></tr>
            <tr><td><a href="/replays/101">second</a></td><td>Altis</td><td>1</td></tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays/100",
      `<html><body data-ocap="first.json"></body></html>`,
    ],
    [
      "https://example.test/replays/101",
      `<html><body data-ocap="second.json"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) {
      return responses.get(url.toString()) ?? "";
    },
  };

  const report = await discoverReplaysDryRun({
    requestDelayMs: Number("500"),
    sleep(milliseconds: number) {
      sleeps.push(milliseconds);

      return Promise.resolve();
    },
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  // Opt-in pacing still works (the injectable sleep seam is preserved): three
  // requests (1 list + 2 detail) → two inter-request gaps at the requested delay.
  expect(
    report.candidates.map((candidate) => candidate.identity.filename),
  ).toStrictEqual(["first.json", "second.json"]);
  expect(sleeps).toStrictEqual([Number("500"), Number("500")]);
});

test("discoverReplaysDryRun should return an empty report for non-fixture non-table text", async () => {
  const sourceClient: SourceClient = {
    async fetchText() {
      return JSON.stringify({ notCandidates: [] });
    },
  };

  const report = await discoverReplaysDryRun({
    generatedAt: "2026-05-09T00:00:00.000Z",
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.generatedAt).toBe("2026-05-09T00:00:00.000Z");
  expect(report.candidates).toHaveLength(0);
});

const noopOnRetry = (): void => {
  /* no-op collector for the threading assertion */
};

test("discoverReplaysDryRun should thread attempts/page/phase/onRetry into list reads", async () => {
  const seenOptions: (SourceFetchOptions | undefined)[] = [];
  const sourceClient: SourceClient = {
    async fetchText(_url, options) {
      seenOptions.push(options);

      return JSON.stringify({
        candidates: [
          {
            filename: "threaded.json",
            url: "https://example.test/replays/300",
          },
        ],
      });
    },
  };

  await discoverReplaysDryRun({
    attempts: 4,
    onRetry: noopOnRetry,
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(seenOptions[0]).toStrictEqual({
    attempts: 4,
    onRetry: noopOnRetry,
    page: 1,
    phase: "list",
  });
});

test("discoverReplaysDryRun should thread phase=detail into HTML detail reads", async () => {
  const detailOptions: (SourceFetchOptions | undefined)[] = [];
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr><td><a href="/replays/400">row</a></td><td>Altis</td><td>1</td></tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays/400",
      `<html><body data-ocap="detail.json"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url, options) {
      if (url.toString() === "https://example.test/replays/400") {
        detailOptions.push(options);
      }

      return responses.get(url.toString()) ?? "";
    },
  };

  await discoverReplaysDryRun({
    attempts: 2,
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(detailOptions[0]).toStrictEqual({
    attempts: 2,
    page: 1,
    phase: "detail",
  });
});

test("discoverReplaysDryRun should forward onRetry events emitted by the source client", async () => {
  const retries: RetryAttemptEvent[] = [];
  const sourceClient: SourceClient = {
    async fetchText(_url, options) {
      options?.onRetry?.({
        attempt: 1,
        causeCode: "ECONNRESET",
        delayMs: 10,
        page: options.page ?? 1,
        phase: "list",
      });

      return JSON.stringify({ candidates: [] });
    },
  };

  const report = await discoverReplaysDryRun({
    attempts: 3,
    onRetry: (event) => retries.push(event),
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.ok).toBe(true);
  expect(retries).toStrictEqual([
    {
      attempt: 1,
      causeCode: "ECONNRESET",
      delayMs: 10,
      page: 1,
      phase: "list",
    },
  ]);
});

test("discoverReplaysDryRun should enrich source-failure diagnostics with the adapter-produced page", async () => {
  // The adapter writes `page` into details from the in-scope read options
  // (production path). This test mirrors that real shape — it does NOT
  // hand-fabricate a page the production adapters never emit.
  const sourceClient: SourceClient = {
    async fetchText(_url, options) {
      throw new SourceFetchError("source_transient", "Source request failed", {
        details: {
          attempts: 4,
          causeCode: "ECONNRESET",
          causeMessage: "socket hang up",
          cfChallenge: true,
          httpStatus: 503,
          page: options?.page,
          phase: "list",
          url: "https://example.test/replays/500",
        },
      });
    },
  };

  const report = await discoverReplaysDryRun({
    attempts: 3,
    generatedAt: "2026-05-09T00:00:00.000Z",
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.ok).toBe(false);
  expect(report.diagnostics[0]).toStrictEqual({
    attempts: 4,
    causeCode: "ECONNRESET",
    causeMessage: "socket hang up",
    cfChallenge: true,
    code: "source_transient",
    httpStatus: 503,
    message: "Source request failed",
    page: 1,
    phase: "list",
    severity: "error",
    sourceUrl: "https://example.test/replays/500",
  });
});

test("discoverReplaysDryRun should carry the page of the failing later page into the diagnostic", async () => {
  // Multi-page run that fails on page 2: the diagnostic must surface page 2,
  // proving discover re-attaches the in-scope failing page (defense-in-depth)
  // even when the thrown error's details omit page entirely.
  const failingPage = 2;
  const firstPageList = JSON.stringify({ candidates: [] });
  const sourceClient: SourceClient = {
    async fetchText(url) {
      if (url.searchParams.get("p") === String(failingPage)) {
        // No `page` in details — exercises the discover failedPage fallback.
        throw new SourceFetchError(
          "source_unavailable",
          "Source request failed",
        );
      }

      return firstPageList;
    },
  };

  const report = await discoverReplaysDryRun({
    generatedAt: "2026-05-09T00:00:00.000Z",
    maxPages: failingPage,
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.ok).toBe(false);
  expect(report.diagnostics[0]).toStrictEqual({
    code: "source_unavailable",
    message: "Source request failed",
    page: failingPage,
    severity: "error",
    sourceUrl: "https://example.test/replays",
  });
});

test("discoverReplaysDryRun should omit undefined source-failure evidence fields but keep the failing page", async () => {
  const sourceClient: SourceClient = {
    async fetchText() {
      throw new SourceFetchError("source_unavailable", "Source request failed");
    },
  };

  const report = await discoverReplaysDryRun({
    generatedAt: "2026-05-09T00:00:00.000Z",
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  // Even a permanent failure with empty details surfaces the failing page
  // (DIAG-01): discover re-attaches the in-scope page (default first page).
  expect(report.diagnostics[0]).toStrictEqual({
    code: "source_unavailable",
    message: "Source request failed",
    page: 1,
    severity: "error",
    sourceUrl: "https://example.test/replays",
  });
});

test("discoverReplaysDryRun should ignore malformed source-failure evidence types", async () => {
  const sourceClient: SourceClient = {
    async fetchText() {
      throw new SourceFetchError("source_transient", "Source request failed", {
        details: {
          attempts: "not-a-number",
          causeCode: 42,
          causeMessage: false,
          cfChallenge: "yes",
          httpStatus: undefined,
          page: {},
          phase: "unknown-phase",
          url: 99,
        },
      });
    },
  };

  const report = await discoverReplaysDryRun({
    generatedAt: "2026-05-09T00:00:00.000Z",
    requestDelayMs: 0,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  // Malformed details types are ignored, but the in-scope failing page still
  // surfaces from the discover fallback (the malformed `page: {}` is dropped).
  expect(report.diagnostics[0]).toStrictEqual({
    code: "source_transient",
    message: "Source request failed",
    page: 1,
    severity: "error",
    sourceUrl: "https://example.test/replays",
  });
});

test("discoverReplaysDryRun should keep one outer pacing delay per request after retry threading", async () => {
  const sleeps: number[] = [];
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr><td><a href="/replays/100">first</a></td><td>Altis</td><td>1</td></tr>
            <tr><td><a href="/replays/101">second</a></td><td>Altis</td><td>1</td></tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays/100",
      `<html><body data-ocap="first.json"></body></html>`,
    ],
    [
      "https://example.test/replays/101",
      `<html><body data-ocap="second.json"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) {
      return responses.get(url.toString()) ?? "";
    },
  };

  const report = await discoverReplaysDryRun({
    attempts: 5,
    onRetry: () => {
      /* retry threading must not perturb pacing */
    },
    requestDelayMs: Number("2000"),
    sleep: (milliseconds) => {
      sleeps.push(milliseconds);

      return Promise.resolve();
    },
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(
    report.candidates.map((candidate) => candidate.identity.filename),
  ).toStrictEqual(["first.json", "second.json"]);
  // With the opt-in requestDelayMs set, three requests (1 list + 2 detail) →
  // two inter-request pacing gaps. requestCount increments once per request,
  // NOT per retry round (Pitfall 5: no double-count).
  expect(sleeps).toStrictEqual(["2000", "2000"].map(Number));
});
