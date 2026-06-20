import { expect, test, vi } from "vitest";

import { SourceFetchError } from "../discovery/source-client.js";
import { checkSourceConnectivity } from "./source-connectivity.js";

test("checkSourceConnectivity should fetch source text and discard the body", async () => {
  const fetchText = vi.fn(async () => "<html>secret source body</html>");
  const sourceUrl = new URL("https://sg.zone/replays");

  await expect(
    checkSourceConnectivity({
      sourceClient: { fetchText },
      sourceUrl,
    }),
  ).resolves.toStrictEqual({ status: "passed" });
  expect(fetchText).toHaveBeenCalledExactlyOnceWith(sourceUrl);
});

test("checkSourceConnectivity should classify expected source failures", async () => {
  const fetchText = vi.fn(async () => {
    throw new SourceFetchError("rate_limited", "Source was rate limited");
  });

  await expect(
    checkSourceConnectivity({
      sourceClient: { fetchText },
      sourceUrl: new URL("https://sg.zone/replays"),
    }),
  ).resolves.toStrictEqual({
    failureCategory: "rate_limited",
    message: "Source was rate limited",
    status: "failed",
  });
});

test("checkSourceConnectivity should rethrow unexpected errors", async () => {
  const error = new TypeError("programmer error");

  await expect(
    checkSourceConnectivity({
      sourceClient: {
        async fetchText() {
          throw error;
        },
      },
      sourceUrl: new URL("https://sg.zone/replays"),
    }),
  ).rejects.toBe(error);
});
