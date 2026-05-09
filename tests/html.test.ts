import { expect, test } from "vitest";

import {
  extractFilenameFromDetailHtml,
  extractReplayRows,
} from "../src/discovery/html.js";

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
});
