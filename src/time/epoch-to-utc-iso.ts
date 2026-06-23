// The external source identifies a replay as `/replays/{id}` where `{id}` is a
// Unix epoch in SECONDS — the only true-UTC instant the fetcher captures (the
// filename and listing dates are server-local wall-clock stamped as UTC). The
// range window rejects non-epoch `derived:` ids and absurd values so a bogus
// timestamp never ships into `replay_timestamp`; out-of-window ids fall through
// to the filename/listing fallbacks instead.
const EPOCH_LOWER_BOUND_SECONDS = 1_420_070_400; // 2015-01-01T00:00:00Z, inclusive
const EPOCH_UPPER_BOUND_SECONDS = 2_051_222_400; // 2035-01-01T00:00:00Z, inclusive
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Convert a source `externalId` that is a Unix-epoch-seconds string to an
 * ISO-8601 UTC instant, or undefined when it is not a clean in-range epoch.
 *
 * The acceptance rule is a strict canonical-integer check (digits only, no
 * leading zeros / signs / whitespace / fractional / scientific / hex forms):
 * coercion artifacts such as "12abc", "1.5e9", " 100 ", "+100" are
 * out-of-contract source ids that must fall through to the fallbacks, not ship
 * a coerced timestamp. Never throws for any input.
 */
export const epochToUtcIso = (externalId: string): string | undefined => {
  if (!/^\d+$/u.test(externalId)) {
    return undefined;
  }

  const seconds = Number(externalId);

  // Reject leading-zero-padded / overflow forms: only the canonical decimal
  // representation round-trips back to the original string.
  if (String(seconds) !== externalId) {
    return undefined;
  }

  if (
    seconds < EPOCH_LOWER_BOUND_SECONDS ||
    seconds > EPOCH_UPPER_BOUND_SECONDS
  ) {
    return undefined;
  }

  return new Date(seconds * MILLISECONDS_PER_SECOND).toISOString();
};
