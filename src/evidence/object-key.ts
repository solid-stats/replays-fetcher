/**
 * Deterministic runId → evidence object-key builder (PROG-03).
 *
 * Mirrors the validating pure key-builder pattern of `toCheckpointObjectKey`
 * (src/checkpoint/object-key.ts), but keys on the `runId` instead of a
 * source-URL slug. The evidence store writes a SINGLE write-once object per run
 * at `<prefix>/<safeRunId>/evidence.json`. The `run-<ISO8601>-<uuid>` runId
 * (src/cli.ts `createRunId`) contains `:` from the ISO timestamp, which is NOT
 * in `[a-z0-9._/-]`; an operator-controlled prefix or a raw runId must never be
 * able to inject `/`, `:`, `?`, or other unsafe characters into the key
 * (threat T-11-01). The runId is sanitized and the final key validated; the
 * function throws `Error` on invalid input.
 */

const unsafeRunPattern = /[^a-z0-9._-]+/gu;
const leadingTrailingDashPattern = /^-+|-+$/gu;
const s3SafeKeyPattern = /^[a-z0-9._/-]+$/u;
const evidenceObjectName = "evidence.json";

const toRunSlug = (runId: string): string => {
  return runId
    .toLowerCase()
    .replaceAll(unsafeRunPattern, "-")
    .replaceAll(leadingTrailingDashPattern, "");
};

/**
 * Build the write-once evidence object key for a run. Lowercases the `runId`,
 * replaces every run of non-`[a-z0-9._-]` characters with a single `-`, trims
 * leading/trailing dashes, and returns `<prefix>/<safeRunId>/evidence.json`.
 * Throws on an empty prefix, an empty resulting runId segment, or a final key
 * that is not S3-safe.
 */
export const toEvidenceObjectKey = (prefix: string, runId: string): string => {
  if (prefix.length === 0) {
    throw new Error("Evidence object-key prefix must not be empty");
  }

  const safeRunId = toRunSlug(runId);
  if (safeRunId.length === 0) {
    throw new Error("Evidence runId slug must not be empty");
  }

  const key = `${prefix}/${safeRunId}/${evidenceObjectName}`;
  if (!s3SafeKeyPattern.test(key)) {
    throw new Error(
      "Evidence object key must match the S3-safe pattern [a-z0-9._/-]",
    );
  }

  return key;
};
