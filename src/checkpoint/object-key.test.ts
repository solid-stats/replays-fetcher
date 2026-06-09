import { expect, test } from "vitest";

import { toCheckpointObjectKey } from "./object-key.js";

const prefix = "checkpoints";
const s3SafeKeyPattern = /^[a-z0-9._/-]+$/u;

test("toCheckpointObjectKey builds a deterministic S3-safe rolling key", () => {
  const key = toCheckpointObjectKey(prefix, new URL("https://sg.zone/replays"));

  expect(key.startsWith(`${prefix}/`)).toBe(true);
  expect(key.endsWith("/latest.json")).toBe(true);
  expect(s3SafeKeyPattern.test(key)).toBe(true);
});

test("toCheckpointObjectKey is deterministic for the same source URL", () => {
  const url = new URL("https://sg.zone/replays");

  expect(toCheckpointObjectKey(prefix, url)).toBe(
    toCheckpointObjectKey(prefix, new URL("https://sg.zone/replays")),
  );
});

test("toCheckpointObjectKey distinguishes different hosts", () => {
  const first = toCheckpointObjectKey(prefix, new URL("https://sg.zone/r"));
  const second = toCheckpointObjectKey(prefix, new URL("https://other.zone/r"));

  expect(first).not.toBe(second);
});

test("toCheckpointObjectKey distinguishes different paths", () => {
  const first = toCheckpointObjectKey(prefix, new URL("https://sg.zone/a"));
  const second = toCheckpointObjectKey(prefix, new URL("https://sg.zone/b"));

  expect(first).not.toBe(second);
});

test("toCheckpointObjectKey sanitizes port and query into S3-safe segments", () => {
  const key = toCheckpointObjectKey(
    prefix,
    new URL("https://sg.zone:8443/replays?page=2&order=desc"),
  );

  expect(s3SafeKeyPattern.test(key)).toBe(true);
  expect(key).not.toContain(":");
  expect(key).not.toContain("?");
  expect(key.endsWith("/latest.json")).toBe(true);
});

test("toCheckpointObjectKey collapses non-safe runs into a single dash", () => {
  const key = toCheckpointObjectKey(prefix, new URL("https://sg.zone///a@@b"));

  expect(key).not.toContain("--");
  expect(s3SafeKeyPattern.test(key)).toBe(true);
});

test("toCheckpointObjectKey rejects an empty prefix", () => {
  expect(() => toCheckpointObjectKey("", new URL("https://sg.zone/r"))).toThrow(
    Error,
  );
});

test("toCheckpointObjectKey rejects a URL that sanitizes to an empty slug", () => {
  // `file:///` has an empty host and a bare `/` path, so the derived slug is
  // empty after sanitization — the defensive empty-slug guard must throw.
  expect(() => toCheckpointObjectKey(prefix, new URL("file:///"))).toThrow(
    Error,
  );
});

test("toCheckpointObjectKey rejects a prefix with unsafe characters", () => {
  expect(() =>
    toCheckpointObjectKey("BAD PREFIX!", new URL("https://sg.zone/r")),
  ).toThrow(Error);
});
