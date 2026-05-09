import { ConfigError, loadConfig, redactConfig } from "../src/config.js";

const validEnv = {
  REPLAY_SOURCE_URL: "https://example.test/replays",
  S3_ENDPOINT: "https://s3.example.test",
  S3_REGION: "us-east-1",
  S3_BUCKET: "solid-stats-replays",
  S3_ACCESS_KEY_ID: "access-key",
  S3_SECRET_ACCESS_KEY: "secret-key",
  DATABASE_URL: "postgres://user:pass@localhost:5432/replays",
};

describe("loadConfig", () => {
  it("loads required source, S3, and staging settings", () => {
    const config = loadConfig(validEnv);

    expect(config.sourceUrl).toBe("https://example.test/replays");
    expect(config.s3.bucket).toBe("solid-stats-replays");
    expect(config.s3.forcePathStyle).toBe(true);
    expect(config.staging.databaseUrl).toBe(
      "postgres://user:pass@localhost:5432/replays",
    );
  });

  it("fails fast when required settings are missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it("parses path-style override", () => {
    const config = loadConfig({ ...validEnv, S3_FORCE_PATH_STYLE: "false" });

    expect(config.s3.forcePathStyle).toBe(false);
  });
});

describe("redactConfig", () => {
  it("does not expose full S3 credentials", () => {
    const redacted = redactConfig(loadConfig(validEnv));

    expect(redacted.s3.accessKeyId).toBe("ac****ey");
    expect(redacted.s3.secretAccessKey).toBe("se****ey");
  });
});
