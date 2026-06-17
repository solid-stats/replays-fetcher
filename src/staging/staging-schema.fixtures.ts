import type { Pool } from "pg";

/**
 * Single shared staging-schema test helper. The DDL below is the ONLY copy in
 * the repo — both the staging integration test and the golden end-to-end test
 * apply the schema through this one source so the `ON CONFLICT` / 23505
 * idempotency path the golden oracle depends on is exercised against the exact
 * same `unique (source_system, source_replay_id)` and `unique (checksum,
 * object_key)` keys.
 *
 * This is a behavior-preserving extraction, NOT a schema change: `server-2` owns
 * the real `ingest_staging_records` table and the staging migration. No DDL ships
 * from this repo (additive-only discipline) — this helper is test infrastructure
 * (the `.fixtures.ts` suffix marks it as such and excludes it from depcruise).
 */
export const applyStagingSchema = async (client: Pool): Promise<void> => {
  await client.query("create extension if not exists pgcrypto");
  await client.query(
    "create type ingest_status as enum ('pending', 'processing', 'promoted', 'conflict', 'failed')",
  );
  await client.query(`
    create table ingest_staging_records (
      id uuid primary key default gen_random_uuid(),
      source_system text not null,
      source_replay_id text not null,
      object_key text not null,
      checksum text not null,
      size_bytes bigint not null check (size_bytes >= 0),
      replay_timestamp timestamptz,
      status ingest_status not null default 'pending',
      promotion_evidence jsonb not null default '{}'::jsonb,
      conflict_details jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (source_system, source_replay_id),
      unique (checksum, object_key)
    )
  `);
};
