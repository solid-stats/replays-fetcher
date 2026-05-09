/* eslint-disable max-lines -- Phase 2 dry-run discovery scenarios are kept together for report-contract readability. */
import { expect, test } from "vitest";

import { discoverReplaysDryRun } from "../src/discovery/discover.js";
import { SourceFetchError } from "../src/discovery/source-client.js";

import type { SourceClient } from "../src/discovery/types.js";

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
    [
      "https://example.test/downloads/custom",
      `<html><body data-ocap="custom.json"></body></html>`,
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
  expect(report.candidates).toHaveLength(2);
  expect(report.candidates[0]?.identity.filename).toBe("page-two.json");
  expect(report.candidates[1]).toMatchObject({
    identity: {
      filename: "custom.json",
    },
    source: {
      page: 2,
      url: "https://example.test/downloads/custom",
    },
  });
  expect(requestedUrls).toStrictEqual([
    "https://example.test/replays",
    "https://example.test/replays/101",
    "https://example.test/replays?p=2",
    "https://example.test/replays/102",
    "https://example.test/downloads/custom",
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
            <tr><td><a href="/downloads/custom"></a></td></tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/downloads/custom",
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
        page: 1,
        url: "https://example.test/downloads/custom",
      },
    },
  ]);
});

test("discoverReplaysDryRun should apply default pacing between source requests", async () => {
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

  expect(
    report.candidates.map((candidate) => candidate.identity.filename),
  ).toStrictEqual(["first.json", "second.json"]);
  expect(sleeps).toStrictEqual(["2000", "2000"].map(Number));
});

test("discoverReplaysDryRun should return an empty report for non-fixture non-table text", async () => {
  const sourceClient: SourceClient = {
    async fetchText() {
      return JSON.stringify({ notCandidates: [] });
    },
  };

  const report = await discoverReplaysDryRun({
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.generatedAt).toBe(new Date(0).toISOString());
  expect(report.candidates).toHaveLength(0);
});
