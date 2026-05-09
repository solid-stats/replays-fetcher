import { afterEach, expect, test, vi } from "vitest";

import { buildCli } from "../src/cli.js";
import * as configModule from "../src/config.js";

const validEnvironment = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/replays",
  REPLAY_SOURCE_URL: "https://example.test/replays",
  S3_ACCESS_KEY_ID: "access-key",
  S3_BUCKET: "solid-stats-replays",
  S3_ENDPOINT: "https://s3.example.test",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "secret-key",
};

interface CheckOutput {
  readonly checks: {
    readonly config: "failed" | "passed";
    readonly s3Connectivity?: "not-implemented";
    readonly sourceConnectivity?: "not-implemented";
    readonly stagingConnectivity?: "not-implemented";
  };
  readonly ok: boolean;
}

interface CliOutput {
  readonly error?: string;
  readonly mode?: string;
  readonly ok: boolean;
}

function parseCheckOutput(writes: readonly string[]): CheckOutput {
  return JSON.parse(writes.join("")) as CheckOutput;
}

function parseCliOutput(writes: readonly string[]): CliOutput {
  return JSON.parse(writes.join("")) as CliOutput;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

test("buildCli should write redacted check output when valid configuration is provided", async () => {
  for (const [key, value] of Object.entries(validEnvironment)) {
    vi.stubEnv(key, value);
  }
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync(["node", "replays-fetcher", "check"]);

  const output = parseCheckOutput(writes);
  expect(output).toMatchObject({
    checks: {
      config: "passed",
      s3Connectivity: "not-implemented",
      sourceConnectivity: "not-implemented",
      stagingConnectivity: "not-implemented",
    },
    ok: true,
  });
  expect(JSON.stringify(output)).not.toContain("secret-key");
});

test("buildCli should set a failing exit code when required configuration is missing", async () => {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync(["node", "replays-fetcher", "check"]);

  const output = parseCheckOutput(writes);
  expect(output.ok).toBe(false);
  expect(output.checks.config).toBe("failed");
  expect(process.exitCode).toBe(2);
});

test("buildCli should rethrow unexpected check failures when configuration loading crashes", async () => {
  vi.spyOn(configModule, "loadConfig").mockImplementation(() => {
    throw new TypeError("unexpected config crash");
  });

  await expect(
    buildCli().parseAsync(["node", "replays-fetcher", "check"]),
  ).rejects.toThrow("unexpected config crash");
});

test("buildCli should write dry-run discovery output", async () => {
  for (const [key, value] of Object.entries(validEnvironment)) {
    vi.stubEnv(key, value);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          candidates: [
            {
              externalId: "100",
              filename: "replay-a.json",
              url: "https://example.test/replays/100",
            },
          ],
        }),
    })),
  );
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync(["node", "replays-fetcher", "discover", "--dry-run"]);

  const output = parseCliOutput(writes);
  expect(output).toMatchObject({
    mode: "dry-run",
    ok: true,
  });
});

test("buildCli should reject discover without dry-run until Phase 3", async () => {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync(["node", "replays-fetcher", "discover"]);

  const output = parseCliOutput(writes);
  expect(output).toStrictEqual({
    error: "discover requires --dry-run until Phase 3",
    ok: false,
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli should throw explicit planned-phase errors when future commands are used", async () => {
  await expect(
    buildCli().parseAsync(["node", "replays-fetcher", "run-once"]),
  ).rejects.toThrow("run-once is planned for Phase 5");
});
