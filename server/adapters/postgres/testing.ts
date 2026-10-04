// Test helper. Needs TEST_DATABASE_URL pointing at an EXISTING database whose
// name contains "test". The helper never creates databases (that needs
// CREATEDB, which shared and Aurora roles usually lack) and never drops the
// schema. It drops only the backend tables.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, dbConnectionFromEnv, migrate, importSamples, type DbConnection } from "./index";
import type pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));

export const VDS_PACK_DIR = join(HERE, "../../ds-packs/vds");

// The checkpointer's tables are included so a thread id reused across test runs starts empty.
const OWN_TABLES = [
  "placements",
  "page_templates",
  "flows",
  "composition_versions",
  "compositions",
  "schema_migrations",
  "checkpoint_writes",
  "checkpoint_blobs",
  "checkpoints",
  "checkpoint_migrations",
];

export function testConnection(): DbConnection {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Create an empty test database (e.g. experience_agent_test) and point this at it.",
    );
  }
  return dbConnectionFromEnv({ ...process.env, DATABASE_URL: url });
}

export async function resetTestDatabase(): Promise<pg.Pool> {
  const conn = testConnection();
  const dbName = new URL(conn.url).pathname.slice(1);
  if (!dbName.includes("test")) {
    throw new Error(`Refusing to reset "${dbName}": test database names must contain "test"`);
  }
  const pool = createPool(conn);
  await pool.query(`drop table if exists ${OWN_TABLES.join(", ")} cascade`);
  await migrate(pool);
  await importSamples(pool, VDS_PACK_DIR);
  return pool;
}
