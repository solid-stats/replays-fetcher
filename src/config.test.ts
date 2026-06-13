/* eslint-disable max-lines -- config scenarios (source, S3, staging, bounds, redaction) are kept together for config-contract readability. */
import { expect, test } from "vitest";

import {
  ConfigError,
  defaultSourceRetryAttempts,
  loadConfig,
  loadSourceConfig,
  redactConfig,
} from "./config.js";

const validEnvironment = {
  REPLAY_SOURCE_URL: "https://example.test/replays",
  S3_ENDPOINT: "https://s3.example.test",
  S3_REGION: "us-east-1",
  S3_BUCKET: "solid-stats-replays",
  S3_ACCESS_KEY_ID: "access-key",
  S3_SECRET_ACCESS_KEY: "secret-key",
  DATABASE_URL: "postgres://user:pass@localhost:5432/replays",
};
const defaultSourceTimeoutMs = Number("30000");
const overrideSourceTimeoutMs = Number("1500");
const fullRunMaxPages = Number("786");
const overrideSourceRetryAttempts = Number("5");
const disabledSourceRetryAttempts = Number("0");
const defaultSourceConcurrency = Number("8");
const minSourceConcurrency = Number("1");
const maxSourceConcurrency = Number("32");
const aboveMaxSourceConcurrency = Number("33");
const belowMinSourceConcurrency = Number("0");
const defaultSourceRequestSpacingMs = Number("250");
const minSourceRequestSpacingMs = Number("0");
const maxSourceRequestSpacingMs = Number("5000");
const aboveMaxSourceRequestSpacingMs = Number("5001");
const belowMinSourceRequestSpacingMs = Number("-1");
const safetyValveMaxPages = Number("5");

test("loadConfig should load required source, S3, and staging settings when valid environment is provided", () => {
  const config = loadConfig(validEnvironment);

  expect(config.sourceUrl).toBe("https://example.test/replays");
  expect(config.sourceTransport).toBe("direct");
  expect(config.sourceSshCommand).toBe("curl -fsSL --max-time 30");
  expect(config.sourceMaxPages).toBeUndefined();
  expect(config.sourceConcurrency).toBe(defaultSourceConcurrency);
  expect(config.sourceRequestSpacingMs).toBe(defaultSourceRequestSpacingMs);
  expect(config.sourceTimeoutMs).toBe(defaultSourceTimeoutMs);
  expect(config.sourceRetryAttempts).toBe(defaultSourceRetryAttempts);
  expect(config.s3.bucket).toBe("solid-stats-replays");
  expect(config.s3.forcePathStyle).toBe(true);
  expect(config.staging.databaseUrl).toBe(
    "postgres://user:pass@localhost:5432/replays",
  );
});

test("loadSourceConfig should not require S3 or staging settings for dry-run", () => {
  const config = loadSourceConfig({
    REPLAY_SOURCE_URL: "https://example.test/replays",
  });

  expect(config).toMatchObject({
    sourceSshCommand: "curl -fsSL --max-time 30",
    sourceTimeoutMs: defaultSourceTimeoutMs,
    sourceTransport: "direct",
    sourceUrl: "https://example.test/replays",
  });
});

test("loadSourceConfig should validate required source settings", () => {
  expect(() => loadSourceConfig({})).toThrow(ConfigError);
});

test("loadSourceConfig should parse source timeout override", () => {
  const config = loadSourceConfig({
    REPLAY_SOURCE_TIMEOUT_MS: "1500",
    REPLAY_SOURCE_URL: "https://example.test/replays",
  });

  expect(config.sourceTimeoutMs).toBe(overrideSourceTimeoutMs);
});

test("loadSourceConfig should leave source max pages undefined when the optional cap is omitted", () => {
  const config = loadSourceConfig({
    REPLAY_SOURCE_URL: "https://example.test/replays",
  });

  expect(config.sourceMaxPages).toBeUndefined();
});

test("loadSourceConfig should parse the optional source max pages safety-valve cap", () => {
  const config = loadSourceConfig({
    REPLAY_SOURCE_MAX_PAGES: "5",
    REPLAY_SOURCE_URL: "https://example.test/replays",
  });

  expect(config.sourceMaxPages).toBe(safetyValveMaxPages);
});

test("loadSourceConfig should still parse a large source max pages cap", () => {
  const config = loadSourceConfig({
    REPLAY_SOURCE_MAX_PAGES: "786",
    REPLAY_SOURCE_URL: "https://example.test/replays",
  });

  expect(config.sourceMaxPages).toBe(fullRunMaxPages);
});

