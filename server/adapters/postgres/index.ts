import { readFileSync } from "node:fs";
import pg from "pg";
import type { DbConnection } from "./connection";

export { migrate, MIGRATIONS_DIR } from "./migrate";
export { importSamples, type ImportCounts } from "./samples";
export { PostgresAuthoringStore } from "./authoring";
export { PostgresCompositionStore, pingDatabase } from "./store";
export { PostgresThreadLock } from "./threadLock";
export { dbConnectionFromEnv, type DbConnection } from "./connection";

// Works with any Postgres 12+: local, Docker, or Aurora. Pool size and
// timeouts stay at pg defaults until B5 sets them.
export function createPool(conn: DbConnection, options: { max?: number; connectionTimeoutMillis?: number } = {}): pg.Pool {
  const ssl = conn.ssl
    ? { rejectUnauthorized: true, ...(conn.caFile ? { ca: readFileSync(conn.caFile, "utf8") } : {}) }
    : false;
  return new pg.Pool({ connectionString: conn.url, ssl, ...options });
}
