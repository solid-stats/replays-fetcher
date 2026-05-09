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
            filename: "replay-a.json",
            missionText: "sg@test",
            serverId: 1,
            url: "https://example.test/replays/100",
            world: "Altis",
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
      candidates: 1,
      diagnostics: 0,
      discovered: 1,
    },
    mode: "dry-run",
    ok: true,
  });
  expect(report.candidates).toHaveLength(1);
  expect(report.candidates[0]).toMatchObject({
    identity: {
      filename: "replay-a.json",
    },
    source: {
      externalId: "100",
      url: "https://example.test/replays/100",
    },
  });
  expect(report.diagnostics).toHaveLength(0);
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

test("discoverReplaysDryRun should fetch pages through maxPages in source order", async () => {
  const fetchedUrls: string[] = [];
  const responses = new Map([
    [
      "https://example.test/replays",
      `
        <table class="common-table">
          <tbody>
            <tr>
              <td><a href="/replays/100">first@test</a></td>
              <td>Altis</td>
              <td>1</td>
            </tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays?p=2",
      `
        <table class="common-table">
          <tbody>
            <tr>
              <td><a href="/replays/200">second@test</a></td>
              <td>Malden</td>
              <td>2</td>
            </tr>
          </tbody>
        </table>
      `,
    ],
    [
      "https://example.test/replays/100",
      `<html><body data-ocap="first.json"></body></html>`,
    ],
    [
      "https://example.test/replays/200",
      `<html><body data-ocap="second.json"></body></html>`,
    ],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) {
      fetchedUrls.push(url.toString());

      return responses.get(url.toString()) ?? "";
    },
  };

  const report = await discoverReplaysDryRun({
    generatedAt: "2026-05-09T00:00:00.000Z",
    maxPages: 2,
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(fetchedUrls).toStrictEqual([
    "https://example.test/replays",
    "https://example.test/replays/100",
    "https://example.test/replays?p=2",
    "https://example.test/replays/200",
  ]);
  expect(report.maxPages).toBe(2);
  expect(
    report.candidates.map((candidate) => candidate.identity.filename),
  ).toStrictEqual(["first.json", "second.json"]);
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
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report.maxPages).toBe(2);
  expect(report.candidates).toHaveLength(1);
  expect(report.candidates[0]?.identity.filename).toBe("page-two.json");
  expect(requestedUrls).toStrictEqual([
    "https://example.test/replays",
    "https://example.test/replays/101",
    "https://example.test/replays?p=2",
    "https://example.test/replays/102",
  ]);
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
