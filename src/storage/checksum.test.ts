import { createHash } from "node:crypto";

import { expect, test } from "vitest";

import { calculateSha256 } from "./checksum.js";

test("calculateSha256 should return lowercase SHA-256 hex for raw replay bytes", () => {
  const bytes = new TextEncoder().encode("solid-stats");
  const expected = createHash("sha256").update(bytes).digest("hex");

  expect(calculateSha256(bytes)).toBe(expected);
});