test("loadConfig should reject a zero source max pages cap", () => {
  expect(() =>
    loadConfig({ ...validEnvironment, REPLAY_SOURCE_MAX_PAGES: "0" }),
  ).toThrow("sourceMaxPages");
});

test("loadConfig should reject a negative source max pages cap", () => {
  expect(() =>
    loadConfig({ ...validEnvironment, REPLAY_SOURCE_MAX_PAGES: "-3" }),
  ).toThrow("sourceMaxPages");
});

const sourceConcurrencyBoundaryCases: readonly (readonly [string, number])[] = [
  [String(minSourceConcurrency), minSourceConcurrency],
  [String(maxSourceConcurrency), maxSourceConcurrency],
];

test.each(sourceConcurrencyBoundaryCases)(
  "loadSourceConfig should accept source concurrency at boundary %s",
  (environmentValue, expected) => {
    const config = loadSourceConfig({
      REPLAY_SOURCE_CONCURRENCY: environmentValue,
      REPLAY_SOURCE_URL: "https://example.test/replays",
    });

    expect(config.sourceConcurrency).toBe(expected);
  },
);

const sourceConcurrencyRejectCases: readonly (readonly [string])[] = [
  [String(belowMinSourceConcurrency)],
  [String(aboveMaxSourceConcurrency)],
  ["abc"],
];

test.each(sourceConcurrencyRejectCases)(
  "loadConfig should reject out-of-range source concurrency %s",
  (environmentValue) => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        REPLAY_SOURCE_CONCURRENCY: environmentValue,
      }),
    ).toThrow("sourceConcurrency");
  },
);

const sourceRequestSpacingBoundaryCases: readonly (readonly [
  string,
  number,
])[] = [
  [String(minSourceRequestSpacingMs), minSourceRequestSpacingMs],
  [String(maxSourceRequestSpacingMs), maxSourceRequestSpacingMs],
];

test.each(sourceRequestSpacingBoundaryCases)(
  "loadSourceConfig should accept source request spacing at boundary %s",
  (environmentValue, expected) => {
    const config = loadSourceConfig({
      REPLAY_SOURCE_REQUEST_SPACING_MS: environmentValue,
      REPLAY_SOURCE_URL: "https://example.test/replays",
    });

    expect(config.sourceRequestSpacingMs).toBe(expected);
  },
);

const sourceRequestSpacingRejectCases: readonly (readonly [string])[] = [
  [String(belowMinSourceRequestSpacingMs)],
  [String(aboveMaxSourceRequestSpacingMs)],
  ["abc"],
];

test.each(sourceRequestSpacingRejectCases)(
  "loadConfig should reject out-of-range source request spacing %s",
  (environmentValue) => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        REPLAY_SOURCE_REQUEST_SPACING_MS: environmentValue,
      }),
    ).toThrow("sourceRequestSpacingMs");
  },
);

test("redactConfig should keep the non-secret source concurrency and spacing visible", () => {
  const redacted = redactConfig(
    loadConfig({
      ...validEnvironment,
      REPLAY_SOURCE_CONCURRENCY: "32",
      REPLAY_SOURCE_REQUEST_SPACING_MS: "5000",
    }),
  );

  expect(redacted.sourceConcurrency).toBe(maxSourceConcurrency);
  expect(redacted.sourceRequestSpacingMs).toBe(maxSourceRequestSpacingMs);
});

test("loadSourceConfig should default source retry attempts when override is omitted", () => {
  const config = loadSourceConfig({
    REPLAY_SOURCE_URL: "https://example.test/replays",
  });

  expect(config.sourceRetryAttempts).toBe(defaultSourceRetryAttempts);
});

test("loadSourceConfig should parse source retry attempts override", () => {
  const config = loadSourceConfig({
    REPLAY_SOURCE_RETRY_ATTEMPTS: "5",
    REPLAY_SOURCE_URL: "https://example.test/replays",
  });

  expect(config.sourceRetryAttempts).toBe(overrideSourceRetryAttempts);
});

test("loadSourceConfig should allow disabling retry with zero attempts", () => {
  const config = loadSourceConfig({
    REPLAY_SOURCE_RETRY_ATTEMPTS: "0",
    REPLAY_SOURCE_URL: "https://example.test/replays",
  });

  expect(config.sourceRetryAttempts).toBe(disabledSourceRetryAttempts);
});

test("loadConfig should reject a negative source retry attempts value", () => {
  expect(() =>
    loadConfig({ ...validEnvironment, REPLAY_SOURCE_RETRY_ATTEMPTS: "-1" }),
  ).toThrow("sourceRetryAttempts");
});

