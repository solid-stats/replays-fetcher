import { expect, test } from "vitest";

import { AppError } from "./app-error.js";
import { CheckpointConflictError } from "./checkpoint-conflict-error.js";

test("CheckpointConflictError carries the checkpoint-conflict code", () => {
  const error = new CheckpointConflictError({ slug: "sg-zone-replays" });

  expect(error.code).toBe("checkpoint-conflict");
});

test("CheckpointConflictError derives its name from the subclass", () => {
  const error = new CheckpointConflictError({ slug: "sg-zone-replays" });

  expect(error.name).toBe("CheckpointConflictError");
});

test("CheckpointConflictError is operational by default", () => {
  const error = new CheckpointConflictError({ slug: "sg-zone-replays" });

  expect(error.isOperational).toBe(true);
});

test("CheckpointConflictError stores only identifiers in details", () => {
  const error = new CheckpointConflictError({
    slug: "sg-zone-replays",
    page: 130,
    attempts: 3,
  });

  expect(error.details).toStrictEqual({
    slug: "sg-zone-replays",
    page: 130,
    attempts: 3,
  });
});

test("CheckpointConflictError details carry no body, secret, or HTML", () => {
  const error = new CheckpointConflictError({
    slug: "sg-zone-replays",
    page: 130,
    attempts: 3,
  });
  const serialized = JSON.stringify(error.details);

  expect(serialized).not.toMatch(/<html|<!doctype|body|secret|password|token/iu);
});

test("CheckpointConflictError preserves a passed cause", () => {
  const cause = new Error("412 Precondition Failed");
  const error = new CheckpointConflictError({ slug: "sg-zone-replays" }, {
    cause,
  });

  expect(error.cause).toBe(cause);
});

test("CheckpointConflictError is an instance of AppError and Error", () => {
  const error = new CheckpointConflictError({ slug: "sg-zone-replays" });

  expect(error).toBeInstanceOf(AppError);
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(CheckpointConflictError);
});
