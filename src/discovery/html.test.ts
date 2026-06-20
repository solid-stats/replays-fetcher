import { expect, test } from "vitest";

import {
  extractFilenameFromDetailHtml,
  extractReplayRows,
  parseGameDateToUtcIso,
} from "./html.js";

test.each([
  ["14.06.2026 19:01", "2026-06-14T19:01:00.000Z"],
  ["13.06.2026 21:08", "2026-06-13T21:08:00.000Z"],
  ["", undefined],
  ["not a date", undefined],
  // Year-first ISO is rejected by the anchored day-first regex.
  ["2026-06-14 19:01", undefined],
])(
  "parseGameDateToUtcIso should map %j to %j",
  (input: string, expected: string | undefined) => {
    expect(parseGameDateToUtcIso(input)).toBe(expected);
  },
);

test("extractReplayRows should capture the listing game-date cell as metadata.discoveredAt", () => {
  const rows = extractReplayRows(
    `
      <table class="common-table">
        <tbody>
          <tr>
            <td><a href="/replays/100">sg@test</a></td>
            <td>Altis</td>
            <td>1</td>
            <td>14.06.2026 19:01</td>
          </tr>
        </tbody>
      </table>
    `,
    1,
    new URL("https://example.test/replays"),
  );

  expect(rows).toStrictEqual([
    {
      metadata: {
        discoveredAt: "2026-06-14T19:01:00.000Z",
        missionText: "sg@test",
        serverId: 1,
        world: "Altis",
      },
      page: 1,
      source: {
        externalId: "100",
        url: "https://example.test/replays/100",
      },
    },
  ]);
});

test("extractReplayRows should leave metadata.discoveredAt unset for a malformed game-date cell", () => {
  const rows = extractReplayRows(
    `
      <table class="common-table">
        <tbody>
          <tr>
            <td><a href="/replays/100">sg@test</a></td>
            <td>Altis</td>
            <td>1</td>
            <td>garbage</td>
          </tr>
        </tbody>
      </table>
    `,
    1,
    new URL("https://example.test/replays"),
  );

  expect(rows).toStrictEqual([
    {
      metadata: {
        missionText: "sg@test",
        serverId: 1,
        world: "Altis",
      },
      page: 1,
      source: {
        externalId: "100",
        url: "https://example.test/replays/100",
      },
    },
  ]);
});

test("extractReplayRows should parse replay rows from common-table HTML", () => {
  const rows = extractReplayRows(
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
    1,
    new URL("https://example.test/replays"),
  );

  expect(rows).toStrictEqual([
    {
      metadata: {
        missionText: "sg@test",
        serverId: 1,
        world: "Altis",
      },
      page: 1,
      source: {
        externalId: "100",
        url: "https://example.test/replays/100",
      },
    },
  ]);
});

test("extractReplayRows should handle missing tables and incomplete rows", () => {
  expect(
    extractReplayRows(
      `<html><body>No table</body></html>`,
      1,
      new URL("https://example.test/replays"),
    ),
  ).toStrictEqual([]);

  expect(
    extractReplayRows(
      `
        <table class="common-table">
          <tbody>
            <tr></tr>
            <tr><td>missing link</td></tr>
          </tbody>
        </table>
      `,
      2,
      new URL("https://example.test/replays"),
    ),
  ).toStrictEqual([
    {
      metadata: {},
      page: 2,
      source: {},
    },
    {
      metadata: {},
      page: 2,
      source: {},
    },
  ]);
});

test("extractReplayRows should treat invalid href values as missing links", () => {
  expect(
    extractReplayRows(
      `
        <table class="common-table">
          <tbody>
            <tr><td><a href="https://[invalid.test">broken</a></td></tr>
          </tbody>
        </table>
      `,
      1,
      new URL("https://example.test/replays"),
    ),
  ).toStrictEqual([
    {
      metadata: {
        missionText: "broken",
      },
      page: 1,
      source: {},
    },
  ]);
});

test("extractReplayRows should reject cross-source and non-replay hrefs", () => {
  expect(
    extractReplayRows(
      `
        <table class="common-table">
          <tbody>
            <tr><td><a href="https://internal.test/admin">internal</a></td></tr>
            <tr><td><a href="/downloads/custom">download</a></td></tr>
          </tbody>
        </table>
      `,
      1,
      new URL("https://example.test/replays"),
    ),
  ).toStrictEqual([
    {
      metadata: {
        missionText: "internal",
      },
      page: 1,
      source: {},
    },
    {
      metadata: {
        missionText: "download",
      },
      page: 1,
      source: {},
    },
  ]);
});

test("extractFilenameFromDetailHtml should prefer #filename over body data-ocap", () => {
  expect(
    extractFilenameFromDetailHtml(
      `<html><body data-ocap="fallback.json"><input id="filename" value="preferred.json"></body></html>`,
    ),
  ).toBe("preferred.json");
  expect(
    extractFilenameFromDetailHtml(
      `<html><body data-ocap="fallback.json"></body></html>`,
    ),
  ).toBe("fallback.json");
  expect(extractFilenameFromDetailHtml(`<html><body></body></html>`)).toBe(
    undefined,
  );
  expect(
    extractFilenameFromDetailHtml(
      `<html><body><input id="other" value="ignored.json"><input id="filename" value="replay&amp;encoded.json"></body></html>`,
    ),
  ).toBe("replay&encoded.json");
});
