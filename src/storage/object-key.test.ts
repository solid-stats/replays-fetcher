import { expect, test } from "vitest";

import { toRawReplayObjectKey } from "./object-key.js";

const validSha256 = "f".repeat(
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".length,
);

test("toRawReplayObjectKey should return the checksum-backed raw object key", () => {
  expect(toRawReplayObjectKey(validSha256)).toBe(
    `raw/sha256/${validSha256}.ocap`,
  );
});

test("toRawReplayObjectKey should reject invalid checksum strings", () => {
  expect(() => toRawReplayObjectKey("abc")).toThrow(
    "SHA-256 checksum must be 64 lowercase hex characters",
  );
  expect(() => toRawReplayObjectKey(validSha256.toUpperCase())).toThrow(
    "SHA-256 checksum must be 64 lowercase hex characters",
  );
});
