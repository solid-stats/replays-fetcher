import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

// ARCH-04 single-constructor invariant guard.
//
// The Command band (clients.ts) is the one composition root: each external client
// is constructed exactly once and injected. This guard reads the composition-root
// source and fails `pnpm test` if a second client constructor — or a re-introduced
// convenience factory — ever appears, locking the invariant against silent regression.
//
// Comment-text discipline (mirrors GUARD-04 in contract-check.test.ts): the searched
// literals are assembled from split-string parts so no whole token appears verbatim in
// this file; otherwise this guard's own source could echo into a reviewer-style scan.

const compositionRootSource = "src/commands/clients.ts";

const s3ConstructorLiteral = ["new S3", "Client("].join("");
const poolConstructorLiteral = ["new ", "Pool("].join("");
const fromConfigToken = ["From", "Config"].join("");
const fromDatabaseUrlToken = ["From", "DatabaseUrl"].join("");

const readSourceFile = async (filePath: string): Promise<string> =>
  readFile(new URL(`../../${filePath}`, import.meta.url), "utf8");

const countOccurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe("clients composition root — ARCH-04 single-constructor guard", () => {
  test("constructs exactly one S3 client", async () => {
    // Arrange
    const source = await readSourceFile(compositionRootSource);

    // Act
    const constructorCount = countOccurrences(source, s3ConstructorLiteral);

    // Assert
    expect(constructorCount).toBe(1);
  });

  test("constructs exactly one connection pool", async () => {
    // Arrange
    const source = await readSourceFile(compositionRootSource);

    // Act
    const constructorCount = countOccurrences(source, poolConstructorLiteral);

    // Assert
    expect(constructorCount).toBe(1);
  });

  test("re-introduces no convenience factory at the composition root", async () => {
    // Arrange
    const source = await readSourceFile(compositionRootSource);

    // Act + Assert
    expect(source).not.toContain(fromConfigToken);
    expect(source).not.toContain(fromDatabaseUrlToken);
  });
});
