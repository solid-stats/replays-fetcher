import { afterEach, expect, test, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  createSourceClient,
  SourceFetchError,
} from "../src/discovery/source-client.js";

const validEnvironment = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/replays",
  REPLAY_SOURCE_URL: "https://example.test/replays",
  S3_ACCESS_KEY_ID: "access-key",
  S3_BUCKET: "solid-stats-replays",
  S3_ENDPOINT: "https://s3.example.test",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "secret-key",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test("createSourceClient should classify direct HTTP failures", async () => {
  const config = loadConfig(validEnvironment);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "",
    })),
  );
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays")),
  ).rejects.toMatchObject({
    code: "rate_limited",
    name: "SourceFetchError",
  });
});

test("createSourceClient should classify non-rate-limited direct failures", async () => {
  const config = loadConfig(validEnvironment);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "",
    })),
  );
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays")),
  ).rejects.toMatchObject({
    code: "source_unavailable",
    name: "SourceFetchError",
  });
});

test("SourceFetchError should carry source failure metadata", () => {
  const error = new SourceFetchError(
    "source_unavailable",
    "source unavailable",
  );

  expect(error).toMatchObject({
    code: "source_unavailable",
    message: "source unavailable",
    name: "SourceFetchError",
  });
});

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

test("createSourceClient should classify generic SSH command failures as unavailable", async () => {
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  });
  const sourceClient = createSourceClient(config, {
    async execFile() {
      throw new Error("connection failed");
    },
  });

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays/100")),
  ).rejects.toMatchObject({
    code: "source_unavailable",
    name: "SourceFetchError",
  });
});
