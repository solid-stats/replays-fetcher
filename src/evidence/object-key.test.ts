import { expect, test } from "vitest";

import { toEvidenceObjectKey } from "./object-key.js";

const prefix = "runs";
const s3SafeKeyPattern = /^[a-z0-9._/-]+$/u;

// A colon-bearing runId in the `run-<ISO8601>-<uuid>` shape produced by
// `createRunId` (src/cli.ts) — the ISO timestamp contains `:` which is NOT in
// `[a-z0-9._/-]` and must be sanitized (Pitfall 3 / T-11-01).
const colonRunId = "run-2026-06-11T13:27:38.774Z-abc123";

test("toEvidenceObjectKey sanitizes a colon-bearing runId into an S3-safe key", () => {
  const key = toEvidenceObjectKey(prefix, colonRunId);

  expect(s3SafeKeyPattern.test(key)).toBe(true);
  expect(key).not.toContain(":");
  expect(key.endsWith("/evidence.json")).toBe(true);
});

test("toEvidenceObjectKey starts with the prefix and contains the sanitized runId segment", () => {
  const key = toEvidenceObjectKey(prefix, colonRunId);

  expect(key.startsWith(`${prefix}/`)).toBe(true);
  expect(key).toContain("/run-2026-06-11t13-27-38.774z-abc123/");
});

test("toEvidenceObjectKey collapses non-safe runs into a single dash", () => {
  const key = toEvidenceObjectKey(prefix, "run@@@id");

  expect(key).not.toContain("--");
  expect(s3SafeKeyPattern.test(key)).toBe(true);
});

test("toEvidenceObjectKey is deterministic for the same runId", () => {
  expect(toEvidenceObjectKey(prefix, colonRunId)).toBe(
    toEvidenceObjectKey(prefix, colonRunId),
  );
});

test("toEvidenceObjectKey rejects an empty prefix", () => {
  expect(() => toEvidenceObjectKey("", colonRunId)).toThrow(Error);
});

test("toEvidenceObjectKey rejects a runId that sanitizes to an empty segment", () => {
  expect(() => toEvidenceObjectKey(prefix, "***")).toThrow(Error);
});

test("toEvidenceObjectKey rejects a prefix with unsafe characters", () => {
  expect(() => toEvidenceObjectKey("BAD PREFIX!", colonRunId)).toThrow(Error);
});
