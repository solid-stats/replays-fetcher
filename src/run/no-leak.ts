/**
 * PROG-04 no-leak contract module.
 *
 * This module is the production companion to `no-leak.test.ts`. It documents
 * the three output surfaces that the cross-surface no-leak test (T-11-09)
 * guards:
 *
 *   - Lifecycle NDJSON event lines (injected logger sink)
 *   - Compact stdout summary (`toCompactSummary`)
 *   - Evidence artifact body (S3 PutObject + optional writeEvidenceFile)
 *
 * The actual leak-prevention is implemented across:
 *   - `src/run/run-once.ts` — `sanitizeSourceUrl` strips userinfo; pino
 *     `REDACT_PATHS` censors secret config fields in event payloads.
 *   - `src/logging/create-logger.ts` — `REDACT_PATHS` covers
 *     `*.accessKeyId`, `*.secretAccessKey`, `*.databaseUrl`, `*.sourceSshCommand`.
 *   - `src/run/summary.ts` — `toCompactSummary` strips the heavy arrays
 *     (candidates, rawStorage, staging, diagnostics) that could carry bytes.
 *
 * No production symbols are exported from this file.
 */

export type NoLeakSurface = "events" | "compact_summary" | "evidence_body";
