import { expect, test } from "vitest";

import { AppError } from "./app-error.js";
import { InvariantViolationError } from "./invariant-violation-error.js";

test("InvariantViolationError carries the invariant_violation code", () => {
  const error = new InvariantViolationError({
    guard: "requireStagingRepository",
  });

  expect(error.code).toBe("invariant_violation");
});

test("InvariantViolationError derives its name from the subclass", () => {
  const error = new InvariantViolationError({
    guard: "requireStagingRepository",
  });

  expect(error.name).toBe("InvariantViolationError");
});

test("InvariantViolationError is non-operational (programmer bug, exit 1)", () => {
  const error = new InvariantViolationError({
    guard: "requireStagingRepository",
  });

  expect(error.isOperational).toBe(false);
});

test("InvariantViolationError stores guard and command identifiers in details", () => {
  const error = new InvariantViolationError({
    guard: "requireStagingRepository",
    command: "watch",
  });

  expect(error.details).toStrictEqual({
    guard: "requireStagingRepository",
    command: "watch",
  });
});

test("InvariantViolationError omits the command identifier when absent", () => {
  const error = new InvariantViolationError({ guard: "stageRawEvidence" });

  expect(error.details).toStrictEqual({ guard: "stageRawEvidence" });
});

test("InvariantViolationError details carry no body, secret, or HTML", () => {
  const error = new InvariantViolationError({
    guard: "requireStagingRepository",
    command: "run-once",
  });
  const serialized = JSON.stringify(error.details);

  expect(serialized).not.toMatch(
    /<html|<!doctype|body|secret|password|token/iu,
  );
});

test("InvariantViolationError is an instance of AppError and Error", () => {
  const error = new InvariantViolationError({
    guard: "requireStagingRepository",
  });

  expect(error).toBeInstanceOf(AppError);
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(InvariantViolationError);
});
