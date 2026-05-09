import { expect, test } from "vitest";

import { loadConfig } from "../src/config.js";
import { createSourceClient } from "../src/discovery/source-client.js";

const validEnvironment = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/replays",
  REPLAY_SOURCE_URL: "https://example.test/replays",
  S3_ACCESS_KEY_ID: "access-key",
  S3_BUCKET: "solid-stats-replays",
  S3_ENDPOINT: "https://s3.example.test",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "secret-key",
};

test("createSourceClient should invoke SSH transport with configured host and URL", async () => {
  const calls: {
    readonly arguments_: readonly string[];
    readonly file: string;
  }[] = [];
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  });
  const sourceClient = createSourceClient(config, {
    async execFile(file, arguments_) {
      calls.push({ arguments_, file });

      return { stderr: "", stdout: "source text" };
    },
  });

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays/100")),
  ).resolves.toBe("source text");
  expect(calls).toStrictEqual([
    {
      arguments_: [
        "allowlisted-host",
        "curl -fsSL --max-time 30",
        "https://example.test/replays/100",
      ],
      file: "ssh",
    },
  ]);
});

test("createSourceClient should classify SSH command failures as source errors", async () => {
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  });
  const sourceClient = createSourceClient(config, {
    async execFile() {
      throw new Error("curl failed with status 429");
    },
  });

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays/100")),
  ).rejects.toMatchObject({
    code: "rate_limited",
    message: "curl failed with status 429",
    name: "SourceFetchError",
  });
});