test("loadConfig should reject a non-integer source retry attempts value", () => {
  expect(() =>
    loadConfig({ ...validEnvironment, REPLAY_SOURCE_RETRY_ATTEMPTS: "abc" }),
  ).toThrow("sourceRetryAttempts");
});

test("loadSourceConfig should treat empty source transport as default direct transport", () => {
  const config = loadSourceConfig({
    REPLAY_SOURCE_TRANSPORT: "",
    REPLAY_SOURCE_URL: "https://example.test/replays",
  });

  expect(config.sourceTransport).toBe("direct");
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

test("loadConfig should default the checkpoint prefix to checkpoints", () => {
  const config = loadConfig(validEnvironment);

  expect(config.s3.checkpointPrefix).toBe("checkpoints");
});

test("loadConfig should honor an S3_CHECKPOINT_PREFIX override", () => {
  const config = loadConfig({
    ...validEnvironment,
    S3_CHECKPOINT_PREFIX: "cp",
  });

  expect(config.s3.checkpointPrefix).toBe("cp");
});

test("loadConfig should default checkpoint conditional writes to true", () => {
  const config = loadConfig(validEnvironment);

  expect(config.s3.conditionalWrites).toBe(true);
});

test("loadConfig should honor an S3_CHECKPOINT_CONDITIONAL_WRITES=false override", () => {
  const config = loadConfig({
    ...validEnvironment,
    S3_CHECKPOINT_CONDITIONAL_WRITES: "false",
  });

  expect(config.s3.conditionalWrites).toBe(false);
});

test("loadConfig should reject an empty checkpoint prefix", () => {
  expect(() =>
    loadConfig({ ...validEnvironment, S3_CHECKPOINT_PREFIX: "" }),
  ).toThrow(ConfigError);
});

test("redactConfig should keep the non-secret checkpoint prefix visible", () => {
  const redacted = redactConfig(
    loadConfig({ ...validEnvironment, S3_CHECKPOINT_PREFIX: "cp" }),
  );

  expect(redacted.s3.checkpointPrefix).toBe("cp");
});

test("loadConfig should default the evidence prefix to runs", () => {
  const config = loadConfig(validEnvironment);

  expect(config.s3.evidencePrefix).toBe("runs");
});

test("loadConfig should honor an S3_EVIDENCE_PREFIX override", () => {
  const config = loadConfig({
    ...validEnvironment,
    S3_EVIDENCE_PREFIX: "evidence",
  });

  expect(config.s3.evidencePrefix).toBe("evidence");
});

test("loadConfig should reject an empty evidence prefix", () => {
  expect(() =>
    loadConfig({ ...validEnvironment, S3_EVIDENCE_PREFIX: "" }),
  ).toThrow(ConfigError);
});

test("redactConfig should keep the non-secret evidence prefix visible", () => {
  const redacted = redactConfig(
    loadConfig({ ...validEnvironment, S3_EVIDENCE_PREFIX: "evidence" }),
  );

  expect(redacted.s3.evidencePrefix).toBe("evidence");
});

test("redactConfig should redact full S3 credentials when configuration is logged", () => {
  const redacted = redactConfig(
    loadConfig({
      ...validEnvironment,
      DATABASE_URL: "postgres://user:password@localhost:5432/replays",
      REPLAY_SOURCE_SSH_COMMAND: "sshpass -p source-secret curl -fsSL",
      REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
      REPLAY_SOURCE_TRANSPORT: "ssh",
    }),
  );

  expect(redacted.sourceTransport).toBe("ssh");
  expect(redacted.sourceSshHost).toBe("allowlisted-host");
  expect(redacted.sourceSshCommand).toBe("[redacted-source-ssh-command]");
  expect(redacted.staging.databaseUrl).toBe("[redacted-database-url]");
  expect(redacted.s3.accessKeyId).toBe("ac****ey");
  expect(redacted.s3.secretAccessKey).toBe("se****ey");
  expect(JSON.stringify(redacted)).not.toContain("postgres://user:password@");
  expect(JSON.stringify(redacted)).not.toContain("sshpass");
});

test("redactConfig should keep the non-secret source retry attempts visible", () => {
  const redacted = redactConfig(
    loadConfig({ ...validEnvironment, REPLAY_SOURCE_RETRY_ATTEMPTS: "5" }),
  );

  expect(redacted.sourceRetryAttempts).toBe(overrideSourceRetryAttempts);
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
