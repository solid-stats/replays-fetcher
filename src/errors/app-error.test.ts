import { expect, test } from "vitest";

import { AppError } from "./app-error.js";

class TestError extends AppError<"test_code"> {
  public constructor(
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly isOperational?: boolean;
    },
  ) {
    super("test_code", message, options);
    this.name = "TestError";
  }
}

test("AppError preserves a native ES2022 cause when provided", () => {
  const cause = new Error("root cause");
  const error = new TestError("failed", { cause });

  expect(error.cause).toBe(cause);
});

test("AppError leaves cause undefined when omitted", () => {
  const error = new TestError("failed");

  expect(error.cause).toBeUndefined();
  expect("cause" in error).toBe(false);
});

test("AppError derives name from the concrete subclass", () => {
  const error = new TestError("failed");

  expect(error.name).toBe("TestError");
  expect(error.name).not.toBe("AppError");
});

test("AppError carries the narrow literal code", () => {
  const error = new TestError("failed");

  expect(error.code).toBe("test_code");
});

test("AppError defaults isOperational to true", () => {
  const error = new TestError("failed");

  expect(error.isOperational).toBe(true);
});

test("AppError honors an isOperational override of false", () => {
  const error = new TestError("failed", { isOperational: false });

  expect(error.isOperational).toBe(false);
});

test("AppError stores details when provided", () => {
  const details = { page: 3, source: "sg.zone" };
  const error = new TestError("failed", { details });

  expect(error.details).toStrictEqual(details);
});

test("AppError leaves details undefined when omitted", () => {
  const error = new TestError("failed");

  expect(error.details).toBeUndefined();
});

test("AppError is an instance of Error and the concrete subclass", () => {
  const error = new TestError("failed");

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(TestError);
});
