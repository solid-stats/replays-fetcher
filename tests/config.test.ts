import { expect, test } from "vitest";

import { ConfigError, loadConfig, redactConfig } from "../src/config.js";

const validEnvironment = {
  REPLAY_SOURCE_URL: "https://example.test/replays",
  S3_ENDPOINT: "https://s3.example.test",
  S3_REGION: "us-east-1",
  S3_BUCKET: "solid-stats-replays",
  S3_ACCESS_KEY_ID: "access-key",
  S3_SECRET_ACCESS_KEY: "secret-key",
  DATABASE_URL: "postgres://user:pass@localhost:5432/replays",
};

test("loadConfig should load required source, S3, and staging settings when valid environment is provided", () => {
  const config = loadConfig(validEnvironment);

  expect(config.sourceUrl).toBe("https://example.test/replays");
  expect(config.sourceTransport).toBe("direct");
  expect(config.sourceSshCommand).toBe("curl -fsSL --max-time 30");
  expect(config.s3.bucket).toBe("solid-stats-replays");
  expect(config.s3.forcePathStyle).toBe(true);
  expect(config.staging.databaseUrl).toBe(
    "postgres://user:pass@localhost:5432/replays",
  );
});

test("loadConfig should load SSH source transport settings when provided", () => {
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_SSH_COMMAND: "curl -fsSL --max-time 10",
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  });

  expect(config.sourceTransport).toBe("ssh");
  expect(config.sourceSshHost).toBe("allowlisted-host");
  expect(config.sourceSshCommand).toBe("curl -fsSL --max-time 10");
});

test("loadConfig should require an SSH host when SSH transport is enabled", () => {
  expect(() =>
    loadConfig({
      ...validEnvironment,
      REPLAY_SOURCE_TRANSPORT: "ssh",
    }),
  ).toThrow("REPLAY_SOURCE_SSH_HOST");
});

test("loadConfig should throw ConfigError when required settings are missing", () => {
  expect(() => loadConfig({})).toThrow(ConfigError);
});

test("loadConfig should parse path-style override when boolean-like value is provided", () => {
  const config = loadConfig({
    ...validEnvironment,
    S3_FORCE_PATH_STYLE: "false",
  });

  expect(config.s3.forcePathStyle).toBe(false);
});

test("loadConfig should parse affirmative path-style override when compact boolean-like value is provided", () => {
  const config = loadConfig({ ...validEnvironment, S3_FORCE_PATH_STYLE: "y" });

  expect(config.s3.forcePathStyle).toBe(true);
});

test("loadConfig should use path-style access by default when override is omitted", () => {
  const config = loadConfig(validEnvironment);

  expect(config.s3.forcePathStyle).toBe(true);
});

test("loadConfig should accept boolean path-style values when source is provided programmatically", () => {
  const config = loadConfig({ ...validEnvironment, S3_FORCE_PATH_STYLE: true });

  expect(config.s3.forcePathStyle).toBe(true);
});

test("loadConfig should reject path-style override when value is not boolean-like", () => {
  expect(() =>
    loadConfig({ ...validEnvironment, S3_FORCE_PATH_STYLE: "sometimes" }),
  ).toThrow("Expected boolean-like value");
});

test("redactConfig should redact full S3 credentials when configuration is logged", () => {
  const redacted = redactConfig(
    loadConfig({
      ...validEnvironment,
      REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
      REPLAY_SOURCE_TRANSPORT: "ssh",
    }),
  );

  expect(redacted.sourceTransport).toBe("ssh");
  expect(redacted.sourceSshHost).toBe("allowlisted-host");
  expect(redacted.s3.accessKeyId).toBe("ac****ey");
  expect(redacted.s3.secretAccessKey).toBe("se****ey");
});

test("redactConfig should fully mask short S3 credentials when configuration is logged", () => {
  const redacted = redactConfig(
    loadConfig({
      ...validEnvironment,
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "pw",
    }),
  );

  expect(redacted.s3.accessKeyId).toBe("****");
  expect(redacted.s3.secretAccessKey).toBe("****");
});
