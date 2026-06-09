/**
 * Deterministic source-slug → checkpoint object-key builder (RESUME-01).
 *
 * Mirrors the validating pure key-builder pattern of `toRawReplayObjectKey`
 * (src/storage/object-key.ts): a side-effect-free function that derives an
 * S3-safe key and throws `Error` on invalid input. The checkpoint store writes a
 * SINGLE rolling object per source at `<prefix>/<slug>/latest.json`, so retention
 * is bounded by construction. The slug is derived deterministically from the
 * source URL's host + pathname; an operator-controlled prefix/source URL must
 * never be able to inject `/`, `:`, `?`, or other unsafe characters into the key
 * (threat T-09-05).
 *
 * Exposed so Plan 05 can reuse the exact same slug→key derivation.
 */

const unsafeSlugRunPattern = /[^a-z0-9._-]+/gu;
const leadingTrailingDashPattern = /^-+|-+$/gu;
const s3SafeKeyPattern = /^[a-z0-9._/-]+$/u;
const rollingObjectName = "latest.json";

/**
 * Build the rolling checkpoint object key for a source URL. Lowercases
 * `host + pathname`, replaces every run of non-`[a-z0-9._-]` characters with a
 * single `-`, trims leading/trailing dashes, and returns
 * `<prefix>/<slug>/latest.json`. Throws on an empty prefix, an empty resulting
 * slug, or a final key that is not S3-safe.
 */
export function toCheckpointObjectKey(prefix: string, sourceUrl: URL): string {
  if (prefix.length === 0) {
    throw new Error("Checkpoint object-key prefix must not be empty");
  }

  const slug = toSourceSlug(sourceUrl);
  if (slug.length === 0) {
    throw new Error("Checkpoint source slug must not be empty");
  }

  const key = `${prefix}/${slug}/${rollingObjectName}`;
  if (!s3SafeKeyPattern.test(key)) {
    throw new Error(
      "Checkpoint object key must match the S3-safe pattern [a-z0-9._/-]",
    );
  }

  return key;
}

/**
 * Derive a deterministic, S3-safe slug from a source URL's host + pathname.
 * Exposed so the read path (Plan 05) and the store can share one derivation.
 */
export function toSourceSlug(sourceUrl: URL): string {
  return `${sourceUrl.host}${sourceUrl.pathname}`
    .toLowerCase()
    .replaceAll(unsafeSlugRunPattern, "-")
    .replaceAll(leadingTrailingDashPattern, "");
}
