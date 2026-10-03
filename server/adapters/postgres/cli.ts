// Usage: npm run db:migrate | npm run db:seed (Node LTS with tsx; no Bun needed)
// Reads DATABASE_URL (plus optional DATABASE_SSL / DATABASE_SSL_CA_FILE) and DS_PACK.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, dbConnectionFromEnv, migrate, seedPack } from "./index";

const HERE = dirname(fileURLToPath(import.meta.url));

const command = process.argv[2];
const pool = createPool(dbConnectionFromEnv(process.env));
try {
  if (command === "migrate") {
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No pending migrations.");
  } else if (command === "seed") {
    const packName = process.env.DS_PACK ?? "vds";
    const counts = await seedPack(pool, join(HERE, "../../ds-packs", packName));
    console.log(`Seeded ${packName}:`, counts);
  } else {
    throw new Error(`Unknown command "${command}". Use migrate or seed.`);
  }
} finally {
  await pool.end();
}
