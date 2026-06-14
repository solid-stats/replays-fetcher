import { createHash } from "node:crypto";

export const calculateSha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
