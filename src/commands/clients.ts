import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

import type { AppConfig } from "../config.js";

/**
 * The Command band is the composition root: the one external client per backend
 * is constructed here exactly once per command and injected into every adapter
 * that needs it (the *External adapters* one-client rule — [std: correctness]).
 * Adapters take an injected `sender`/`pool`; they never `new` their own client.
 */

export const createS3Client = (config: AppConfig["s3"]): S3Client =>
  new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
  });

export const createPgPool = (databaseUrl: string): Pool =>
  new Pool({ connectionString: databaseUrl });
