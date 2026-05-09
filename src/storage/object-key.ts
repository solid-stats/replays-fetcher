const sha256Pattern = /^[\da-f]{64}$/u;

export function toRawReplayObjectKey(sha256: string): string {
  if (!sha256Pattern.test(sha256)) {
    throw new Error("SHA-256 checksum must be 64 lowercase hex characters");
  }

  return `raw/sha256/${sha256}.ocap`;
}
